-- Ledgistry foundation schema: workspaces, provider sync runs, balance snapshots, audit events.
-- Money is stored as bigint minor units with the currency exponent recorded alongside.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Audit rows are append-only. Cascaded deletes (workspace/user removal) are still allowed.
create or replace function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'audit_events is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- Workspaces ---------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null default 'My workspace' check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

alter table public.workspaces enable row level security;

create policy "Owners can read their workspace"
  on public.workspaces for select to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Users can create their own workspace"
  on public.workspaces for insert to authenticated
  with check ((select auth.uid()) = owner_user_id);

create policy "Owners can rename their workspace"
  on public.workspaces for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

-- Returns the caller's workspace, creating it on first use. Runs as the caller (RLS applies).
create or replace function public.ensure_workspace(p_name text default 'My workspace')
returns public.workspaces
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ws public.workspaces;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = 'invalid_authorization_specification';
  end if;

  insert into public.workspaces (owner_user_id, name)
  values ((select auth.uid()), p_name)
  on conflict (owner_user_id) do nothing;

  select * into ws from public.workspaces where owner_user_id = (select auth.uid());
  return ws;
end;
$$;

-- Provider sync runs ------------------------------------------------------

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null default 'airwallex' check (provider in ('airwallex')),
  kind text not null check (kind in ('balances', 'transactions')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  item_count integer check (item_count >= 0),
  error_code text,
  safe_error_summary text check (char_length(safe_error_summary) <= 500),
  provider_correlation_id text,
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'running') = (finished_at is null))
);

create index sync_runs_workspace_kind_started_idx
  on public.sync_runs (workspace_id, kind, started_at desc);

alter table public.sync_runs enable row level security;

create policy "Workspace owners can read sync runs"
  on public.sync_runs for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can start sync runs"
  on public.sync_runs for insert to authenticated
  with check (
    workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid()))
    and started_by = (select auth.uid())
  );

create policy "Workspace owners can finish sync runs"
  on public.sync_runs for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Balance snapshots -------------------------------------------------------
-- One row per currency/account type per sync run. Null component = not returned by the provider.

create table public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sync_run_id uuid not null references public.sync_runs (id) on delete cascade,
  provider text not null default 'airwallex' check (provider in ('airwallex')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  currency_exponent smallint not null check (currency_exponent between 0 and 4),
  account_type text not null default 'cash',
  available_amount_minor bigint,
  pending_amount_minor bigint,
  reserved_amount_minor bigint,
  total_amount_minor bigint,
  prepayment_amount_minor bigint,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (sync_run_id, currency, account_type)
);

create index balance_snapshots_workspace_fetched_idx
  on public.balance_snapshots (workspace_id, fetched_at desc);

alter table public.balance_snapshots enable row level security;

create policy "Workspace owners can read balance snapshots"
  on public.balance_snapshots for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can record balance snapshots"
  on public.balance_snapshots for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Audit events ------------------------------------------------------------

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
  entity_type text,
  entity_id text,
  outcome text not null check (outcome in ('success', 'failure', 'pending', 'info')),
  summary text not null check (char_length(summary) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (actor_type = 'system' or actor_user_id is not null)
);

create index audit_events_workspace_created_idx
  on public.audit_events (workspace_id, created_at desc);

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function private.prevent_audit_mutation();

alter table public.audit_events enable row level security;

create policy "Workspace owners can read audit events"
  on public.audit_events for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can append audit events"
  on public.audit_events for insert to authenticated
  with check (
    workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid()))
    and (actor_user_id is null or actor_user_id = (select auth.uid()))
  );

-- Privileges: no anonymous access; authenticated gets only what the policies need.

revoke all on public.workspaces, public.sync_runs, public.balance_snapshots, public.audit_events from anon, authenticated;
grant select, insert, update (name) on public.workspaces to authenticated;
grant select, insert, update (status, item_count, error_code, safe_error_summary, provider_correlation_id, finished_at) on public.sync_runs to authenticated;
grant select, insert on public.balance_snapshots to authenticated;
grant select, insert on public.audit_events to authenticated;

revoke execute on function public.ensure_workspace(text) from public, anon;
grant execute on function public.ensure_workspace(text) to authenticated;
revoke execute on function private.set_updated_at() from public, anon, authenticated;
revoke execute on function private.prevent_audit_mutation() from public, anon, authenticated;
