-- Fix: Allow jobs to be re-enqueued after completion/failure
--
-- This fixes the issue whereby the original enqueue_stale_domain_jobs() func
-- used "ON CONFLICT DO NOTHING", preventing jobs from being re-queued for later.
-- Only resets jobs that are 'complete' or 'failed', not 'in_progress'
create or replace function public.enqueue_stale_domain_jobs()
returns void
language sql
security definer
as $$
  insert into public.domain_update_jobs (domain, user_id)
  select domain_name, user_id
  from public.domains
  where updated_at < now() - interval '24 hours'
  on conflict (domain) do update set
    status = 'queued',
    inserted_at = now()
  where domain_update_jobs.status in ('complete', 'failed');
$$;
