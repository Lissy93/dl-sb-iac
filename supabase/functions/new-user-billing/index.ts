import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@11.15.0?target=deno';

// Load environment variables
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';
const SPONSORS_API = Deno.env.get('AS93_SPONSORS_API') ?? '';
const NOTIFICATION_URL = Deno.env.get('WORKER_SEND_NOTIFICATION_URL') ?? `${DB_URL}/functions/v1/send-notification`;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

// Ensure required environment variables are set
if (!DB_URL || !DB_KEY) throw new Error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
if (!STRIPE_SECRET_KEY) console.warn('⚠️ Missing STRIPE_SECRET_KEY. Stripe billing checks will be skipped.');

// Initialize Supabase client (service role for RLS bypass)
const supabase = createClient(DB_URL, DB_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// Initialize Stripe client (if key is present)
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' }) : null;

const STRIPE_PLAN_MAPPING: Record<string, string> = {
  'dl_hobby_monthly': 'hobby',
  'dl_hobby_annual': 'hobby',
  'dl_pro_monthly': 'pro',
  'dl_pro_annual': 'pro',
};

/**
 * Fetches a user from Supabase Auth.
 * Fails fast if the user is not found.
 */
async function getUser(userId: string): Promise<any | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user) {
      console.error(`❌ User ${userId} not found.`);
      return null;
    }
    return data.user;
  } catch (err) {
    console.error(`❌ Error fetching user ${userId}:`, err);
    return null;
  }
}

/**
 * Fetches the list of GitHub sponsors.
 */
async function fetchGitHubSponsors(): Promise<Set<string>> {
  if (!SPONSORS_API) return new Set();

  try {
    const res = await fetch(`${SPONSORS_API}/lissy93`);
    if (!res.ok) throw new Error('Failed to fetch GitHub sponsors');

    const sponsors = await res.json();
    return new Set(sponsors.map((s: { login: string }) => (s.login || '').toLowerCase()));
  } catch (err) {
    console.error('❌ Error fetching GitHub sponsors:', err);
    return new Set();
  }
}

/**
 * Checks if a user has an active Stripe subscription.
 * Returns the corresponding billing plan or `null` if none.
 */
/**
 * Fetches the Stripe billing plan for a user.
 * Uses `customer_id` for efficient lookup.
 */
export async function stripeBillingCheck(userId: string): Promise<string | null> {
  if (!stripe) {
    console.warn('⚠️ Stripe is not configured. Skipping billing checks.');
    return null;
  }

  try {
    console.info(`🔍 Checking Stripe subscription for user ${userId}`);

    // STEP 1: Fetch `customer_id` from Supabase
    const { data: billingRecord, error } = await supabase
      .from('billing')
      .select('meta')
      .eq('user_id', userId)
      .maybeSingle();

    const customerId = billingRecord?.meta?.customer ?? null;

    if (error || !customerId) {
      console.warn(`⚠️ No Stripe customer ID found for user ${userId}`);
      return null;
    }

    // Query Stripe for active subscription using `customer_id`
    const timeout = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Stripe API request timed out')), 5000)
    );

    const stripeResponse = await Promise.race([
      stripe.subscriptions.search({
        query: `status:'active' AND customer:'${customerId}'`,
        expand: ['data.items'],
      }),
      timeout,
    ]);

    if (!stripeResponse || !('data' in stripeResponse)) {
      console.warn(`⚠️ No valid response from Stripe for user ${userId}`);
      return null;
    }

    // Get active subscription details
    const activeSubscription = stripeResponse.data[0];
    if (!activeSubscription) {
      console.info(`🔍 No active Stripe subscription found for user ${userId}`);
      return null;
    }

    // Extract plan ID from subscription
    const priceId = activeSubscription.items.data[0]?.price?.lookup_key;
    if (!priceId) {
      console.warn(`⚠️ User ${userId} has an active subscription but no valid plan ID.`);
      return null;
    }

    // Map to internal plan name
    const mappedPlan = STRIPE_PLAN_MAPPING[priceId] || null;
    console.info(`✅ User ${userId} has an active ${mappedPlan} plan via Stripe`);
    return mappedPlan;
  } catch (err) {
    console.error(`❌ Error checking Stripe subscription for user ${userId}:`, err);
    return null;
  }
}


/**
 * Determines the correct billing plan for a user.
 * Prioritizes Stripe over GitHub sponsorships.
 */
async function determineBillingPlan(userId: string): Promise<string> {
  console.info('🔍 Determining appropriate billing plan for user')
  const user = await getUser(userId);
  if (!user) {
    console.error(`❌ Cannot determine billing plan. User ${userId} does not exist.`);
    return 'free';
  }

  // Check Stripe first (higher priority)
  const stripePlan = await stripeBillingCheck(userId);
  if (stripePlan) return stripePlan;

  // Check GitHub sponsors
  const githubUsername = user.user_metadata?.user_name ?? user.user_metadata?.github_username;
  if (!githubUsername || user.app_metadata?.provider !== 'github') return 'free';

  const sponsors = await fetchGitHubSponsors();
  return sponsors.has(githubUsername.toLowerCase()) ? 'sponsor' : 'free';
}

/**
 * Creates a new Stripe customer, if one doesn't yet exist
 * @param userId 
 * @returns 
 */
async function createGetStripeCustomer(userId: string): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) {
    console.warn('⚠️ Stripe not configured.');
    return null;
  }

  try {
    console.info(`🔍 Looking up Stripe customer for user ${userId}`);

    // 1. Get user info (email required)
    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(userId);
    const user = userRes?.user;
    const email = user?.email;
    if (userErr || !user || !email) {
      console.warn(`⚠️ Missing user or email for ${userId}`);
      return null;
    }

    // 2. Check billing.meta.customer
    const { data: billing, error: billingErr } = await supabase
      .from('billing')
      .select('meta')
      .eq('user_id', userId)
      .maybeSingle();

    const existingId = billing?.meta?.customer;
    if (existingId) {
      console.info(`✅ Found Stripe customer in billing.meta: ${existingId}`);
      return existingId;
    }

    // 3. Search Stripe for existing customer (metadata or email)
    const metaQuery = encodeURIComponent(`metadata['user_id']:'${userId}'`);
    const metaRes = await fetch(`https://api.stripe.com/v1/customers/search?query=${metaQuery}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const metaData = await metaRes.json();
    if (metaRes.ok && metaData?.data?.length > 0) {
      const foundId = metaData.data[0].id;
      console.info(`✅ Found Stripe customer via metadata: ${foundId}`);
      return foundId;
    }

    const emailRes = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });
    const emailData = await emailRes.json();
    if (emailRes.ok && emailData?.data?.length > 0) {
      const foundId = emailData.data[0].id;
      console.info(`✅ Found Stripe customer via email: ${foundId}`);
      return foundId;
    }

    // 4. Create new customer
    const createRes = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email,
        name: user.user_metadata?.full_name ?? '',
        'metadata[user_id]': userId,
      }),
    });

    const customer = await createRes.json();
    if (!createRes.ok || !customer?.id) {
      console.error('❌ Failed to create Stripe customer:', customer);
      return null;
    }

    console.info(`🆕 Created new Stripe customer: ${customer.id}`);
    return customer.id;
  } catch (err) {
    console.error(`❌ Stripe customer setup failed for ${userId}:`, err);
    return null;
  }
}



/**
 * Ensures the user has a billing entry with the correct plan.
 */
async function setupUserBilling(userId: string) {
  console.log(`🔍 Checking billing for user ${userId}`);
  try {
    // Fetch existing billing record
    const { data: existing, error } = await supabase
      .from('billing')
      .select('current_plan, meta')
      .eq('user_id', userId)
      .single();

    console.info(`🔍 User ${userId} current plan: ${existing?.current_plan}`);

    if (error && error.code !== 'PGRST116') { // Trow error if cannot read billing table
      console.error('❌ Error fetching billing record:', error);
      throw error;
    }
    if (existing?.current_plan && existing?.current_plan !== 'free') {  // Skip if already on a paid plan
      console.info(`✅ User ${userId} already set up on ${existing.current_plan} plan`);
      return
    };

    // Determine the correct plan
    const plan = await determineBillingPlan(userId);
    if (!plan) {
      console.error(`❌ Cannot determine billing plan for user ${userId}`);
      return;
    };

    const customerId = await createGetStripeCustomer(userId);
    console.log('===> Customer ID', customerId);

    const userMeta = existing?.meta || {};
    const newMeta = {
      ...userMeta,
      customer: customerId,
    }

    // Upsert billing entry
    console.info(`🔄 Setting up user ${userId} on ${plan} plan`);

    const { error: updateError } = await supabase
      .from('billing')
      .update({ current_plan: plan, updated_at: new Date().toISOString(), meta: newMeta })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    // Send notification if upgraded
    if (plan !== 'free' && plan !== existing?.current_plan) {
      console.info(`📬 Sending notification to user ${userId}`);
      fetch(NOTIFICATION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: `You've been upgraded to the ${plan} plan! 🎉` }),
      }).catch((err) => console.error('❌ Error sending notification:', err));
    }

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
    // Get the payload body, extract userId, and kick of the checks.
    const body = await req.json();
    const userId = body.user?.id || body.userId || body.user_id;
    if (!userId) {
      console.error('❌ Invalid webhook payload:', body);
      return new Response(JSON.stringify({ error: 'User ID is required' }), { status: 400 });
    }
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Operation timed out')), 5000));
    await Promise.race([setupUserBilling(userId), timeout]);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
});
