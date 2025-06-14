/**
 * Runs as a cron
 * Fetches all domains and users
 * Then calls the domain-updater function for eligible each domain
 * Logs responses, and returns a summary response
 */

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { getSupabaseClient } from '../shared/supabaseClient.ts';
import { Monitor } from '../shared/monitor.ts';

// Keys
const DB_URL = Deno.env.get('DB_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const monitor = new Monitor('trigger-updates');

if (!DB_URL) {
  throw new Error('❌ Database URL and Key must be provided.');
}
const DOMAIN_UPDATER_URL = Deno.env.get('WORKER_DOMAIN_UPDATER_URL') ?? `${DB_URL}/functions/v1/domain-updater`;

// Helper function to call the domain updater for a specific domain and user
async function updateDomainForUser(domain: string, userId: string, req: Request) {
  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    const response = await fetch(DOMAIN_UPDATER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({ domain, user_id: userId }),
    });

    const responseBody = await response.json();
    console.info(responseBody.message);

    if (responseBody.error) {
      console.error('❌', responseBody.error);
    } else if (!response.ok) {
      console.error('❌', response.statusText);
    }
  } catch (error) {
    console.error('❌', (error as Error).message);
  }
}

// Main function to fetch all domains and update each domain for its user
async function processAllDomains(req: any) {
  const supabase = getSupabaseClient(req);
  // Start time
  const startTime = performance.now();
  // Fetch all user_id and domain_name pairs from the domains table
  const { data: domains, error } = await supabase
    .from('domains')
    .select('user_id, domain_name');

  if (error || !domains) {
    console.error('Error fetching domains:', error?.message);
    throw new Error('Error fetching domains');
  }

  // Call the domain-updater function for each (user_id, domain_name) pair
  for (const domain of domains) {
    await updateDomainForUser(domain.domain_name, domain.user_id, req);
  }

  const processedCount = domains.length;
  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);
  return `✅ ${processedCount} domains processed successfully in ${duration} seconds`;
}

// Supabase serverless function handler
serve(async (req) => {
  await monitor.start();
  try {
    const result = await processAllDomains(req);
    await monitor.success(result);
    return new Response(result, { status: 200 });
  } catch (error) {
    await monitor.fail(error);
    console.error('Unexpected error:', (error as Error).message);
    return new Response('Internal Server Error', { status: 500 });
  }
});
