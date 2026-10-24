-- A sandbox simulation is read back from Airwallex's transfer-detail endpoint, so it counts as
-- a verification too (last_verified_at).
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
    last_verified_at = case when p_source in ('verify', 'lookup', 'simulation') then now() else op.last_verified_at end,
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

revoke execute on function public.record_payment_progress(uuid, text, text, text, bigint, text, text, text, text) from public, anon;
grant execute on function public.record_payment_progress(uuid, text, text, text, bigint, text, text, text, text) to authenticated;
