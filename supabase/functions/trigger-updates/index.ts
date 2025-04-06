/**
 * Runs as a cron
 * Fetches all domains and users
 * Then calls the domain-updater function for eligible each domain
 * Logs responses, and returns a summary response
 */

import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Keys
const DB_URL = Deno.env.get('DB_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

if (!DB_URL || !DB_KEY) {
  throw new Error('❌ Database URL and Key must be provided.');
}
const DOMAIN_UPDATER_URL = Deno.env.get('WORKER_DOMAIN_UPDATER_URL') ?? `${DB_URL}/functions/v1/domain-updater`;

// Initialize Supabase client with superuser privileges to bypass RLS
const supabase = createClient(
  DB_URL,
  DB_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

// Helper function to call the domain updater for a specific domain and user
async function updateDomainForUser(domain: string, userId: string) {
  try {
    const response = await fetch(DOMAIN_UPDATER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain, user_id: userId }),
    });

    // Logging the response
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
async function processAllDomains() {
  // Start time
  const startTime = performance.now();
  // Fetch all user_id and domain_name pairs from the domains table
  const { data: domains, error } = await supabase
    .from('domains')
    .select('user_id, domain_name');

  if (error || !domains) {
    console.error('Error fetching domains:', error?.message);
    return new Response('Error fetching domains', { status: 500 });
  }

  // Call the domain-updater function for each (user_id, domain_name) pair
  for (const domain of domains) {
    await updateDomainForUser(domain.domain_name, domain.user_id);
  }

  const processedCount = domains.length;
  const endTime = performance.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);
  return new Response(`✅ ${processedCount} domains processed successfully in ${duration} seconds`, { status: 200 });
}

// Supabase serverless function handler
serve(async () => {
  try {
    return await processAllDomains();
  } catch (error) {
    console.error('Unexpected error:', (error as Error).message);
    return new Response('Internal Server Error', { status: 500 });
  }
});
