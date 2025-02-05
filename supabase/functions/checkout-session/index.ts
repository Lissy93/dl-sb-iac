import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

/** Helper to get env var, or fallback, or throw error. */
function getEnvVar(name: string, fallback?: string): string {
  const val = Deno.env.get(name)?.trim() ?? fallback;
  if (!val) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return val;
}

/** Flatten an object into x-www-form-urlencoded style keys */
function flattenObject(obj: any): Record<string, string> {
  const result: Record<string, string> = {};

  function flatten(obj: any, prefix: string = ''): void {
    Object.entries(obj).forEach(([key, value]) => {
      const newKey = prefix ? `${prefix}[${key}]` : key;
      if (Array.isArray(value)) {
        value.forEach((item, index) => flatten(item, `${newKey}[${index}]`));
      } else if (value && typeof value === 'object') {
        flatten(value, newKey);
      } else {
        result[newKey] = String(value);
      }
    });
  }
  flatten(obj);
  return result;
}

/** productId -> env var name => actual Stripe price ID */
const productIdToEnvVar: Record<string, string> = {
  'dl_hobby_monthly': 'STRIPE_PRICE_HM',
  'dl_hobby_annual':  'STRIPE_PRICE_HA',
  'dl_pro_monthly':   'STRIPE_PRICE_PM',
  'dl_pro_annual':    'STRIPE_PRICE_PA',
};

const responseHeaders =  {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

serve(async (req: Request) => {

  // Early return for preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      },
      status: 204,
    });
  }
  
  // 1) Get environment vars (or fallback)
  try {
    const STRIPE_SECRET_KEY = getEnvVar('STRIPE_SECRET_KEY');
    const STRIPE_ENDPOINT   = getEnvVar('STRIPE_ENDPOINT', 'https://api.stripe.com/v1/checkout/sessions');
    const APP_BASE_URL      = getEnvVar('DL_BASE_URL', 'https://domain-locker.com');

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Only POST allowed' }), { headers: responseHeaders, status: 405 });
    }

    // 2) Parse JSON from body
    let body: any;
    try {
      body = await req.json();
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { headers: responseHeaders, status: 400 });
    }

    const { userId, productId, callbackUrl } = body || {};
    if (!userId || !productId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: userId, productId' }), { headers: responseHeaders, status: 400 });
    }

    // 3) Map productId -> env var -> actual Stripe price ID
    const envVarName = productIdToEnvVar[productId];
    if (!envVarName) {
      return new Response(JSON.stringify({ error: `Invalid productId: ${productId}` }), { headers: responseHeaders, status: 400 });
    }
    const priceId = getEnvVar(envVarName);

    // 4) Build the payload to send to Stripe
    const finalSuccessUrl = (callbackUrl || APP_BASE_URL) + '/settings/upgrade?success=1';
    const finalCancelUrl  = (callbackUrl  || APP_BASE_URL) + '/settings/upgrade?canceled=1';

    const line_items = [{ price: priceId, quantity: 1 }];
    const subscription_data = { metadata: { user_id: userId } };
    const payload = {
      line_items,
      mode: 'subscription',
      subscription_data,
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      allow_promotion_codes: true,
    };

    // Flatten + encode
    const formBody = new URLSearchParams(flattenObject(payload)).toString();

    // 5) Make request to Stripe
    const headers: HeadersInit = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    };

    const stripeRes = await fetch(STRIPE_ENDPOINT, {
      method: 'POST',
      headers,
      body: formBody,
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok || !data?.url) {
      const msg = data?.error?.message || data?.error || 'Failed to create checkout session';
      return new Response(
        JSON.stringify({ error: `Stripe Error: ${msg}` }),
        { headers: responseHeaders, status: 400 },
      );
    }

    // On success, return { url: data.url }
    return new Response(JSON.stringify({ url: data.url }), { headers: responseHeaders, status: 200 });

  } catch (err: any) {
    // If any environment var missing or logic error
    console.error('checkout-session error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: responseHeaders, status: 400 },
    );
  }
});
