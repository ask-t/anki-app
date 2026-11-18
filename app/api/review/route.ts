import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { UUID_PATTERN } from "@/lib/card-import";
import { getSupabasePublicConfig } from "@/lib/supabase-config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { url, key } = getSupabasePublicConfig();
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !service) return NextResponse.json({ error: "Not configured" }, { status: 503 });
    const auth = createClient(url, key, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const input = await request.json();
    const { cardId, rating } = input ?? {};
    const requestId = input?.requestId === undefined ? randomUUID() : input.requestId;
    if (typeof cardId !== "string" || !UUID_PATTERN.test(cardId) ||
      (rating !== "Again" && rating !== "Good") || typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
      return NextResponse.json({ error: "Invalid review" }, { status: 400 });
    }
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc("record_adaptive_review", {
      p_user_id: user.id, p_card_id: cardId, p_rating: rating, p_request_id: requestId,
    });
    if (error?.code === "P0002") return NextResponse.json({ error: "Card not found" }, { status: 404 });
    if (error?.code === "23505") return NextResponse.json({ error: "Review request conflict" }, { status: 409 });
    if (error || !data) throw new Error("review failed");
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("review error");
    return NextResponse.json({ error: "Review could not be saved" }, { status: 500 });
  }
}
