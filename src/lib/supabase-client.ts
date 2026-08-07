// Supabase Client Initialization - Fortune Tiger Clone (KASSINO-CKB)
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.");
}

// 1. Public client for browser use (uses Anon Key)
// Safe to import anywhere (client-side or server-side)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// 2. Private admin client for server-side use only (uses Service Role Key)
// Allows updating balance and writing spins securely bypasses RLS policies.
// NEVER import this on client-side React components.
export const getSupabaseAdmin = () => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || serviceRoleKey === "your_supabase_service_role_key_here") {
    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not configured. Server-side operations will fail.");
  }
  return createClient(supabaseUrl, serviceRoleKey || "", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};
