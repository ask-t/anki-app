import { createClient } from "@supabase/supabase-js";
import { createCardImportHandler, getAgentConfig } from "@/lib/card-import";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const config = getAgentConfig();
  return createCardImportHandler(config, () => createClient(config.url!, config.serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }))(request);
}
