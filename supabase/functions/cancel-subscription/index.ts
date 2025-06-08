import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const SUPABASE_URL = Deno.env.get('DB_URL') || '';
const SUPABASE_KEY = Deno.env.get('DB_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: responseHeaders, status: 204 });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Only POST allowed' }, 405);
  }

  try {
    const body = await req.json();
    const userId = body?.userId;

    if (!userId || typeof userId !== 'string') {
      return jsonResponse({ error: 'Missing or invalid userId' }, 400);
    }

    // Step 1: Fetch Stripe customer ID from billing.meta
    const { data: billing, error } = await supabase
      .from('billing')
      .select('meta')
      .eq('user_id', userId)
      .maybeSingle();

    const customerId = billing?.meta?.customer;
    if (error || !customerId) {
      return jsonResponse({ error: 'No Stripe customer found for this user' }, 404);
    }

    // Step 2: Fetch active subscription from Stripe
    const subRes = await fetch(`https://api.stripe.com/v1/customers/${customerId}/subscriptions?limit=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    });

    const subData = await subRes.json();
    const subscription = subData?.data?.[0];

    if (!subRes.ok || !subscription?.id) {
      return jsonResponse({ error: 'No active subscription found for this user' }, 404);
    }

    // Step 3: Cancel the subscription
    const cancelRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        invoice_now: 'true',
        prorate: 'true',
      }),
    });

    const cancelData = await cancelRes.json();

    if (!cancelRes.ok) {
      throw new Error(cancelData.error?.message || 'Stripe cancellation failed');
    }

    return jsonResponse({
      success: true,
      userId,
      subscriptionId: cancelData.id,
      subscriptionStatus: cancelData.status,
    }, 200);

  } catch (err: any) {
    console.error('❌ Cancel Subscription Error:', err);
    return jsonResponse({ error: err.message || 'Unexpected error' }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}
