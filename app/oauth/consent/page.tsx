import ConnectionAccess from "@/app/components/connection-access";
import { getMcpConfig } from "@/lib/mcp-config";
import { readConsent } from "@/lib/mcp-oauth";
export const dynamic = "force-dynamic";
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ request?: string | string[] }> }) {
  const { request } = await searchParams;
  try {
    if (typeof request !== "string") throw new Error("ChatGPTの接続画面からやり直してください");
    const consent = readConsent(getMcpConfig(), request);
    return <ConnectionAccess signedRequest={request} clientId={consent.client_id} />;
  } catch {
    return <ConnectionAccess initialError="接続リクエストが無効か、期限切れです。ChatGPTの接続画面からやり直してください。" />;
  }
}
