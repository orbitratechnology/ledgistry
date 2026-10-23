-- Phase 3: reserve policies, immutable cash-plan snapshots, cached AI plan explanations.
-- All tables are scoped to the workspace owner via RLS; no anon access.

-- Reserve policies -------------------------------------------------------------

create table public.reserve_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reserve_amount_minor bigint not null check (reserve_amount_minor between 0 and 9000000000000000),
  enabled boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, currency)
);

create or replace function private.stamp_reserve_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.currency <> old.currency) then
    raise exception 'A reserve policy cannot move to another workspace or currency'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger reserve_policies_stamp
  before insert or update on public.reserve_policies
  for each row execute function private.stamp_reserve_policy();

alter table public.reserve_policies enable row level security;

create policy "Workspace owners can read reserve policies"
  on public.reserve_policies for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can create reserve policies"
  on public.reserve_policies for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can update reserve policies"
  on public.reserve_policies for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Financial plans (immutable snapshots) ----------------------------------------

create table public.financial_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  plan_version integer not null check (plan_version > 0),
  balance_snapshot_id uuid references public.balance_snapshots (id),
  policy_snapshot jsonb not null,
  plan_inputs_hash text not null check (plan_inputs_hash ~ '^[0-9a-f]{64}$'),
  plan_results jsonb not null,
  rule_version text not null check (char_length(rule_version) between 1 and 60),
  recalc_reason text not null check (recalc_reason ~ '^[a-z][a-z_]{0,40}$'),
  previous_plan_id uuid references public.financial_plans (id),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, currency, plan_version),
  unique (id, workspace_id)
);

create or replace function private.guard_financial_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old; -- workspace removal cascades
    end if;
    raise exception 'financial_plans is append-only (DELETE blocked)' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'financial_plans is append-only (UPDATE blocked)' using errcode = 'insufficient_privilege';
  end if;

  if new.balance_snapshot_id is not null and not exists (
    select 1 from public.balance_snapshots b
    where b.id = new.balance_snapshot_id and b.workspace_id = new.workspace_id and b.currency = new.currency
  ) then
    raise exception 'Balance snapshot does not belong to this workspace and currency' using errcode = 'check_violation';
  end if;
  if new.previous_plan_id is not null and not exists (
    select 1 from public.financial_plans p
    where p.id = new.previous_plan_id and p.workspace_id = new.workspace_id and p.currency = new.currency
      and p.plan_version = new.plan_version - 1
  ) then
    raise exception 'Previous plan must be the prior version for this workspace and currency' using errcode = 'check_violation';
  end if;
  new.created_by := (select auth.uid());
  new.created_at := now();
  return new;
end;
$$;

create trigger financial_plans_guard
  before insert or update or delete on public.financial_plans
  for each row execute function private.guard_financial_plan();

alter table public.financial_plans enable row level security;

create policy "Workspace owners can read plans"
  on public.financial_plans for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can record plans"
  on public.financial_plans for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Records a plan as a new version unless the latest version was built from identical inputs.
-- Versions are assigned under a per-workspace-and-currency advisory lock.
create or replace function public.record_financial_plan(
  p_workspace_id uuid,
  p_currency text,
  p_balance_snapshot_id uuid,
  p_policy_snapshot jsonb,
  p_inputs_hash text,
  p_results jsonb,
  p_rule_version text,
  p_reason text,
  p_summary text
)
returns table (plan_id uuid, plan_version integer, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  latest record;
  new_id uuid;
  new_version integer;
begin
  if not exists (
    select 1 from public.workspaces w where w.id = p_workspace_id and w.owner_user_id = (select auth.uid())
  ) then
    raise exception 'Workspace not found' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('financial_plans:' || p_workspace_id::text || ':' || p_currency, 0));

  select fp.id, fp.plan_version, fp.plan_inputs_hash into latest
  from public.financial_plans fp
  where fp.workspace_id = p_workspace_id and fp.currency = p_currency
  order by fp.plan_version desc
  limit 1;

  if found and latest.plan_inputs_hash = p_inputs_hash then
    return query select latest.id, latest.plan_version, false;
    return;
  end if;

  new_version := coalesce(latest.plan_version, 0) + 1;
  insert into public.financial_plans (
    workspace_id, currency, plan_version, balance_snapshot_id, policy_snapshot, plan_inputs_hash,
    plan_results, rule_version, recalc_reason, previous_plan_id
  ) values (
    p_workspace_id, p_currency, new_version, p_balance_snapshot_id, p_policy_snapshot, p_inputs_hash,
    p_results, p_rule_version, p_reason, latest.id
  )
  returning id into new_id;

  insert into public.audit_events (
    workspace_id, actor_type, actor_user_id, event_type, entity_type, entity_id, outcome, summary, metadata
  ) values (
    p_workspace_id, 'user', (select auth.uid()), 'plan.generated', 'financial_plan', new_id::text, 'info',
    left(coalesce(nullif(p_summary, ''), format('%s plan v%s calculated', p_currency, new_version)), 500),
    jsonb_build_object(
      'currency', p_currency, 'plan_version', new_version, 'reason', p_reason,
      'inputs_hash', p_inputs_hash, 'balance_snapshot_id', p_balance_snapshot_id, 'rule_version', p_rule_version
    )
  );

  return query select new_id, new_version, true;
end;
$$;

-- AI plan explanations (a cache keyed by the immutable plan) --------------------

create table public.plan_explanations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  plan_id uuid not null unique,
  status text not null check (status in ('ready', 'failed')),
  content jsonb,
  failure_kind text check (char_length(failure_kind) <= 60),
  model_id text check (char_length(model_id) <= 100),
  attempts smallint not null default 1 check (attempts between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, workspace_id) references public.financial_plans (id, workspace_id) on delete cascade,
  check ((status = 'ready') = (content is not null))
);

create trigger plan_explanations_set_updated_at
  before update on public.plan_explanations
  for each row execute function private.set_updated_at();

alter table public.plan_explanations enable row level security;

create policy "Workspace owners can read plan explanations"
  on public.plan_explanations for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can store plan explanations"
  on public.plan_explanations for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can refresh plan explanations"
  on public.plan_explanations for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Privileges ---------------------------------------------------------------------

revoke all on public.reserve_policies, public.financial_plans, public.plan_explanations from anon, authenticated;

grant select, insert on public.reserve_policies to authenticated;
grant update (reserve_amount_minor, enabled) on public.reserve_policies to authenticated;

grant select, insert on public.financial_plans to authenticated;

grant select, insert on public.plan_explanations to authenticated;
grant update (status, content, failure_kind, model_id, attempts) on public.plan_explanations to authenticated;

revoke execute on function public.record_financial_plan(uuid, text, uuid, jsonb, text, jsonb, text, text, text)
  from public, anon;
grant execute on function public.record_financial_plan(uuid, text, uuid, jsonb, text, jsonb, text, text, text)
  to authenticated;

revoke execute on function private.stamp_reserve_policy(), private.guard_financial_plan()
  from public, anon, authenticated;
