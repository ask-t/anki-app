import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {schedule,type Rating} from "@/lib/scheduling";
import {getSupabasePublicConfig} from "@/lib/supabase-config";
export const runtime="nodejs";
const ratings=["Again","Hard","Good","Easy"];
export async function POST(request:NextRequest){try{
 const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return NextResponse.json({error:"Authentication required"},{status:401});
 const {url,key}=getSupabasePublicConfig();const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key||!service)return NextResponse.json({error:"Not configured"},{status:503});
 const auth=createClient(url,key,{auth:{persistSession:false}});const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const input=await request.json();const cardId=input?.cardId;const rating=input?.rating;
 if(typeof cardId!=="string"||!ratings.includes(rating))return NextResponse.json({error:"Invalid review"},{status:400});
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:card,error:readErr}=await admin.from("cards").select("id,repetitions,interval_days,ease_factor").eq("id",cardId).eq("user_id",user.id).maybeSingle();
 if(readErr)throw readErr;if(!card)return NextResponse.json({error:"Card not found"},{status:404});
 const next=schedule(rating as Rating,card.repetitions,card.interval_days,card.ease_factor);
 const {error:updateErr}=await admin.from("cards").update({...next,last_rating:rating,last_reviewed_at:new Date().toISOString()}).eq("id",cardId).eq("user_id",user.id);if(updateErr)throw updateErr;
 const {error:logErr}=await admin.from("review_logs").insert({user_id:user.id,card_id:cardId,rating});if(logErr)throw logErr;
 return NextResponse.json({ok:true,...next});
 }catch(e){console.error("review error",e);return NextResponse.json({error:"Review could not be saved"},{status:500})}}
