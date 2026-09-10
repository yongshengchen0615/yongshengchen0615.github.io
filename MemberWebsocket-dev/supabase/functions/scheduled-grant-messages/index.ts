import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;

function env(name: string): string { return (Deno.env.get(name) || "").trim(); }
function asText(value: unknown, max = 5000): string { return String(value ?? "").trim().slice(0,max); }
function dbClient(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase server configuration missing");
  return createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
}
function secureEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}
async function lineToken(supabase: SupabaseClient): Promise<string> {
  const result = await supabase.rpc("get_line_messaging_token");
  return result.error ? "" : asText(result.data,10000);
}
async function dispatchSecret(supabase: SupabaseClient): Promise<string> {
  const result = await supabase.rpc("get_grant_dispatch_secret");
  return result.error ? "" : asText(result.data,500);
}
async function writeAudit(supabase: SupabaseClient, row: any, result: string, detail: Json): Promise<void> {
  await supabase.from("audit_logs").insert({
    audit_id:"AUD-" + crypto.randomUUID().replaceAll("-",""),
    actor_line_user_id:"system",
    actor_role:"system",
    action:"line.push.grant.scheduled",
    target_type:"member",
    target_id:String(row.line_user_id || ""),
    result,
    detail:{ requestId:row.request_id,scheduleId:row.schedule_id,...detail },
  });
}
async function dispatchOne(supabase: SupabaseClient, token: string, row: any): Promise<{ sent:boolean;lineRequestId:string;error:string }> {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push",{
      method:"POST",
      headers:{
        "Authorization":"Bearer " + token,
        "Content-Type":"application/json",
        "X-Line-Retry-Key":crypto.randomUUID(),
      },
      body:JSON.stringify({ to:String(row.line_user_id),messages:[{ type:"text",text:String(row.message_text).slice(0,5000) }] }),
    });
    const lineRequestId = response.headers.get("x-line-request-id") || "";
    if (response.ok) return { sent:true,lineRequestId,error:"" };
    return { sent:false,lineRequestId,error:"LINE HTTP " + response.status };
  } catch (error) {
    return { sent:false,lineRequestId:"",error:asText((error as Error)?.message || "network_error",500) };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ ok:false,error:"METHOD_NOT_ALLOWED" }),{ status:405,headers:{ "Content-Type":"application/json" } });

  const supabase = dbClient();
  const expectedSecret = env("GRANT_MESSAGE_DISPATCH_SECRET") || await dispatchSecret(supabase);
  const suppliedSecret = request.headers.get("x-dispatch-secret") || "";
  if (!expectedSecret || !secureEqual(expectedSecret,suppliedSecret)) {
    return new Response(JSON.stringify({ ok:false,error:"UNAUTHORIZED" }),{ status:401,headers:{ "Content-Type":"application/json","Cache-Control":"no-store" } });
  }

  const claim = await supabase.rpc("claim_due_grant_messages",{ p_limit:20 });
  if (claim.error) return new Response(JSON.stringify({ ok:false,error:"CLAIM_FAILED" }),{ status:500,headers:{ "Content-Type":"application/json" } });
  const rows:any[] = Array.isArray(claim.data) ? claim.data : [];
  if (!rows.length) return new Response(JSON.stringify({ ok:true,claimed:0,sent:0,failed:0 }),{ status:200,headers:{ "Content-Type":"application/json","Cache-Control":"no-store" } });

  const token = await lineToken(supabase);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!token) {
      const attempts = Number(row.attempt_count || 0);
      const terminal = attempts >= 3;
      await supabase.from("scheduled_grant_messages").update({
        status:terminal ? "failed" : "pending",
        scheduled_for:terminal ? row.scheduled_for : new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        last_error:"LINE Messaging API 尚未設定。",
        updated_at:new Date().toISOString(),
      }).eq("id",row.id).eq("status","sending");
      await writeAudit(supabase,row,"failed",{ reason:"token_missing",terminal,attemptCount:attempts });
      failed += 1;
      continue;
    }

    const result = await dispatchOne(supabase,token,row);
    if (result.sent) {
      await supabase.from("scheduled_grant_messages").update({
        status:"sent",sent_at:new Date().toISOString(),line_request_id:result.lineRequestId,last_error:"",updated_at:new Date().toISOString(),
      }).eq("id",row.id).eq("status","sending");
      await writeAudit(supabase,row,"success",{ lineRequestId:result.lineRequestId,attemptCount:Number(row.attempt_count || 0) });
      sent += 1;
    } else {
      const attempts = Number(row.attempt_count || 0);
      const terminal = attempts >= 3;
      await supabase.from("scheduled_grant_messages").update({
        status:terminal ? "failed" : "pending",
        scheduled_for:terminal ? row.scheduled_for : new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        last_error:result.error.slice(0,500),line_request_id:result.lineRequestId,updated_at:new Date().toISOString(),
      }).eq("id",row.id).eq("status","sending");
      await writeAudit(supabase,row,"failed",{ reason:result.error,lineRequestId:result.lineRequestId,terminal,attemptCount:attempts });
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ ok:true,claimed:rows.length,sent,failed }),{ status:200,headers:{ "Content-Type":"application/json","Cache-Control":"no-store" } });
});