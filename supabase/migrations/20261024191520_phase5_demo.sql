-- Phase 5: demo data and the reconciliation start date.

-- Deposits created before this moment are not imported, like a bank feed's start date. Loading or
-- resetting demo data sets it, so a demo starts from the deposits made during the demo only.
alter table public.workspaces add column reconciliation_start_at timestamptz;
comment on column public.workspaces.reconciliation_start_at is
  'Deposits created before this moment are not imported as reconciliation evidence (null: last 90 days).';
grant update (reconciliation_start_at) on public.workspaces to authenticated;

-- Demo records load idempotently: at most one active sample record per payee / reference.
create unique index obligations_active_demo_payee_idx
  on public.obligations (workspace_id, payee_name)
  where is_demo and archived_at is null;

create unique index expected_receipts_active_demo_reference_idx
  on public.expected_receipts (workspace_id, reference)
  where is_demo and archived_at is null;
