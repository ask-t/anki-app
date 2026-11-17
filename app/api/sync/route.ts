import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {fetchNotionCards} from "@/lib/notion";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!service)return NextResponse.json({error:"サーバー設定が不足しています"},{status:503});
 const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return NextResponse.json({error:"ログインが必要です"},{status:401});
 const auth=createClient(url,key,{auth:{persistSession:false}});const {data:{user},error}=await auth.auth.getUser(token);
 if(error||!user||!user.email_confirmed_at)return NextResponse.json({error:"認証されていません"},{status:401});
 const allowed=(process.env.SYNC_ALLOWED_EMAILS||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(!user.email||!allowed.includes(user.email.toLowerCase()))return NextResponse.json({error:"同期の許可がありません"},{status:403});
 const incoming=await fetchNotionCards();const admin=createClient(url,service,{auth:{persistSession:false}});
 for(const item of incoming){const {data:existing,error:lookupError}=await admin.from("cards").select("id").eq("user_id",user.id).eq("notion_page_id",item.notion_page_id).maybeSingle();if(lookupError)throw lookupError;
 const result=existing?await admin.from("cards").update({...item,updated_at:new Date().toISOString()}).eq("id",existing.id).eq("user_id",user.id):await admin.from("cards").upsert({...item,user_id:user.id},{onConflict:"user_id,notion_page_id"});
 if(result.error)throw result.error;}
 return NextResponse.json({total:incoming.length});
 }catch(e){console.error("sync error",e);return NextResponse.json({error:"同期に失敗しました。Notionの権限と環境変数をご確認ください。"},{status:500})}}
