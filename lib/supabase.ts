import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./supabase-config";

let browserClient: ReturnType<typeof createClient> | undefined;

export function browserSupabase() {
  const { url, key } = getSupabasePublicConfig();
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  // Reuse the auth client across renders, including React Strict Mode remounts.
  // Server renders must not share a client between requests.
  if (typeof window === "undefined") return createClient(url, key);
  return browserClient ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
}
