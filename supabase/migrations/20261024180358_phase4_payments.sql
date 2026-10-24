-- Phase 4: one-time payment approvals bound to a fingerprint, and provider payment operations.
-- No transfer is created without a consumed approval; every status change is guarded and audited.

-- Payment approvals --------------------------------------------------------------

create table public.payment_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  plan_id uuid references public.financial_plans (id),
  balance_snapshot_id uuid references public.balance_snapshots (id),
  operation_fingerprint text not null check (operation_fingerprint ~ '^[0-9a-f]{64}$'),
  approved_amount_minor bigint not null check (approved_amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  beneficiary_id text not null check (char_length(beneficiary_id) between 1 and 100),
  transfer_method text not null check (char_length(transfer_method) between 1 and 40),
  reference text not null check (char_length(reference) between 1 and 140),
  obligation_version integer not null,
  policy_snapshot jsonb not null,
  review_snapshot jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'invalidated', 'expired', 'rejected')),
  status_reason text check (char_length(status_reason) <= 300),
  expires_at timestamptz not null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'consumed') = (consumed_at is not null and approved_at is not null and approved_by is not null))
);

-- At most one open review per obligation.
create unique index payment_approvals_one_pending_idx
  on public.payment_approvals (obligation_id) where status = 'pending';
create index payment_approvals_workspace_created_idx on public.payment_approvals (workspace_id, created_at desc);

create or replace function private.guard_payment_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.approved_at is not null or new.consumed_at is not null then
      raise exception 'Approvals start as a pending review';
    end if;
    if new.expires_at <= now() or new.expires_at > now() + interval '30 minutes' then
      raise exception 'An approval review must expire within 30 minutes';
    end if;
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if (new.workspace_id, new.obligation_id, new.operation_fingerprint, new.approved_amount_minor, new.currency,
      new.beneficiary_id, new.transfer_method, new.reference, new.obligation_version, new.expires_at)
     is distinct from
     (old.workspace_id, old.obligation_id, old.operation_fingerprint, old.approved_amount_minor, old.currency,
      old.beneficiary_id, old.transfer_method, old.reference, old.obligation_version, old.expires_at) then
    raise exception 'An approval''s payment details cannot change; open a new review instead';
  end if;
  if new.status is distinct from old.status and old.status <> 'pending' then
    raise exception 'A % approval is final', old.status;
  end if;
  if new.status = 'consumed' and old.status = 'pending' and old.expires_at <= now() then
    raise exception 'This approval has expired';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payment_approvals_guard
  before insert or update on public.payment_approvals
  for each row execute function private.guard_payment_approval();

alter table public.payment_approvals enable row level security;

create policy "Workspace owners can read approvals"
  on public.payment_approvals for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));
create policy "Workspace owners can open approvals"
  on public.payment_approvals for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));
create policy "Workspace owners can decide approvals"
  on public.payment_approvals for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Payment operations --------------------------------------------------------------

create table public.payment_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  approval_id uuid not null unique references public.payment_approvals (id),
  provider text not null default 'airwallex' check (provider in ('airwallex')),
  provider_request_id text not null check (char_length(provider_request_id) between 8 and 64),
  provider_transfer_id text check (char_length(provider_transfer_id) <= 100),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  beneficiary_id text not null,
  transfer_method text not null,
  reference text not null,
  operation_fingerprint text not null,
  status text not null default 'prepared' check (status in (
    'prepared', 'submitted', 'verification_required', 'pending', 'completed', 'failed', 'cancelled', 'unknown'
  )),
  last_provider_status text check (char_length(last_provider_status) <= 60),
  provider_fee_minor bigint check (provider_fee_minor >= 0),
  provider_fee_currency char(3),
  failure_code text check (char_length(failure_code) <= 80),
  safe_error_summary text check (char_length(safe_error_summary) <= 500),
  is_sandbox boolean not null default true,
  request_started_at timestamptz not null default now(),
  submitted_at timestamptz,
  last_verified_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_request_id),
  check (status <> 'completed' or (provider_transfer_id is not null and last_provider_status is not null))
);

create unique index payment_operations_transfer_idx
  on public.payment_operations (workspace_id, provider, provider_transfer_id) where provider_transfer_id is not null;
-- One payment in flight per obligation (double-click and parallel-request guard).
create unique index payment_operations_one_active_idx
  on public.payment_operations (obligation_id)
  where status in ('prepared', 'submitted', 'verification_required', 'pending', 'unknown');
create index payment_operations_workspace_created_idx on public.payment_operations (workspace_id, created_at desc);

create or replace function private.guard_payment_operation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'prepared' or new.provider_transfer_id is not null then
      raise exception 'Payment operations start as prepared, before any provider call';
    end if;
    if not exists (
      select 1 from public.payment_approvals a
      where a.id = new.approval_id and a.status = 'consumed' and a.workspace_id = new.workspace_id
        and a.obligation_id = new.obligation_id and a.approved_amount_minor = new.amount_minor
        and a.currency = new.currency and a.beneficiary_id = new.beneficiary_id
        and a.operation_fingerprint = new.operation_fingerprint
    ) then
      raise exception 'A payment operation needs a consumed approval for exactly these details';
    end if;
    new.created_by := (select auth.uid());
    return new;
  end if;

  if (new.workspace_id, new.obligation_id, new.approval_id, new.provider, new.provider_request_id, new.amount_minor,
      new.currency, new.beneficiary_id, new.transfer_method, new.reference, new.operation_fingerprint, new.is_sandbox,
      new.request_started_at)
     is distinct from
     (old.workspace_id, old.obligation_id, old.approval_id, old.provider, old.provider_request_id, old.amount_minor,
      old.currency, old.beneficiary_id, old.transfer_method, old.reference, old.operation_fingerprint, old.is_sandbox,
      old.request_started_at) then
    raise exception 'A payment operation''s request cannot change';
  end if;
  if old.provider_transfer_id is not null and new.provider_transfer_id is distinct from old.provider_transfer_id then
    raise exception 'The provider transfer id cannot change once recorded';
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'prepared' then array['submitted', 'verification_required', 'failed']
      when 'submitted' then array['pending', 'completed', 'failed', 'cancelled', 'verification_required', 'unknown']
      when 'verification_required' then array['submitted', 'pending', 'completed', 'failed', 'cancelled', 'unknown']
      when 'pending' then array['completed', 'failed', 'cancelled', 'verification_required', 'unknown']
      when 'unknown' then array['pending', 'completed', 'failed', 'cancelled', 'verification_required']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'A % payment cannot become %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger payment_operations_guard
  before insert or update on public.payment_operations
  for each row execute function private.guard_payment_operation();

alter table public.payment_operations enable row level security;

create policy "Workspace owners can read payment operations"
  on public.payment_operations for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));
create policy "Workspace owners can prepare payment operations"
  on public.payment_operations for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));
create policy "Workspace owners can record payment progress"
  on public.payment_operations for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Invalidate open reviews when what they approve changes -------------------------

create or replace function private.invalidate_reviews_on_obligation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.amount_minor, new.currency, new.payee_name, new.beneficiary_id, new.invoice_reference, new.description,
      new.archived_at, new.version)
     is distinct from
     (old.amount_minor, old.currency, old.payee_name, old.beneficiary_id, old.invoice_reference, old.description,
      old.archived_at, old.version)
     or (new.status is distinct from old.status and new.status not in ('planned', 'approval_required', 'failed', 'in_progress')) then
    update public.payment_approvals a
       set status = 'invalidated', status_reason = 'The obligation changed after this review was opened.'
     where a.obligation_id = new.id and a.status = 'pending';
  end if;
  return new;
end;
$$;

create trigger obligations_invalidate_reviews
  after update on public.obligations
  for each row execute function private.invalidate_reviews_on_obligation_change();

create or replace function private.invalidate_reviews_on_reserve_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.payment_approvals a
     set status = 'invalidated', status_reason = 'The protected reserve changed after this review was opened.'
   where a.workspace_id = new.workspace_id and a.currency = new.currency and a.status = 'pending';
  return new;
end;
$$;

create trigger reserve_policies_invalidate_reviews
  after insert or update on public.reserve_policies
  for each row execute function private.invalidate_reviews_on_reserve_change();

-- RPCs (security invoker: RLS and the guards above always apply) ------------------

-- Opens a review of exactly the obligation's current payment details. Older open reviews of the
-- same obligation are invalidated. The server computes the fingerprint from fresh records.
create or replace function public.open_payment_review(
  p_obligation_id uuid,
  p_fingerprint text,
  p_transfer_method text,
  p_reference text,
  p_plan_id uuid,
  p_balance_snapshot_id uuid,
  p_policy_snapshot jsonb,
  p_review_snapshot jsonb,
  p_ttl_minutes integer
)
returns public.payment_approvals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.obligations;
  result public.payment_approvals;
begin
  select * into o from public.obligations where id = p_obligation_id for update;
  if not found then raise exception 'Obligation not found'; end if;
  if o.archived_at is not null or o.status not in ('planned', 'approval_required', 'failed') then
    raise exception 'Only planned obligations can be reviewed for payment';
  end if;
  if o.beneficiary_id is null then raise exception 'Link a beneficiary before paying'; end if;
  if exists (
    select 1 from public.payment_operations p
    where p.obligation_id = o.id and p.status in ('prepared', 'submitted', 'verification_required', 'pending', 'unknown')
  ) then
    raise exception 'A payment for this obligation is already in progress';
  end if;

  update public.payment_approvals a
     set status = 'invalidated', status_reason = 'Replaced by a newer review.'
   where a.obligation_id = o.id and a.status = 'pending';

  insert into public.payment_approvals (
    workspace_id, obligation_id, plan_id, balance_snapshot_id, operation_fingerprint, approved_amount_minor, currency,
    beneficiary_id, transfer_method, reference, obligation_version, policy_snapshot, review_snapshot, expires_at
  ) values (
    o.workspace_id, o.id, p_plan_id, p_balance_snapshot_id, p_fingerprint, o.amount_minor, o.currency,
    o.beneficiary_id, p_transfer_method, p_reference, o.version, p_policy_snapshot, p_review_snapshot,
    now() + make_interval(mins => least(greatest(p_ttl_minutes, 1), 30))
  )
  returning * into result;
  return result;
end;
$$;

-- Consumes a pending review exactly once and prepares the operation (with its request_id) before
-- any provider call. Returns an outcome instead of raising so that expiry/invalidation persist.
create or replace function public.approve_payment(p_approval_id uuid, p_fingerprint text)
returns table (outcome text, operation_id uuid, request_id text, message text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  a public.payment_approvals;
  o public.obligations;
  op_id uuid;
  req text;
begin
  select * into a from public.payment_approvals where id = p_approval_id for update;
  if not found then
    return query select 'not_found', null::uuid, null::text, 'This review no longer exists.';
    return;
  end if;
  if a.status <> 'pending' then
    return query select a.status, null::uuid, null::text,
      coalesce(a.status_reason, format('This review is already %s.', a.status));
    return;
  end if;
  if a.expires_at <= now() then
    update public.payment_approvals set status = 'expired', status_reason = 'The review expired before approval.'
     where id = a.id;
    return query select 'expired', null::uuid, null::text, 'This review expired. Open a new one.';
    return;
  end if;
  if a.operation_fingerprint <> p_fingerprint then
    update public.payment_approvals
       set status = 'invalidated', status_reason = 'Payment details or policy changed since the review.'
     where id = a.id;
    return query select 'invalidated', null::uuid, null::text,
      'Something material changed since you reviewed this payment. Review it again.';
    return;
  end if;

  select * into o from public.obligations where id = a.obligation_id for update;
  if o.version <> a.obligation_version or o.amount_minor <> a.approved_amount_minor or o.currency <> a.currency
     or o.beneficiary_id is distinct from a.beneficiary_id or o.archived_at is not null
     or o.status not in ('planned', 'approval_required', 'failed') then
    update public.payment_approvals
       set status = 'invalidated', status_reason = 'The obligation changed since the review.'
     where id = a.id;
    return query select 'invalidated', null::uuid, null::text, 'The obligation changed since you reviewed it.';
    return;
  end if;

  update public.payment_approvals
     set status = 'consumed', approved_by = (select auth.uid()), approved_at = now(), consumed_at = now()
   where id = a.id;

  req := 'ledgistry-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.payment_operations (
    workspace_id, obligation_id, approval_id, provider_request_id, amount_minor, currency, beneficiary_id,
    transfer_method, reference, operation_fingerprint
  ) values (
    a.workspace_id, a.obligation_id, a.id, req, a.approved_amount_minor, a.currency, a.beneficiary_id,
    a.transfer_method, a.reference, a.operation_fingerprint
  )
  returning id into op_id;

  perform set_config('ledgistry.system_transition', 'on', true);
  update public.obligations set status = 'in_progress' where id = o.id;
  perform set_config('ledgistry.system_transition', 'off', true);

  insert into public.audit_events (
    workspace_id, actor_type, actor_user_id, event_type, entity_type, entity_id, outcome, summary, metadata
  ) values (
    a.workspace_id, 'user', (select auth.uid()), 'payment.approved', 'payment_operation', op_id::text, 'success',
    left(format('Approved %s to %s (reference %s). Sandbox transfer request %s prepared before sending.',
      private.format_minor(a.approved_amount_minor, a.currency), o.payee_name, a.reference, req), 500),
    jsonb_build_object('approval_id', a.id, 'obligation_id', o.id, 'request_id', req,
      'fingerprint', a.operation_fingerprint, 'obligation_version', a.obligation_version)
  );

  return query select 'prepared', op_id, req, 'Approved. Sending to Airwallex Sandbox.';
end;
$$;

-- Records what the provider said (or that the outcome is unknown) and keeps the obligation in step.
create or replace function public.record_payment_progress(
  p_operation_id uuid,
  p_status text,
  p_provider_transfer_id text,
  p_provider_status text,
  p_fee_minor bigint,
  p_fee_currency text,
  p_failure_code text,
  p_safe_summary text,
  p_source text
)
returns public.payment_operations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  op public.payment_operations;
  o public.obligations;
  result public.payment_operations;
  obligation_status text;
  changed boolean;
begin
  select * into op from public.payment_operations where id = p_operation_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p_source not in ('create', 'verify', 'lookup', 'simulation') then raise exception 'Unknown progress source'; end if;

  changed := p_status is distinct from op.status or p_provider_status is distinct from op.last_provider_status;

  update public.payment_operations set
    status = p_status,
    provider_transfer_id = coalesce(op.provider_transfer_id, p_provider_transfer_id),
    last_provider_status = coalesce(p_provider_status, op.last_provider_status),
    provider_fee_minor = coalesce(p_fee_minor, op.provider_fee_minor),
    provider_fee_currency = coalesce(p_fee_currency, op.provider_fee_currency),
    failure_code = case when p_status in ('failed', 'cancelled', 'verification_required', 'unknown') then p_failure_code else null end,
    safe_error_summary = case when p_status in ('failed', 'cancelled', 'verification_required', 'unknown') then left(p_safe_summary, 500) else null end,
    submitted_at = case when op.submitted_at is null and p_provider_transfer_id is not null then now() else op.submitted_at end,
    last_verified_at = case when p_source in ('verify', 'lookup') then now() else op.last_verified_at end,
    completed_at = case when p_status = 'completed' then coalesce(op.completed_at, now()) else op.completed_at end
  where id = op.id
  returning * into result;

  obligation_status := case
    when p_status = 'completed' then 'paid'
    when p_status in ('failed', 'cancelled') then 'failed'
    else 'in_progress'
  end;
  select * into o from public.obligations where id = op.obligation_id for update;
  if o.status is distinct from obligation_status then
    perform set_config('ledgistry.system_transition', 'on', true);
    update public.obligations set status = obligation_status where id = o.id;
    perform set_config('ledgistry.system_transition', 'off', true);
  end if;

  if changed then
    insert into public.audit_events (
      workspace_id, actor_type, actor_user_id, event_type, entity_type, entity_id, outcome, summary, metadata
    ) values (
      op.workspace_id, 'user', (select auth.uid()),
      case p_status
        when 'completed' then 'payment.completed'
        when 'failed' then 'payment.failed'
        when 'cancelled' then 'payment.cancelled'
        when 'verification_required' then 'payment.verification_required'
        else 'payment.status_recorded'
      end,
      'payment_operation', op.id::text,
      case
        when p_status = 'completed' then 'success'
        when p_status in ('failed', 'cancelled') then 'failure'
        when p_status in ('verification_required', 'unknown') then 'pending'
        else 'info'
      end,
      left(format('%s to %s: %s%s (%s).',
        private.format_minor(op.amount_minor, op.currency), o.payee_name,
        replace(p_status, '_', ' '),
        case when p_provider_status is not null then format(', Airwallex status %s', p_provider_status) else '' end,
        case p_source
          when 'create' then 'response to the transfer request'
          when 'verify' then 'read back from Airwallex'
          when 'lookup' then 'found by request id'
          else 'sandbox simulation, read back from Airwallex'
        end), 500),
      jsonb_build_object('request_id', op.provider_request_id, 'transfer_id', coalesce(op.provider_transfer_id, p_provider_transfer_id),
        'provider_status', p_provider_status, 'status', p_status, 'failure_code', p_failure_code, 'source', p_source)
    );
  end if;
  return result;
end;
$$;

-- Privileges -------------------------------------------------------------------------

revoke all on public.payment_approvals, public.payment_operations from anon, authenticated;
grant select, insert on public.payment_approvals to authenticated;
grant update (status, status_reason, approved_by, approved_at, consumed_at) on public.payment_approvals to authenticated;
grant select, insert on public.payment_operations to authenticated;
grant update (status, provider_transfer_id, last_provider_status, provider_fee_minor, provider_fee_currency, failure_code,
  safe_error_summary, submitted_at, last_verified_at, completed_at) on public.payment_operations to authenticated;

revoke execute on function
  public.open_payment_review(uuid, text, text, text, uuid, uuid, jsonb, jsonb, integer),
  public.approve_payment(uuid, text),
  public.record_payment_progress(uuid, text, text, text, bigint, text, text, text, text)
  from public, anon;
grant execute on function
  public.open_payment_review(uuid, text, text, text, uuid, uuid, jsonb, jsonb, integer),
  public.approve_payment(uuid, text),
  public.record_payment_progress(uuid, text, text, text, bigint, text, text, text, text)
  to authenticated;

revoke execute on function
  private.guard_payment_approval(), private.guard_payment_operation(),
  private.invalidate_reviews_on_obligation_change(), private.invalidate_reviews_on_reserve_change()
  from public, anon, authenticated;
