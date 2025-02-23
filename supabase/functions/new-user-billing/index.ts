import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Load environment variables
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';
const AS93_SPONSORS_API = Deno.env.get('AS93_SPONSORS_API') ?? '';

const supabase = createClient(DB_URL, DB_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * Fetches GitHub sponsors from the API.
 */
async function fetchGitHubSponsors(): Promise<string[]> {
  if (!AS93_SPONSORS_API) {
    console.warn('⚠️ GitHub Sponsors API is not set, skipping sponsorship checks.');
    return [];
  }

  try {
    const response = await fetch(`${AS93_SPONSORS_API}/lissy93`);
    if (!response.ok) throw new Error('Failed to fetch GitHub sponsors');

    const sponsors = await response.json();
    return sponsors.map((sponsor: { login: string }) => sponsor.login);
  } catch (error) {
    console.error('❌ Error fetching GitHub sponsors:', error);
    return [];
  }
}

/**
 * Determines the correct billing plan for a new user.
 */
async function determineBillingPlan(userId: string): Promise<string> {
  const { data: user, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !user?.user) {
    console.error('❌ Error fetching user data:', error?.message);
    return 'free';
  }

  let plan = 'free';
  const metadata = user.user.user_metadata ?? {};
  const appMetadata = user.user.app_metadata ?? {};

  // Get GitHub username if linked
  const githubUsername = metadata.user_name ?? metadata.github_username;
  if (!githubUsername || appMetadata.provider !== 'github') return plan;

  console.log(`🔍 User ${userId} linked GitHub: ${githubUsername}`);

  // Check if they are a sponsor
  const sponsors = await fetchGitHubSponsors();
  if (sponsors.some((sponsor) => sponsor?.toLowerCase() === githubUsername?.toLowerCase())) {
    plan = 'sponsor';
  }

  return plan;
}

/**
 * Sets up the user's billing entry.
 */
async function setupUserBilling(userId: string) {
  try {
    // Check if user already has a billing record
    const { data: existingBilling } = await supabase
      .from('billing')
      .select('current_plan')
      .eq('user_id', userId)
      .single();

    if (existingBilling && existingBilling.current_plan !== 'free') {
      console.info(`✅ User ${userId} already has a paid billing plan.`);
      return;
    }

    // Get correct plan
    const plan = await determineBillingPlan(userId);
    console.log(`🔍 Setting up billing for user ${userId} with plan: ${plan}`);

    // Insert billing record
    const { error } = await supabase.from('billing').upsert(
      {
        user_id: userId,
        current_plan: plan,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) throw error;
    console.info(`✅ Billing setup complete for user ${userId}`);
  } catch (error) {
    console.error('❌ Error setting up billing:', error);
  }
}

/**
 * Supabase Edge Function: Handles new user signups.
 */
serve(async (req) => {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), { status: 400 });
    }

    await setupUserBilling(userId);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
});
