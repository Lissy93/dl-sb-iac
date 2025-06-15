import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('DB_URL')!
const ANON_KEY = Deno.env.get('DB_ANON_KEY')!

// const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
// const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Creates an authenticated instance of the Supabase client.
 * If the user is accessing directly, then we use their JWT, and RLS will apply.
 * Otherwise, if a service  role is present, we use that
 */
export function getSupabaseClient(req: Request): SupabaseClient {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Response('Supabase environment variables are misconfigured.', { status: 500 });
  }
  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');

    if (!jwt) {
      throw new Response('🚫 Unauthorized, missing bearer token', { status: 401 });
    }

    return createClient(
      SUPABASE_URL,
      ANON_KEY,
      {
        global: {
          headers: {
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );
  } catch (err) {
    console.error('Error creating Supabase client:', err);
    throw new Response('🚫 Unauthorized, invalid bearer token', { status: 401 });
  }
}


export async function getUserOrNull(req: Request): Promise<User | null> {
  const client = getSupabaseClient(req);
  const { data, error } = await client.auth.getUser();
  return error || !data?.user ? null : data.user;
}

