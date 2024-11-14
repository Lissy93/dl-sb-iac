


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

const DB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const DB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Function entry point
Deno.serve(async (req) => {

  const supabase = createClient(
    DB_URL,
    DB_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );

  try {
    // Step 1: Read userId and message from the input body
    const { userId, message } = await req.json();

    if (!userId || !message) {
      return new Response(
        JSON.stringify({ error: "userId and message are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 2: Fetch user's notification preferences
    const { data, error } = await supabase
      .from("user_info")
      .select("notification_channels")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      console.error("Error fetching user info:", error || "User not found");
      return new Response(
        JSON.stringify({ error: "User not found or error fetching preferences" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const notificationChannels = data.notification_channels;

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

    return new Response(
      JSON.stringify({ message: "Notifications sent successfully" }),
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

// Placeholder function for sending email notifications
async function sendEmailNotification(config: any, message: string) {
  console.log(`Sending email to ${config.address}: ${message}`);
  // Implement actual email sending logic here
}

// Placeholder function for sending push notifications
async function sendPushNotification(config: any, message: string) {
  console.log(`Sending push notification: ${message}`);
  // Implement actual push notification logic here
}

// Placeholder function for sending web hook notifications
async function sendWebHookNotification(config: any, message: string) {
  console.log(`Sending web hook to ${config.url} with provider ${config.provider}: ${message}`);
  // Implement actual web hook sending logic here
}

// Placeholder function for sending Signal notifications
async function sendSignalNotification(config: any, message: string) {
  console.log(`Sending Signal message to ${config.number}: ${message}`);
  // Implement actual Signal notification logic here
}

// Placeholder function for sending Telegram notifications
async function sendTelegramNotification(config: any, message: string) {
  console.log(`Sending Telegram message to chat ID ${config.chatId}: ${message}`);
  // Implement actual Telegram notification logic here
}

// Placeholder function for sending Slack notifications
async function sendSlackNotification(config: any, message: string) {
  console.log(`Sending Slack message to ${config.webhookUrl}: ${message}`);
  // Implement actual Slack notification logic here
}

// Placeholder function for sending Matrix notifications
async function sendMatrixNotification(config: any, message: string) {
  console.log(`Sending Matrix message to ${config.homeserverUrl}: ${message}`);
  // Implement actual Matrix notification logic here
}
