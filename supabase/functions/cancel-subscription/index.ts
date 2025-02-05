import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const stripeApiUrl = 'https://api.stripe.com/v1/subscriptions';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405 }
    );
  }

  try {
    const body = await req.json();
    if (!body) {
      return new Response(
        JSON.stringify({ error: 'No request body provided' }),
        { status: 400 }
      );
    }

    const { subscriptionId } = body;
    if (!subscriptionId || typeof subscriptionId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid subscription ID' }),
        { status: 400 }
      );
    }

    // 🔥 Use DELETE to cancel subscription immediately
    const response = await fetch(`${stripeApiUrl}/${subscriptionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'invoice_now': 'true',  // Immediately generates the final invoice
        'prorate': 'true'       // Adjust final invoice based on usage
      }).toString()
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Stripe API request failed');
    }

    const canceled = await response.json();

    return new Response(
      JSON.stringify({
        success: true,
        subscriptionStatus: canceled.status,
        subscriptionId: canceled.id
      }),
      { status: 200 }
    );

  } catch (err: any) {
    console.error('Cancel Subscription Error:', err);
    let errorMessage = err.message;
    let statusCode = 400;

    if (err.type === 'StripeCardError' || err.type === 'StripeInvalidRequestError') {
      errorMessage = 'Invalid request to Stripe';
      statusCode = 400;
    } else if (err.type === 'StripeAuthenticationError') {
      errorMessage = 'Authentication failed';
      statusCode = 401;
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: statusCode }
    );
  }
});
