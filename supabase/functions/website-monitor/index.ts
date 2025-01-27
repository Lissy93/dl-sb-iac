import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.140.0/http/server.ts';

// Environment variables
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';
const TIMEOUT = 5000; // Timeout in milliseconds

// Initialize Supabase client
const supabase = createClient(DB_URL, DB_KEY, {
  global: {
    headers: {
      Authorization: `Bearer ${DB_KEY}`,
    },
  },
});

// TypeScript interfaces
interface Domain {
  id: string;
  domain_name: string;
  user_id: string;
}

interface HealthCheckResult {
  id: string;
  isUp: boolean;
  responseCode: number | null;
  responseTimeMs: number | null;
  dnsTimeMs: number | null;
  sslTimeMs: number | null;
}

interface Billing {
  user_id: string;
}

// Helper function to perform HTTP requests with timeout
import { performance } from 'https://deno.land/std@0.140.0/node/perf_hooks.ts';

async function checkDomainHealth(domain: string): Promise<Omit<HealthCheckResult, 'id'> & { dnsTimeMs: number | null; sslTimeMs: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  let dnsTimeMs = null;
  let sslTimeMs = null;

  try {
    const start = performance.now();

    const dnsStart = performance.now();
    await Deno.resolveDns(domain, 'A');
    dnsTimeMs = performance.now() - dnsStart;

    const response = await fetch(`https://${domain}`, { signal: controller.signal });

    const sslStart = performance.now();
    if (response.url.startsWith('https://')) {
      await fetch(response.url, { signal: controller.signal });
    }
    sslTimeMs = performance.now() - sslStart;

    const responseTime = performance.now() - start;
    clearTimeout(timeout);

    return {
      isUp: response.ok,
      responseCode: response.status,
      responseTimeMs: responseTime,
      dnsTimeMs,
      sslTimeMs,
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`Timeout reached while checking domain: ${domain}`);
    } else {
      console.error(`Unexpected error while checking domain ${domain}:`, error);
    }
    return {
      isUp: false,
      responseCode: null,
      responseTimeMs: null,
      dnsTimeMs,
      sslTimeMs,
    };
  }
}


serve(async () => {
  try {
    // Step 1: Fetch all domains owned by users on the "pro" plan
    const billingResponse = await supabase
      .from('billing')
      .select('user_id')
      .eq('current_plan', 'pro');

    if (billingResponse.error) {
      console.error('Error fetching billing data:', billingResponse.error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch billing data' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userIds = (billingResponse.data ?? []).map((billing: Billing) => billing.user_id);

    if (userIds.length === 0) {
      console.log('No pro users found.');
      return new Response(
        JSON.stringify({ message: 'No pro users to process' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    const domainResponse = await supabase
      .from('domains')
      .select('id, domain_name, user_id')
      .in('user_id', userIds);

    if (domainResponse.error) {
      console.error('Error fetching domains:', domainResponse.error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch domains' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const domains = domainResponse.data as Domain[];

    if (domains.length === 0) {
      console.log('No domains found for pro users.');
      return new Response(
        JSON.stringify({ message: 'No domains to process' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Iterate over domains and check health
    const results: HealthCheckResult[] = await Promise.all(
      domains.map(async ({ id, domain_name }) => {
        const health = await checkDomainHealth(domain_name);
        return { id, ...health };
      })
    );

    // Step 3: Insert results into uptime table
    const insertResponse = await supabase
      .from('uptime')
      .insert(
        results.map(({ id, isUp, responseCode, responseTimeMs, dnsTimeMs, sslTimeMs }) => ({
          domain_id: id,
          is_up: isUp,
          response_code: responseCode,
          response_time_ms: responseTimeMs,
          dns_lookup_time_ms: dnsTimeMs,
          ssl_handshake_time_ms: sslTimeMs,
        }))
      );

    if (insertResponse.error) {
      console.error('Error inserting uptime data:', insertResponse.error);
      return new Response(
        JSON.stringify({ error: 'Failed to insert uptime data' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ message: 'Uptime data collected successfully' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in uptime function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
