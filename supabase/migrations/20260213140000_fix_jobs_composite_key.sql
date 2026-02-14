-- Fix: Change primary key to support multiple users tracking the same domain

-- Drop existing primary key
alter table public.domain_update_jobs
  drop constraint domain_update_jobs_pkey;

-- Add composite primary key
alter table public.domain_update_jobs
  add primary key (domain, user_id);

-- Update the enqueue function to create jobs for all user-domain pairs
create or replace function public.enqueue_stale_domain_jobs()
returns void
language sql
security definer
as $$
  insert into public.domain_update_jobs (domain, user_id)
  select domain_name, user_id
  from public.domains
  where updated_at < now() - interval '24 hours'
  on conflict (domain, user_id) do update set
    status = 'queued',
    inserted_at = now()
  where domain_update_jobs.status in ('complete', 'failed');
$$;
