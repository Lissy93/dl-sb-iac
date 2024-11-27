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
        JSON.stringify({ error: 'userId and message are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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
      JSON.stringify({ success: true, userId, message }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}); 
