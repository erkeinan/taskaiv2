import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client = null;

// One shared browser client. Created lazily so the build never needs a network.
export function getSupabase() {
  if (!client) {
    if (!url || !key) throw new Error('Supabase is not configured.');
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}
