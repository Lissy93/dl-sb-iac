import { serve } from "https://deno.land/std@0.131.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const DB_URL = Deno.env.get('DB_URL') ?? '';
const DB_KEY = Deno.env.get('DB_KEY') ?? '';

// Initialize Supabase client
const supabase = createClient(DB_URL, DB_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

serve(async (req) => {
  try {
    const body = await req.json();
    
    // Handle both webhook and manual triggers
    let userId: string;
    let message: string;
    let url: string | undefined;
    
    if (body.type === 'INSERT' && body.record?.new) {
      // This is a database webhook trigger from notifications table
      userId = body.record.new.user_id;
      message = body.record.new.message;
      url = body.record.new.url?.trim();  // Trim any whitespace
    } else {
      // This is a manual trigger with direct payload
      userId = body.userId;
      message = body.message;
      url = body.url?.trim();  // Trim any whitespace
    }

    if (!userId || !message) {
      return new Response(
        JSON.stringify({ error: 'userId and message are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If URL is provided, ensure it starts with http/https
    if (url) {
      url = url.startsWith('http') ? url : `https://${url}`;
    }

    // TODO: Add your notification sending logic here
    console.log(`Sending notification to user ${userId}: ${message}`);

    // Mark notification as sent if it came from the database webhook
    if (body.type === 'INSERT' && body.record?.new) {
      await supabase
        .from('notifications')
        .update({ sent: true })
        .eq('id', body.record.new.id);
    }

    return new Response(
      JSON.stringify({ success: true, userId, message, url }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}); 
