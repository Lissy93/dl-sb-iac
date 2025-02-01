import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@11.15.0?target=deno'

// === 1) Initialize Supabase ===
const DB_URL = Deno.env.get('DB_URL') || ''
const DB_KEY = Deno.env.get('DB_KEY') || ''
const supabase = createClient(DB_URL, DB_KEY, {
  global: { headers: { Authorization: `Bearer ${DB_KEY}` } },
})

// === 2) Initialize Stripe ===
const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-11-20.acacia' })

// === 3) Plan Mapping ===
const PLAN_MAPPING: Record<string, string> = {
  'dl_hobby_monthly': 'hobby',
  'dl_hobby_annual':  'hobby',
  'dl_pro_monthly':   'pro',
  'dl_pro_annual':    'pro',
}

// === 4) Serve Webhook ===
serve(async (req: Request) => {
  if (!DB_URL || !DB_KEY || !stripeSecretKey || !webhookSecret) {
    return respError('Missing environment variables', 500)
  }

  try {
    // Verify Stripe webhook signature
    const signature = req.headers.get('stripe-signature')
    if (!signature) throw new Error('Missing stripe-signature header')

    const rawBody = await req.text()
    let event
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (err) {
      logError('Webhook signature verification failed', err)
      return respError('Invalid signature', 400)
    }

    // Route based on event type
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event)
        break

      case 'invoice.paid':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event)
        break

      default:
        logInfo(`Unhandled event type: ${event.type}`)
        break
    }

    return respSuccess()
  } catch (err) {
    logError('Webhook error:', err)
    return respError(err.message || 'Unknown error', 400)
  }
})

/**
 * Handles successful checkouts (new subscriptions)
 */
async function handleCheckoutCompleted(event: any) {
  const session = event.data.object as Stripe.Checkout.Session
  const subId = session.subscription
  if (!subId) {
    logError('checkout.session.completed: No subscription ID found')
    return
  }

  const subscription = await stripe.subscriptions.retrieve(String(subId))
  const userId = getUserId(session, subscription)

  if (!userId) {
    logError('checkout.session.completed: No user_id found in metadata', { session, subscription })
    return
  }

  await updateBillingRecord(userId, subscription)
  sendEmail(userId, 'subscription_started')
}

/**
 * Handles subscription updates & invoice payments
 */
async function handleSubscriptionUpdated(event: any) {
  const subscription = event.data.object as Stripe.Subscription
  const userId = getUserId(null, subscription)

  if (!userId) {
    logError(`${event.type}: No user_id in subscription metadata`, { subscription })
    return
  }

  await updateBillingRecord(userId, subscription)
  sendEmail(userId, 'subscription_updated')
}

/**
 * Handles failed payments
 */
async function handlePaymentFailed(event: any) {
  const invoice = event.data.object as Stripe.Invoice
  const subId = invoice.subscription
  const userId = getUserIdFromInvoice(invoice)

  if (!subId || !userId) {
    logError('invoice.payment_failed: No subscription/user ID found', { invoice })
    return
  }

  sendEmail(userId, 'payment_failed')
}

/**
 * Handles subscription cancellations
 */
async function handleSubscriptionDeleted(event: any) {
  const subscription = event.data.object as Stripe.Subscription
  const userId = getUserId(null, subscription)

  if (!userId) {
    logError('customer.subscription.deleted: No user_id found in metadata', { subscription })
    return
  }

  await downgradeToFreePlan(userId)
  sendEmail(userId, 'subscription_canceled')
}

/**
 * Upserts a billing record in Supabase
 */
async function updateBillingRecord(userId: string, subscription: Stripe.Subscription) {
  if (!subscription.items || !subscription.items.data.length) {
    logError('updateBillingRecord: No items found in subscription', { subscription })
    return
  }

  const priceId = subscription.items.data[0]?.price?.id
  const plan = PLAN_MAPPING[priceId] || 'free'

  const nextPaymentDue = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null

  const billingMeta = {
    total: subscription.plan?.amount || null,
    currency: subscription.currency,
    invoice_number: subscription.latest_invoice,
    paid: subscription.status === 'active',
    subscription_id: subscription.id,
    billing_reason: subscription.status,
    customer: subscription.customer,
    invoice_pdf: subscription.latest_invoice_url || null,
    plan_id: priceId
  }

  const { data, error } = await supabase
    .from('billing')
    .upsert(
      {
        user_id: userId,
        current_plan: plan,
        next_payment_due: nextPaymentDue,
        billing_method: 'stripe',
        updated_at: new Date().toISOString(),
        meta: billingMeta
      },
      { onConflict: 'user_id' }
    )

  if (error) {
    logError('Failed to update billing', { error, userId, plan })
  } else {
    logInfo('Billing updated successfully', { userId, plan })
  }
}

/**
 * Downgrades a user to the free plan
 */
async function downgradeToFreePlan(userId: string) {
  const { error } = await supabase
    .from('billing')
    .update({
      current_plan: 'free',
      next_payment_due: null,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  if (error) {
    logError('Failed to downgrade user to free', { error, userId })
  } else {
    logInfo('User downgraded to free plan', { userId })
  }
}

/**
 * Extracts user_id safely
 */
function getUserId(session: Stripe.Checkout.Session | null, subscription: Stripe.Subscription): string | null {
  return session?.subscription_details?.metadata?.user_id || subscription?.subscription_details?.metadata?.user_id || null
}

/**
 * Extracts user_id from invoice safely
 */
function getUserIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return invoice.lines?.data?.[0]?.metadata?.user_id || invoice.subscription_details?.metadata?.user_id || null
}

/**
 * Sends an email (Placeholder function)
 */
function sendEmail(userId: string, eventName: string) {
  logInfo(`(Email) Notify user ${userId} about ${eventName}`)
}

/**
 * Centralized logging
 */
function logInfo(msg: string, extra?: any) {
  console.log(`INFO: ${msg}`, extra ?? '')
}
function logError(msg: string, extra?: any) {
  console.error(`ERROR: ${msg}`, extra ?? '')
}

/**
 * Response helpers
 */
function respSuccess() {
  return new Response(JSON.stringify({ received: true }), { status: 200 })
}
function respError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status })
}
