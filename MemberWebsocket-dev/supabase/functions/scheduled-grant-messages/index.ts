import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";
import { buildLineFlexNotice } from "../_shared/line-flex.ts";
import { replaceCurrentGrantSections } from "../_shared/grant-message-sections.ts";
import { buildLatestAvailableOffersSection } from "../_shared/latest-available-offers.ts";

type Json = Record<string, unknown>;

const TIER_LABELS: Record<string,string> = { general:"一般會員",silver:"銀級會員",gold:"金級會員",platinum:"白金會員" };
const EVENT_LIFF_URL = "https://liff.line.me/2010787602-tuapstY3";

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
function resolveTier(settings: any[], minutes: number): any {
  const ordered = [...settings].sort((a,b) => Number(a.required_service_minutes || 0) - Number(b.required_service_minutes || 0));
  let selected = ordered[0] || { tier_key:"general",tier_label:"一般會員" };
  for (const row of ordered) if (minutes >= Number(row.required_service_minutes || 0)) selected = row;
  return selected;
}
function isFixedTicketNotification(row: any): boolean {
  const requestId = asText(row?.request_id || row?.schedule_id,500);
  return requestId.startsWith("FIXED-");
}
function removeUriButtons(node: any, uri: string): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node.contents)) {
    node.contents = node.contents.filter((item: any) =>
      !(item?.type === "button" && item?.action?.type === "uri" && item?.action?.uri === uri)
    );
    for (const child of node.contents) removeUriButtons(child, uri);
  }
  if (node.header) removeUriButtons(node.header, uri);
  if (node.body) removeUriButtons(node.body, uri);
  if (node.footer) removeUriButtons(node.footer, uri);
}
function addEventTicketAction(message: any): void {
  const bubble = message?.contents;
  const footer = bubble?.footer;
  if (!bubble || !footer || footer.type !== "box" || !Array.isArray(footer.contents)) return;

  removeUriButtons(bubble.body, EVENT_LIFF_URL);
  removeUriButtons(footer, EVENT_LIFF_URL);

  const accent = /^#[0-9a-f]{6}$/i.test(String(bubble?.header?.backgroundColor || ""))
    ? String(bubble.header.backgroundColor)
    : "#315D50";
  footer.spacing = "sm";
  footer.contents.unshift({
    type:"button",
    style:"primary",
    height:"sm",
    color:accent,
    action:{
      type:"uri",
      label:"開啟活動票券",
      uri:EVENT_LIFF_URL,
    },
  });
}
async function lineToken(supabase: SupabaseClient): Promise<string> {
  const result = await supabase.rpc("get_line_messaging_token");
  return result.error ? "" : asText(result.data,10000);
}
async function dispatchSecret(supabase: SupabaseClient): Promise<string> {
  const result = await supabase.rpc("get_grant_dispatch_secret");
  return result.error ? "" : asText(result.data,500);
}
async function availableTicketsSection(supabase: SupabaseClient, memberId: string, tierKey: string): Promise<string> {
  return await buildLatestAvailableOffersSection(supabase,memberId,tierKey,{ strict:true });
}
async function refreshScheduledMessage(supabase: SupabaseClient, row: any): Promise<string> {
  const memberId = String(row.member_id || "");
  if (!memberId) throw new Error("Scheduled grant member is missing");

  const service = await supabase.from("service_time_entries").select("minutes").eq("member_id",memberId);
  if (service.error) throw service.error;
  const totalMinutes = (service.data || []).reduce((sum,row:any) => sum + Number(row.minutes || 0),0);

  const tiers = await supabase.from("membership_tier_settings").select("tier_key,tier_label,required_service_minutes").order("required_service_minutes",{ ascending:true });
  if (tiers.error) throw tiers.error;
  const tier:any = resolveTier(tiers.data || [],totalMinutes);
  const statusSection = "【目前會員狀態】\n・累積服務時間：" + totalMinutes + " 分鐘\n・會員等級：" + String(tier.tier_label || TIER_LABELS[tier.tier_key] || "一般會員");
  const ticketSection = await availableTicketsSection(supabase,memberId,String(tier.tier_key || "general"));

  return replaceCurrentGrantSections(row.message_text,statusSection,ticketSection);
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
    const refreshedText = await refreshScheduledMessage(supabase,row);
    const message = buildLineFlexNotice(refreshedText,{
      title:"會員權益通知",
      eyebrow:"MEMBER BENEFITS",
    });
    if (isFixedTicketNotification(row)) addEventTicketAction(message);

    const response = await fetch("https://api.line.me/v2/bot/message/push",{
      method:"POST",
      headers:{
        "Authorization":"Bearer " + token,
        "Content-Type":"application/json",
        "X-Line-Retry-Key":crypto.randomUUID(),
      },
      body:JSON.stringify({ to:String(row.line_user_id),messages:[message] }),
    });
    const lineRequestId = response.headers.get("x-line-request-id") || "";
    if (response.ok) return { sent:true,lineRequestId,error:"" };
    return { sent:false,lineRequestId,error:"LINE HTTP " + response.status };
  } catch (error) {
    return { sent:false,lineRequestId:"",error:asText((error as Error)?.message || "dynamic_refresh_error",500) };
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
      await writeAudit(supabase,row,"success",{ lineRequestId:result.lineRequestId,attemptCount:Number(row.attempt_count || 0),dynamicSectionsRefreshed:true });
      sent += 1;
    } else {
      const attempts = Number(row.attempt_count || 0);
      const terminal = attempts >= 3;
      await supabase.from("scheduled_grant_messages").update({
        status:terminal ? "failed" : "pending",
        scheduled_for:terminal ? row.scheduled_for : new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        last_error:result.error.slice(0,500),line_request_id:result.lineRequestId,updated_at:new Date().toISOString(),
      }).eq("id",row.id).eq("status","sending");
      await writeAudit(supabase,row,"failed",{ reason:result.error,lineRequestId:result.lineRequestId,terminal,attemptCount:attempts,dynamicSectionsRefreshed:false });
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ ok:true,claimed:rows.length,sent,failed }),{ status:200,headers:{ "Content-Type":"application/json","Cache-Control":"no-store" } });
});