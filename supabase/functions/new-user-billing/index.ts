import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Load environment variables
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';
const SPONSORS_API = Deno.env.get('AS93_SPONSORS_API') ?? '';
const NOTIFICATION_URL = Deno.env.get('WORKER_SEND_NOTIFICATION_URL') ?? `${DB_URL}/functions/v1/send-notification`;

// Ensure required env variables are set
if (!DB_URL || !DB_KEY) throw new Error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');

// Initialize Supabase client (service role for RLS bypass)
const supabase = createClient(DB_URL, DB_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

/**
 * Fetches the list of GitHub sponsors.
 */
async function fetchGitHubSponsors(): Promise<Set<string>> {
  if (!SPONSORS_API) return new Set();

  try {
    const res = await fetch(`${SPONSORS_API}/lissy93`);
    if (!res.ok) throw new Error('Failed to fetch GitHub sponsors');

    const sponsors = await res.json();
    return new Set(sponsors.map((s: { login: string }) => s.login.toLowerCase()));
  } catch (err) {
    console.error('❌ Error fetching GitHub sponsors:', err);
    return new Set();
  }
}

/**
 * Waits for the user to be available in Supabase Auth.
 * Prevents race conditions where the user might not yet be saved.
 */
async function waitForUser(userId: string, retries = 5, delayMs = 2000): Promise<any | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (!error && data?.user) return data.user;

    console.warn(`⏳ User ${userId} not found yet. Retry ${attempt}/${retries}...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.error(`❌ User ${userId} not found after ${retries} retries.`);
  return null;
}

/**
 * Placeholder for checking Stripe billing.
 * Returns a paid plan if a valid subscription exists.
 */
async function stripeBillingCheck(userId: string): Promise<string | null> {
  // TODO: Implement actual Stripe integration
  return null; // Returns null if no active Stripe subscription
}

/**
 * Determines the correct billing plan for a user.
 * Prioritizes Stripe subscriptions over GitHub sponsorships.
 */
async function determineBillingPlan(userId: string): Promise<string> {
  const user = await waitForUser(userId);
  if (!user) return 'free';

  // First, check if the user has an active Stripe subscription
  const stripePlan = await stripeBillingCheck(userId);
  if (stripePlan) return stripePlan;

  // Then, check if they are a GitHub sponsor
  const githubUsername = user.user_metadata?.user_name ?? user.user_metadata?.github_username;
  if (!githubUsername || user.app_metadata?.provider !== 'github') return 'free';

  const sponsors = await fetchGitHubSponsors();
  return sponsors.has(githubUsername.toLowerCase()) ? 'sponsor' : 'free';
}

/**
 * Ensures the user has a billing entry with the correct plan.
 */
async function setupUserBilling(userId: string) {
  try {
    // Fetch existing billing record
    const { data: existing, error } = await supabase
      .from('billing')
      .select('current_plan')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // Ignore "no rows found" errors
    if (existing?.current_plan && existing.current_plan !== 'free') return; // Skip if user has a paid plan

    // Determine the correct plan
    const plan = await determineBillingPlan(userId);
    if (!plan) return;

    // Send notification if plan changes
    if (plan !== 'free' && plan !== existing?.current_plan) {
      await fetch(NOTIFICATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: `You've been upgraded to the ${plan} plan! 🎉` }),
      }).catch((err) => console.error('❌ Error sending notification:', err));
    }

    // Upsert billing entry
    await supabase.from('billing').upsert(
      { user_id: userId, current_plan: plan, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

    console.info(`✅ User ${userId} set up on ${plan} plan`);
  } catch (err) {
    console.error('❌ Error setting up billing:', err);
  }
}

/**
 * Supabase Edge Function: Handles user signup events and manual re-checks.
 */
serve(async (req) => {
  try {
    const body = await req.json();

    // Extract user ID from different possible payload formats
    const userId = body.user?.id || body.userId || body.user_id;
    if (!userId) {
      console.error('❌ Invalid webhook payload:', body);
      return new Response(JSON.stringify({ error: 'User ID is required' }), { status: 400 });
    }

    await setupUserBilling(userId);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
});
