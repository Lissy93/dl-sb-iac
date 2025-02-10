// Step 1: Read the userId and message from the input body
// Step 2: Fetch and parse user's notification preferences from the notification_channels field user_info table
// Step 3: If no notification preferences, fetch user's email from `Email` col of `users` table, and set preferences to email only
// Step 4: For each enabled channel, send the specified message using the corresponding channel config
// Step 5: Mark the notification as sent, in `sent` field of `notifications` table
// Step 6: Return a success response

// Sample input body
// '{"userId":"42","message":"Hello, this is a test notification"}'

// Sample notification preferences object
// '{"email":{"enabled":true,"address":"dl-test-42@d0h.co"},"pushNotification":{"enabled":true},"webHook":{"enabled":true,"url":"https://example.com","provider":"pushbits","topic":"","token":"xxx","userId":"yyy","accessToken":"","headers":""},"signal":{"enabled":true,"number":"07700000000","apiKey":"xxx"},"telegram":{"enabled":true,"botToken":"xxx","chatId":"yyy"},"slack":{"enabled":true,"webhookUrl":"https://example.com/zzz"},"matrix":{"enabled":true,"homeserverUrl":"https://example.com/yyy","accessToken":"xxx"}}'


// Import Edge Runtime and required libraries for Supabase
import { createClient } from "jsr:@supabase/supabase-js@2";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { NotificationPreferences } from "./types.ts";
import { sendWebHookNotification } from "./senders/webhook.ts";
import { sendEmailNotification } from "./senders/email.ts";
import { sendSlackNotification } from "./senders/slack.ts";
import { sendSmsNotification } from "./senders/sms.ts";
import { sendWhatsAppNotification } from "./senders/whatsapp.ts";

const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';

// Function entry point
Deno.serve(async (req) => {

  const supabase = createClient(DB_URL, DB_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  try {
    // Step 1: Read userId and message from the input body
    const body = await req.json();
    let userId: string;
    let message: string;
    
    if (body.type === 'INSERT' && body.record?.new) {
      // This is a database webhook trigger from notifications table
      userId = body.record.new.user_id;
      message = body.record.new.message;
    } else {
      // This is a manual trigger with direct payload
      userId = body.userId;
      message = body.message;
    }

    if (!userId || !message) {
      return new Response(
        JSON.stringify({ error: "userId and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 2: Fetch user's notification preferences
    const { data, error } = await supabase
      .from('user_info')
      .select('notification_channels')  
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      console.error("Error fetching user info:", error || "User not found");
      return new Response(
        JSON.stringify({ error: "User not found or error fetching preferences" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch user's current plan from the billing table
    const { data: billingData } = await supabase
      .from('billing')
      .select('current_plan')
      .eq('user_id', userId)
      .single();

    // If the user's plan is 'free', remove all notification channels except email
    if (billingData && billingData.current_plan === 'free') {
      const emailChannel = data.notification_channels.email;
      data.notification_channels = { email: emailChannel };
    }

    const notificationChannels = (data.notification_channels || {}) as NotificationPreferences;

    // Step 3: For each enabled channel, send the message using the corresponding channel function
    if (notificationChannels.email?.enabled) {
      await sendEmailNotification(notificationChannels.email, message);
    }
    if (notificationChannels.pushNotification?.enabled) {
      await sendPushNotification(notificationChannels.pushNotification, message);
    }
    if (notificationChannels.webHook?.enabled) {
      await sendWebHookNotification(notificationChannels.webHook, message);
    }
    if (notificationChannels.signal?.enabled) {
      await sendSignalNotification(notificationChannels.signal, message);
    }
    if (notificationChannels.telegram?.enabled) {
      await sendTelegramNotification(notificationChannels.telegram, message);
    }
    if (notificationChannels.slack?.enabled) {
      await sendSlackNotification(notificationChannels.slack, message);
    }
    if (notificationChannels.matrix?.enabled) {
      await sendMatrixNotification(notificationChannels.matrix, message);
    }
    if (notificationChannels.whatsapp?.enabled) {
      await sendWhatsAppNotification(notificationChannels.whatsapp, message);
    }
    if (notificationChannels.sms?.enabled) {
      await sendSmsNotification(notificationChannels.sms, message);
    }

    const numberOfActiveChannels = Object.values(notificationChannels).filter((channel) => channel.enabled).length || 0;

    return new Response(
      JSON.stringify({ message: `✅ Notifications sent successfully to ${numberOfActiveChannels} channels` }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing notification:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/* ================================
   Private Functions for Channels
================================ */

async function sendPushNotification(config: any, message: string) {
  console.log(`Sending push notification: ${message}`);
  // TODO: Implement actual push notification logic here
}

// Placeholder function for sending Signal notifications
async function sendSignalNotification(config: any, message: string) {
  console.log(`Sending Signal message to ${config.number}: ${message}`);
  // TODO: Implement actual Signal notification logic here
}

// Placeholder function for sending Telegram notifications
async function sendTelegramNotification(config: any, message: string) {
  console.log(`Sending Telegram message to chat ID ${config.chatId}: ${message}`);
  // TODO: Implement actual Telegram notification logic here
}

// Placeholder function for sending Matrix notifications
async function sendMatrixNotification(config: any, message: string) {
  console.log(`Sending Matrix message to ${config.homeserverUrl}: ${message}`);
  // TODO: Implement actual Matrix notification logic here
}
