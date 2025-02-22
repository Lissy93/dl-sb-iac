import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Load environment variables
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';
const SPONSORS_API = Deno.env.get('AS93_SPONSORS_API') ?? '';

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
    console.error('❌ Error fetching sponsors:', err);
    return new Set();
  }
}

/**
 * Determines the correct billing plan for a user.
 */
async function determineBillingPlan(userId: string): Promise<string> {
  const { data: user, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !user?.user) return 'free';

  const githubUsername = user.user.user_metadata?.user_name ?? user.user.user_metadata?.github_username;
  if (!githubUsername || user.user.app_metadata?.provider !== 'github') return 'free';

  const sponsors = await fetchGitHubSponsors();
  return sponsors.has(githubUsername.toLowerCase()) ? 'sponsor' : 'free';
}

/**
 * Ensures the user has a billing entry with the correct plan.
 */
async function setupUserBilling(userId: string) {
  try {
    // Check if user already has a non-free billing record
    const { data: existing, error } = await supabase
      .from('billing')
      .select('current_plan')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // Ignore "no rows found"
    if (existing?.current_plan && existing.current_plan !== 'free') return;

    const plan = await determineBillingPlan(userId);

    await supabase.from('billing').upsert(
      { user_id: userId, current_plan: plan, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

    console.info(`✅ User ${userId} set up on ${plan} plan`);
  } catch (err) {
    console.error('❌ Error setting up billing:', err);
  }
}

// Supabase Edge Function: Handles user signup events
serve(async (req) => {
  try {
    const { userId, user_id } = await req.json();
    if (!userId && !user_id) return new Response(JSON.stringify({ error: 'User ID is required' }), { status: 400 });

    await setupUserBilling(userId || user_id);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
});
