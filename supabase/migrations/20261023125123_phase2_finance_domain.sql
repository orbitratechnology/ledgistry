-- Ledgistry Phase 2: obligations, expected receipts, provider transactions and reconciliation.
-- Money is bigint minor units. "Received" and "applied" amounts are never stored: they are derived
-- from confirmed matches, and a guard trigger enforces the invariants under row locks.

grant usage on schema private to authenticated;

-- Helpers ------------------------------------------------------------------

create or replace function private.currency_exponent(p_currency text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_currency in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0
    when p_currency in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3
    else 2
  end
$$;

-- "USD 4,500.00" — used only for human-readable audit summaries.
create or replace function private.format_minor(p_minor bigint, p_currency text)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_currency || ' ' || to_char(
    p_minor::numeric / power(10, private.currency_exponent(p_currency)),
    'FM999,999,999,999,990' || case
      when private.currency_exponent(p_currency) > 0
        then '.' || repeat('0', private.currency_exponent(p_currency))
      else ''
    end
  )
$$;

grant execute on function private.currency_exponent(text), private.format_minor(bigint, text) to authenticated;

-- Obligations ----------------------------------------------------------------

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  payee_name text not null check (char_length(payee_name) between 1 and 140),
  description text not null check (char_length(description) between 1 and 500),
  invoice_reference text check (char_length(invoice_reference) <= 140),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  due_date date not null,
  priority text not null check (priority in ('critical', 'high', 'normal', 'low')),
  status text not null default 'draft' check (
    status in ('draft', 'planned', 'approval_required', 'in_progress', 'paid', 'deferred', 'cancelled', 'failed')
  ),
  allow_partial_payment boolean not null default false,
  beneficiary_id text check (char_length(beneficiary_id) <= 100),
  beneficiary_label text check (char_length(beneficiary_label) <= 200),
  notes text check (char_length(notes) <= 2000),
  is_demo boolean not null default false,
  -- Incremented whenever a material payment detail changes; approvals bind to it (Phase 4).
  version integer not null default 1,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index obligations_workspace_due_idx on public.obligations (workspace_id, due_date);

-- Operators may only move between these statuses; the rest are set by payment processing.
create or replace function private.guard_obligation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  operator_statuses constant text[] := array['draft', 'planned', 'deferred', 'cancelled'];
  system_transition boolean := coalesce(current_setting('ledgistry.system_transition', true), '') = 'on';
  material_change boolean;
begin
  if tg_op = 'INSERT' then
    if not (new.status = any (operator_statuses)) then
      raise exception 'New obligations must start as draft, planned, deferred or cancelled';
    end if;
    return new;
  end if;

  if new.workspace_id <> old.workspace_id then
    raise exception 'Obligations cannot move between workspaces';
  end if;

  material_change :=
    new.amount_minor is distinct from old.amount_minor
    or new.currency is distinct from old.currency
    or new.payee_name is distinct from old.payee_name
    or new.beneficiary_id is distinct from old.beneficiary_id
    or new.allow_partial_payment is distinct from old.allow_partial_payment;

  if material_change and old.status in ('approval_required', 'in_progress', 'paid') and not system_transition then
    raise exception 'Payment details are locked while a payment is % for this obligation', replace(old.status, '_', ' ');
  end if;

  if new.status is distinct from old.status and not system_transition then
    if not (new.status = any (operator_statuses))
       or not (old.status = any (operator_statuses || array['failed'])) then
      raise exception 'Status "%" is set by payment processing, not by edits', replace(new.status, '_', ' ');
    end if;
  end if;

  if material_change then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger obligations_guard
  before insert or update on public.obligations
  for each row execute function private.guard_obligation();

alter table public.obligations enable row level security;

create policy "Workspace owners can read obligations"
  on public.obligations for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can create obligations"
  on public.obligations for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can edit obligations"
  on public.obligations for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Expected receipts -----------------------------------------------------------

create table public.expected_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  payer_name text not null check (char_length(payer_name) between 1 and 140),
  reference text not null check (char_length(reference) between 1 and 140),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  expected_date date not null,
  notes text check (char_length(notes) <= 2000),
  is_demo boolean not null default false,
  cancelled_at timestamptz,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expected_receipts_workspace_date_idx on public.expected_receipts (workspace_id, expected_date);

alter table public.expected_receipts enable row level security;

create policy "Workspace owners can read expected receipts"
  on public.expected_receipts for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can create expected receipts"
  on public.expected_receipts for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can edit expected receipts"
  on public.expected_receipts for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Provider transactions (evidence) -------------------------------------------

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null default 'airwallex' check (provider in ('airwallex')),
  provider_transaction_id text not null check (char_length(provider_transaction_id) between 1 and 100),
  source_kind text not null check (source_kind in ('deposit')),
  global_account_id text,
  provider_reference text,
  statement_reference text,
  direction text not null check (direction in ('credit', 'debit', 'unknown')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  provider_status text not null,
  provider_type text,
  counterparty_name text,
  occurred_at timestamptz,
  is_sandbox_simulation boolean not null default false,
  raw_sanitized jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.sync_runs (id) on delete set null,
  first_synced_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_transaction_id)
);

create index financial_transactions_workspace_occurred_idx
  on public.financial_transactions (workspace_id, occurred_at desc);

alter table public.financial_transactions enable row level security;

create policy "Workspace owners can read transactions"
  on public.financial_transactions for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can import transactions"
  on public.financial_transactions for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can refresh transactions"
  on public.financial_transactions for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Sandbox simulations created by Ledgistry (so their evidence is labelled as such) -----------

create table public.sandbox_simulations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('deposit')),
  provider_object_id text not null,
  global_account_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reference text,
  payer_name text,
  provider_status text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider_object_id)
);

alter table public.sandbox_simulations enable row level security;

create policy "Workspace owners can read simulations"
  on public.sandbox_simulations for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can record simulations"
  on public.sandbox_simulations for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Reconciliation matches -------------------------------------------------------

create table public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  transaction_id uuid not null references public.financial_transactions (id) on delete cascade,
  expected_receipt_id uuid not null references public.expected_receipts (id) on delete cascade,
  match_type text not null check (match_type in ('exact_reference', 'exact_amount', 'partial_amount', 'suggested', 'manual')),
  match_status text not null default 'suggested' check (
    match_status in ('suggested', 'needs_review', 'confirmed', 'rejected', 'reversed', 'superseded')
  ),
  applied_amount_minor bigint check (applied_amount_minor > 0),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  suggested_by text not null default 'rules' check (suggested_by in ('rules', 'operator', 'ai')),
  decision_note text check (char_length(decision_note) <= 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((match_status in ('confirmed', 'reversed')) = (applied_amount_minor is not null))
);

-- At most one live (open or confirmed) match per transaction/receipt pair.
create unique index reconciliation_matches_live_pair_idx
  on public.reconciliation_matches (transaction_id, expected_receipt_id)
  where match_status in ('suggested', 'needs_review', 'confirmed');
create index reconciliation_matches_receipt_idx on public.reconciliation_matches (expected_receipt_id);
create index reconciliation_matches_workspace_status_idx on public.reconciliation_matches (workspace_id, match_status);

-- Invariants for every write path (RPCs and direct API calls alike).
create or replace function private.guard_reconciliation_match()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  txn record;
  receipt record;
  txn_applied bigint;
  receipt_applied bigint;
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id
       or new.transaction_id <> old.transaction_id
       or new.expected_receipt_id <> old.expected_receipt_id
       or new.match_type <> old.match_type then
      raise exception 'A match''s transaction, receipt and type cannot change';
    end if;

    if new.match_status is distinct from old.match_status then
      if not (
        (old.match_status in ('suggested', 'needs_review') and new.match_status in ('confirmed', 'rejected', 'superseded'))
        or (old.match_status = 'confirmed' and new.match_status = 'reversed')
      ) then
        raise exception 'A % match cannot become %', old.match_status, new.match_status;
      end if;
      new.decided_at := now();
      new.decided_by := case when new.match_status = 'superseded' then null else (select auth.uid()) end;
    elsif new.applied_amount_minor is distinct from old.applied_amount_minor then
      raise exception 'Applied amounts change only through a decision';
    end if;

    if old.match_status = 'confirmed' and new.match_status = 'reversed'
       and new.applied_amount_minor is distinct from old.applied_amount_minor then
      raise exception 'A reversal keeps the originally applied amount for the record';
    end if;
    new.updated_at := now();
  else
    if new.match_status not in ('suggested', 'needs_review') or new.applied_amount_minor is not null then
      raise exception 'New matches start as suggestions';
    end if;
  end if;

  -- Lock order everywhere: transaction, then receipt.
  select f.workspace_id, f.currency, f.direction, f.amount_minor, f.provider_status
    into txn from public.financial_transactions f where f.id = new.transaction_id for update;
  if not found then raise exception 'Transaction not found'; end if;
  select r.workspace_id, r.currency, r.expected_amount_minor, r.cancelled_at
    into receipt from public.expected_receipts r where r.id = new.expected_receipt_id for update;
  if not found then raise exception 'Expected receipt not found'; end if;

  if txn.workspace_id <> new.workspace_id or receipt.workspace_id <> new.workspace_id then
    raise exception 'Transaction and receipt must belong to the match''s workspace';
  end if;
  if txn.currency <> receipt.currency then
    raise exception 'A % deposit cannot be applied to a % receipt', txn.currency, receipt.currency;
  end if;
  if txn.direction <> 'credit' then
    raise exception 'Only incoming (credit) transactions can be matched to expected receipts';
  end if;

  if new.match_status = 'confirmed' and (tg_op = 'INSERT' or old.match_status <> 'confirmed') then
    if txn.provider_status <> 'SETTLED' then
      raise exception 'Only settled deposits can be applied (this one is %)', txn.provider_status;
    end if;
    if receipt.cancelled_at is not null then
      raise exception 'Cancelled receipts cannot receive funds';
    end if;
    if new.applied_amount_minor is null or new.applied_amount_minor <= 0 then
      raise exception 'A confirmed match needs a positive applied amount';
    end if;

    select coalesce(sum(m.applied_amount_minor), 0) into txn_applied
      from public.reconciliation_matches m
      where m.transaction_id = new.transaction_id and m.match_status = 'confirmed' and m.id <> new.id;
    if txn_applied + new.applied_amount_minor > txn.amount_minor then
      raise exception 'This would apply more than the deposit amount';
    end if;

    select coalesce(sum(m.applied_amount_minor), 0) into receipt_applied
      from public.reconciliation_matches m
      where m.expected_receipt_id = new.expected_receipt_id and m.match_status = 'confirmed' and m.id <> new.id;
    if receipt_applied + new.applied_amount_minor > receipt.expected_amount_minor then
      raise exception 'This would receive more than the expected amount';
    end if;
  end if;

  return new;
end;
$$;

create trigger reconciliation_matches_guard
  before insert or update on public.reconciliation_matches
  for each row execute function private.guard_reconciliation_match();

alter table public.reconciliation_matches enable row level security;

create policy "Workspace owners can read matches"
  on public.reconciliation_matches for select to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can propose matches"
  on public.reconciliation_matches for insert to authenticated
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

create policy "Workspace owners can decide matches"
  on public.reconciliation_matches for update to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_user_id = (select auth.uid())));

-- Receipt edits must respect funds already applied; material edits retire open suggestions.
create or replace function private.guard_expected_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  applied bigint;
begin
  if new.workspace_id <> old.workspace_id then
    raise exception 'Expected receipts cannot move between workspaces';
  end if;

  select coalesce(sum(m.applied_amount_minor), 0) into applied
    from public.reconciliation_matches m
    where m.expected_receipt_id = old.id and m.match_status = 'confirmed';

  if applied > 0 then
    if new.currency <> old.currency then
      raise exception 'The currency cannot change after funds were applied';
    end if;
    if new.expected_amount_minor < applied then
      raise exception 'The expected amount cannot be lower than the % already received',
        private.format_minor(applied, old.currency);
    end if;
    if new.cancelled_at is not null and old.cancelled_at is null then
      raise exception 'Reverse the confirmed matches before cancelling this receipt';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger expected_receipts_guard
  before update on public.expected_receipts
  for each row execute function private.guard_expected_receipt();

create or replace function private.retire_stale_receipt_suggestions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payer_name is distinct from old.payer_name
     or new.reference is distinct from old.reference
     or new.expected_amount_minor is distinct from old.expected_amount_minor
     or new.currency is distinct from old.currency
     or new.expected_date is distinct from old.expected_date
     or new.cancelled_at is distinct from old.cancelled_at
     or new.archived_at is distinct from old.archived_at then
    update public.reconciliation_matches m
      set match_status = 'superseded'
      where m.expected_receipt_id = new.id and m.match_status in ('suggested', 'needs_review');
  end if;
  return null;
end;
$$;

create trigger expected_receipts_retire_suggestions
  after update on public.expected_receipts
  for each row execute function private.retire_stale_receipt_suggestions();

-- Derived progress views (RLS of the underlying tables applies) ------------------

create view public.expected_receipt_progress with (security_invoker = true) as
select
  r.*,
  coalesce(sum(m.applied_amount_minor) filter (where m.match_status = 'confirmed'), 0)::bigint as received_amount_minor,
  (r.expected_amount_minor
    - coalesce(sum(m.applied_amount_minor) filter (where m.match_status = 'confirmed'), 0))::bigint as outstanding_amount_minor,
  count(m.id) filter (where m.match_status = 'suggested')::integer as open_suggestion_count,
  count(m.id) filter (where m.match_status = 'needs_review')::integer as open_review_count
from public.expected_receipts r
left join public.reconciliation_matches m on m.expected_receipt_id = r.id
group by r.id;

create view public.transaction_application with (security_invoker = true) as
select
  t.*,
  coalesce(sum(m.applied_amount_minor) filter (where m.match_status = 'confirmed'), 0)::bigint as applied_amount_minor,
  (t.amount_minor
    - coalesce(sum(m.applied_amount_minor) filter (where m.match_status = 'confirmed'), 0))::bigint as unapplied_amount_minor,
  count(m.id) filter (where m.match_status = 'suggested')::integer as open_suggestion_count,
  count(m.id) filter (where m.match_status = 'needs_review')::integer as open_review_count
from public.financial_transactions t
left join public.reconciliation_matches m on m.transaction_id = t.id
group by t.id;

-- RPCs -------------------------------------------------------------------------

-- Idempotent import: inserts new evidence, refreshes mutable provider fields, never touches
-- amount or currency of an existing transaction.
create or replace function public.upsert_provider_transactions(
  p_workspace_id uuid,
  p_sync_run_id uuid,
  p_rows jsonb
)
returns table (transaction_id uuid, external_id text, inserted boolean, status_changed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with input as (
    select *
    from jsonb_to_recordset(p_rows) as x(
      provider_transaction_id text,
      source_kind text,
      global_account_id text,
      provider_reference text,
      statement_reference text,
      direction text,
      amount_minor bigint,
      currency text,
      provider_status text,
      provider_type text,
      counterparty_name text,
      occurred_at timestamptz,
      is_sandbox_simulation boolean,
      raw_sanitized jsonb
    )
  ),
  prior as (
    select f.provider_transaction_id, f.provider_status
    from public.financial_transactions f
    where f.workspace_id = p_workspace_id
      and f.provider = 'airwallex'
      and f.provider_transaction_id in (select i.provider_transaction_id from input i)
  ),
  upserted as (
    insert into public.financial_transactions as f (
      workspace_id, provider, provider_transaction_id, source_kind, global_account_id,
      provider_reference, statement_reference, direction, amount_minor, currency,
      provider_status, provider_type, counterparty_name, occurred_at, is_sandbox_simulation,
      raw_sanitized, sync_run_id
    )
    select
      p_workspace_id, 'airwallex', i.provider_transaction_id, i.source_kind, i.global_account_id,
      i.provider_reference, i.statement_reference, i.direction, i.amount_minor, i.currency,
      i.provider_status, i.provider_type, i.counterparty_name, i.occurred_at,
      coalesce(i.is_sandbox_simulation, false), coalesce(i.raw_sanitized, '{}'::jsonb), p_sync_run_id
    from input i
    on conflict (workspace_id, provider, provider_transaction_id) do update set
      provider_status = excluded.provider_status,
      provider_reference = excluded.provider_reference,
      statement_reference = excluded.statement_reference,
      provider_type = excluded.provider_type,
      counterparty_name = excluded.counterparty_name,
      occurred_at = excluded.occurred_at,
      is_sandbox_simulation = f.is_sandbox_simulation or excluded.is_sandbox_simulation,
      raw_sanitized = excluded.raw_sanitized,
      sync_run_id = excluded.sync_run_id,
      last_synced_at = now()
    returning f.id, f.provider_transaction_id, (f.xmax = 0) as was_inserted, f.provider_status
  )
  select
    u.id,
    u.provider_transaction_id,
    u.was_inserted,
    coalesce(p.provider_status is distinct from u.provider_status, false) and not u.was_inserted
  from upserted u
  left join prior p on p.provider_transaction_id = u.provider_transaction_id;
end;
$$;

create or replace function public.confirm_reconciliation_match(p_match_id uuid, p_note text default null)
returns public.reconciliation_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m public.reconciliation_matches;
  txn public.financial_transactions;
  receipt public.expected_receipts;
  txn_applied bigint;
  receipt_applied bigint;
  amount bigint;
  outstanding_after bigint;
begin
  select * into m from public.reconciliation_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.match_status not in ('suggested', 'needs_review') then
    raise exception 'This match was already % and cannot be confirmed', m.match_status;
  end if;

  select * into txn from public.financial_transactions where id = m.transaction_id for update;
  select * into receipt from public.expected_receipts where id = m.expected_receipt_id for update;

  select coalesce(sum(x.applied_amount_minor), 0) into txn_applied
    from public.reconciliation_matches x where x.transaction_id = txn.id and x.match_status = 'confirmed';
  select coalesce(sum(x.applied_amount_minor), 0) into receipt_applied
    from public.reconciliation_matches x where x.expected_receipt_id = receipt.id and x.match_status = 'confirmed';

  amount := least(txn.amount_minor - txn_applied, receipt.expected_amount_minor - receipt_applied);
  if amount <= 0 then
    raise exception 'Nothing left to apply: the deposit or the receipt is already fully matched';
  end if;

  update public.reconciliation_matches
    set match_status = 'confirmed', applied_amount_minor = amount, decision_note = p_note
    where id = m.id
    returning * into m;

  if txn_applied + amount >= txn.amount_minor then
    update public.reconciliation_matches x set match_status = 'superseded'
      where x.transaction_id = txn.id and x.match_status in ('suggested', 'needs_review');
  end if;
  if receipt_applied + amount >= receipt.expected_amount_minor then
    update public.reconciliation_matches x set match_status = 'superseded'
      where x.expected_receipt_id = receipt.id and x.match_status in ('suggested', 'needs_review');
  end if;

  outstanding_after := receipt.expected_amount_minor - receipt_applied - amount;
  insert into public.audit_events (
    workspace_id, actor_type, actor_user_id, event_type, entity_type, entity_id, outcome, summary, metadata
  ) values (
    m.workspace_id, 'user', (select auth.uid()), 'reconciliation.match_confirmed', 'reconciliation_match', m.id::text,
    'success',
    left(format(
      'Applied %s from %s to receipt %s (%s)%s',
      private.format_minor(amount, txn.currency),
      coalesce(txn.counterparty_name, 'deposit'),
      receipt.reference,
      receipt.payer_name,
      case when outstanding_after > 0
        then format(' — %s still outstanding', private.format_minor(outstanding_after, receipt.currency))
        else ' — receipt fully received'
      end
    ), 500),
    jsonb_build_object(
      'transaction_id', txn.id,
      'expected_receipt_id', receipt.id,
      'applied_amount_minor', amount,
      'outstanding_after_minor', outstanding_after,
      'currency', txn.currency,
      'match_type', m.match_type,
      'suggested_by', m.suggested_by
    )
  );

  return m;
end;
$$;

create or replace function public.reject_reconciliation_match(p_match_id uuid, p_note text default null)
returns public.reconciliation_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m public.reconciliation_matches;
  receipt_ref text;
begin
  update public.reconciliation_matches
    set match_status = 'rejected', decision_note = p_note
    where id = p_match_id and match_status in ('suggested', 'needs_review')
    returning * into m;
  if not found then
    raise exception 'This match is no longer open for review';
  end if;

  select r.reference into receipt_ref from public.expected_receipts r where r.id = m.expected_receipt_id;
  insert into public.audit_events (
    workspace_id, actor_type, actor_user_id, event_type, entity_type, entity_id, outcome, summary, metadata
  ) values (
    m.workspace_id, 'user', (select auth.uid()), 'reconciliation.match_rejected', 'reconciliation_match', m.id::text,
    'info',
    left(format('Rejected suggested match to receipt %s', receipt_ref), 500),
    jsonb_build_object('transaction_id', m.transaction_id, 'expected_receipt_id', m.expected_receipt_id,
      'match_type', m.match_type, 'note', p_note)
  );
  return m;
end;
$$;

create or replace function public.reverse_reconciliation_match(p_match_id uuid, p_note text default null)
returns public.reconciliation_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m public.reconciliation_matches;
  receipt public.expected_receipts;
begin
  update public.reconciliation_matches
    set match_status = 'reversed', decision_note = p_note
    where id = p_match_id and match_status = 'confirmed'
    returning * into m;
  if not found then
    raise exception 'Only confirmed matches can be reversed';
  end if;

  select * into receipt from public.expected_receipts r where r.id = m.expected_receipt_id;
  insert into public.audit_events (
    workspace_id, actor_type, actor_user_id, event_type, entity_type, entity_id, outcome, summary, metadata
  ) values (
    m.workspace_id, 'user', (select auth.uid()), 'reconciliation.match_reversed', 'reconciliation_match', m.id::text,
    'info',
    left(format('Reversed %s applied to receipt %s (%s)',
      private.format_minor(m.applied_amount_minor, receipt.currency), receipt.reference, receipt.payer_name), 500),
    jsonb_build_object('transaction_id', m.transaction_id, 'expected_receipt_id', m.expected_receipt_id,
      'reversed_amount_minor', m.applied_amount_minor, 'currency', receipt.currency, 'note', p_note)
  );
  return m;
end;
$$;

-- Operator-chosen association, created and confirmed atomically.
create or replace function public.create_manual_match(
  p_transaction_id uuid,
  p_expected_receipt_id uuid,
  p_note text default null
)
returns public.reconciliation_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ws uuid;
  match_id uuid;
begin
  select f.workspace_id into ws from public.financial_transactions f where f.id = p_transaction_id;
  if not found then
    raise exception 'Transaction not found';
  end if;

  select m.id into match_id
    from public.reconciliation_matches m
    where m.transaction_id = p_transaction_id
      and m.expected_receipt_id = p_expected_receipt_id
      and m.match_status in ('suggested', 'needs_review', 'confirmed');

  if match_id is null then
    insert into public.reconciliation_matches (
      workspace_id, transaction_id, expected_receipt_id, match_type, match_status, suggested_by, evidence
    ) values (
      ws, p_transaction_id, p_expected_receipt_id, 'manual', 'needs_review', 'operator',
      jsonb_build_object('signals', jsonb_build_array(), 'explanation', 'Linked manually by the operator.')
    )
    returning id into match_id;
  end if;

  return public.confirm_reconciliation_match(match_id, p_note);
end;
$$;

-- Privileges ---------------------------------------------------------------------

revoke all on public.obligations, public.expected_receipts, public.financial_transactions,
  public.sandbox_simulations, public.reconciliation_matches,
  public.expected_receipt_progress, public.transaction_application
  from anon, authenticated;

grant select, insert on public.obligations to authenticated;
grant update (payee_name, description, invoice_reference, amount_minor, currency, due_date, priority, status,
  allow_partial_payment, beneficiary_id, beneficiary_label, notes, archived_at) on public.obligations to authenticated;

grant select, insert on public.expected_receipts to authenticated;
grant update (payer_name, reference, expected_amount_minor, currency, expected_date, notes, cancelled_at, archived_at)
  on public.expected_receipts to authenticated;

grant select, insert on public.financial_transactions to authenticated;
grant update (provider_status, provider_reference, statement_reference, provider_type, counterparty_name,
  occurred_at, is_sandbox_simulation, raw_sanitized, sync_run_id, last_synced_at)
  on public.financial_transactions to authenticated;

grant select, insert on public.sandbox_simulations to authenticated;

grant select, insert on public.reconciliation_matches to authenticated;
grant update (match_status, applied_amount_minor, decision_note) on public.reconciliation_matches to authenticated;

grant select on public.expected_receipt_progress, public.transaction_application to authenticated;

revoke execute on function
  public.upsert_provider_transactions(uuid, uuid, jsonb),
  public.confirm_reconciliation_match(uuid, text),
  public.reject_reconciliation_match(uuid, text),
  public.reverse_reconciliation_match(uuid, text),
  public.create_manual_match(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.upsert_provider_transactions(uuid, uuid, jsonb),
  public.confirm_reconciliation_match(uuid, text),
  public.reject_reconciliation_match(uuid, text),
  public.reverse_reconciliation_match(uuid, text),
  public.create_manual_match(uuid, uuid, text)
  to authenticated;

revoke execute on function
  private.guard_obligation(),
  private.guard_reconciliation_match(),
  private.guard_expected_receipt(),
  private.retire_stale_receipt_suggestions()
  from public, anon, authenticated;
