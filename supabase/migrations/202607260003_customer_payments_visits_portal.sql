-- Canonical customer Payments & Visits portal payload.
-- Uses the same jobs, visits, tasks, agreements, cycles, and billing events used by operations.
begin;

create or replace function public.get_customer_payments_visits_portal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_result jsonb;
begin
  v_customer_id := public.link_current_customer_account();

  if v_customer_id is null then
    return jsonb_build_object(
      'upcomingVisits', '[]'::jsonb,
      'visitHistory', '[]'::jsonb,
      'agreements', '[]'::jsonb,
      'billingCycles', '[]'::jsonb,
      'billingEvents', '[]'::jsonb,
      'openTasks', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'upcomingVisits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'jobId', v.job_id,
        'serviceName', coalesce(j.service_name, 'Service Visit'),
        'scheduledDate', v.scheduled_date,
        'status', v.status::text,
        'address', p.address_line1,
        'city', p.city,
        'crewName', cr.name,
        'routeOrder', v.route_order
      ) order by v.scheduled_date asc, v.route_order asc nulls last)
      from public.visits v
      left join public.jobs j on j.id = v.job_id
      left join public.properties p on p.id = v.property_id
      left join public.crews cr on cr.id = v.crew_id
      where v.customer_id = v_customer_id
        and v.scheduled_date >= current_date
        and v.status::text not in ('cancelled','missed','done','completed')
    ), '[]'::jsonb),
    'visitHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'jobId', v.job_id,
        'serviceName', coalesce(j.service_name, 'Service Visit'),
        'scheduledDate', v.scheduled_date,
        'status', v.status::text,
        'address', p.address_line1,
        'finishedAt', v.finished_at,
        'customerVisibleSummary', v.customer_visible_summary,
        'feedbackRating', f.rating,
        'feedbackComment', f.comment
      ) order by coalesce(v.finished_at, v.created_at) desc)
      from public.visits v
      left join public.jobs j on j.id = v.job_id
      left join public.properties p on p.id = v.property_id
      left join lateral (
        select fb.rating, fb.comment
        from public.feedback fb
        where fb.visit_id = v.id
        order by fb.created_at desc
        limit 1
      ) f on true
      where v.customer_id = v_customer_id
        and (
          v.finished_at is not null
          or v.status::text in ('done','completed','cancelled','missed')
          or v.scheduled_date < current_date
        )
    ), '[]'::jsonb),
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ba.id,
        'jobId', ba.job_id,
        'billingModel', ba.billing_model,
        'collectionTiming', ba.collection_timing,
        'customerOrigin', ba.customer_origin,
        'contractStartsOn', ba.contract_starts_on,
        'contractEndsOn', ba.contract_ends_on,
        'feedbackWindowHours', ba.feedback_window_hours,
        'prepaidPlanType', ba.prepaid_plan_type,
        'planBillingDay', ba.plan_billing_day,
        'serviceStartDay', ba.service_start_day,
        'active', ba.active,
        'serviceFrequency', j.service_frequency,
        'serviceName', coalesce(j.service_name, 'Service Plan')
      ) order by ba.active desc, ba.created_at desc)
      from public.billing_agreements ba
      join public.jobs j on j.id = ba.job_id
      where ba.customer_id = v_customer_id
    ), '[]'::jsonb),
    'billingCycles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', bc.id,
        'agreementId', bc.billing_agreement_id,
        'cycleType', bc.cycle_type,
        'periodStartsOn', bc.period_starts_on,
        'periodEndsOn', bc.period_ends_on,
        'chargeDueOn', bc.charge_due_on,
        'serviceAvailableOn', bc.service_available_on,
        'state', bc.state,
        'paidAt', bc.paid_at
      ) order by bc.period_starts_on desc)
      from public.billing_cycles bc
      where bc.customer_id = v_customer_id
    ), '[]'::jsonb),
    'billingEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', be.id,
        'visitId', be.visit_id,
        'state', be.state,
        'visitCompletedAt', be.visit_completed_at,
        'feedbackDeadlineAt', be.feedback_deadline_at,
        'reopenedFeedbackDeadlineAt', be.reopened_feedback_deadline_at,
        'eligibleToChargeAt', be.eligible_to_charge_at,
        'chargedAt', be.charged_at,
        'transferredAt', be.transferred_at,
        'activeTaskId', be.active_task_id
      ) order by be.created_at desc)
      from public.visit_billing_events be
      where be.customer_id = v_customer_id
    ), '[]'::jsonb),
    'openTasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'visitId', t.visit_id,
        'title', t.title,
        'status', t.status::text,
        'priority', t.priority::text,
        'createdAt', t.created_at,
        'resolvedAt', t.resolved_at
      ) order by t.created_at desc)
      from public.tasks t
      where t.customer_id = v_customer_id
        and t.status::text not in ('completed','resolved','cancelled')
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_customer_payments_visits_portal() from public, anon;
grant execute on function public.get_customer_payments_visits_portal() to authenticated;

commit;
