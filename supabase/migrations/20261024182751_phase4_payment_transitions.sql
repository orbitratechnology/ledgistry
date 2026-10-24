-- Airwallex can still fail a PAID transfer, a FAILED transfer becomes CANCELLED, and a create
-- response may already carry a pending/paid/failed status. Widen the guard accordingly.
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
      when 'prepared' then array['submitted', 'pending', 'completed', 'failed', 'cancelled', 'verification_required', 'unknown']
      when 'submitted' then array['pending', 'completed', 'failed', 'cancelled', 'verification_required', 'unknown']
      when 'verification_required' then array['submitted', 'pending', 'completed', 'failed', 'cancelled', 'unknown']
      when 'pending' then array['completed', 'failed', 'cancelled', 'verification_required', 'unknown']
      when 'unknown' then array['pending', 'completed', 'failed', 'cancelled', 'verification_required']
      when 'completed' then array['failed', 'cancelled']
      when 'failed' then array['cancelled']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'A % payment cannot become %', old.status, new.status;
    end if;
    if new.status in ('completed', 'failed', 'cancelled', 'pending') and new.provider_transfer_id is null
       and old.provider_transfer_id is null and new.status <> 'failed' then
      raise exception 'A provider status needs the provider transfer id';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.guard_payment_operation() from public, anon, authenticated;
