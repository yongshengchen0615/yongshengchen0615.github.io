import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";
import { buildLineFlexNotice } from "../_shared/line-flex.ts";
import { replaceCurrentGrantSections } from "../_shared/grant-message-sections.ts";

type Json = Record<string, unknown>;

const TIER_LABELS: Record<string,string> = { general:"一般會員",silver:"銀級會員",gold:"金級會員",platinum:"白金會員" };

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
function taipeiDate(): string {
  return new Intl.DateTimeFormat("en-CA",{ timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit" }).format(new Date());
}
function pointCardRelation(row: any): any {
  return Array.isArray(row?.point_cards) ? row.point_cards[0] : row?.point_cards;
}
function resolveTier(settings: any[], minutes: number): any {
  const ordered = [...settings].sort((a,b) => Number(a.required_service_minutes || 0) - Number(b.required_service_minutes || 0));
  let selected = ordered[0] || { tier_key:"general",tier_label:"一般會員" };
  for (const row of ordered) if (minutes >= Number(row.required_service_minutes || 0)) selected = row;
  return selected;
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
  const blocks: string[] = [];
  const pointTickets = await supabase
    .from("point_tickets")
    .select("ticket_title,threshold_stamps,point_card_id,status,point_cards(title,status,expiry_mode,expires_on,sort_order)")
    .eq("member_id",memberId)
    .eq("status","available")
    .order("threshold_stamps",{ ascending:true })
    .order("created_at",{ ascending:false })
    .limit(100);
  if (pointTickets.error) throw pointTickets.error;

  const today = taipeiDate();
  const pointItems = (pointTickets.data || [])
    .filter((row:any) => {
      const card = pointCardRelation(row);
      return card && card.status === "active" && (card.expiry_mode === "unlimited" || !card.expires_on || String(card.expires_on) >= today);
    })
    .sort((left:any,right:any) => {
      const leftCard = pointCardRelation(left);
      const rightCard = pointCardRelation(right);
      const cardOrder = Number(leftCard?.sort_order || 0) - Number(rightCard?.sort_order || 0);
      if (cardOrder) return cardOrder;
      const thresholdOrder = Number(left.threshold_stamps || 0) - Number(right.threshold_stamps || 0);
      if (thresholdOrder) return thresholdOrder;
      return String(left.ticket_title || "").localeCompare(String(right.ticket_title || ""),"zh-Hant");
    });
  if (pointItems.length) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const row of pointItems) {
      const threshold = Number(row.threshold_stamps || 0);
      if (!Number.isFinite(threshold) || threshold <= 0) continue;
      const cardTitle = String(pointCardRelation(row)?.title || "集點卡");
      const ticketTitle = String(row.ticket_title || "可用優惠");
      const key = String(row.point_card_id || "") + "\n" + threshold + "\n" + ticketTitle;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push("・" + cardTitle + "｜" + ticketTitle + "｜消耗 " + threshold + " 點");
      if (lines.length >= 12) break;
    }
    if (lines.length) blocks.push("集點卡優惠（依節點排序）\n" + lines.join("\n"));
  }

  const events = await supabase.from("event_tickets").select("id,title,status,starts_on,ends_on,quota,allowed_tier_keys").eq("status","active");
  if (events.error) throw events.error;
  const eligible = (events.data || []).filter((row:any) => {
    const allowed = Array.isArray(row.allowed_tier_keys) ? row.allowed_tier_keys : [];
    return (!row.starts_on || String(row.starts_on) <= today) && (!row.ends_on || String(row.ends_on) >= today) && (!allowed.length || allowed.includes(tierKey));
  });
  const ids = eligible.map((row:any) => row.id);
  let claimCounts = new Map<string,number>();
  let memberClaims = new Set<string>();
  if (ids.length) {
    const allClaims = await supabase.from("event_ticket_claims").select("event_ticket_id,member_id,status").in("event_ticket_id",ids);
    if (allClaims.error) throw allClaims.error;
    for (const claim of allClaims.data || []) {
      if (claim.status !== "cancelled") claimCounts.set(String(claim.event_ticket_id),(claimCounts.get(String(claim.event_ticket_id)) || 0) + 1);
      if (String(claim.member_id) === memberId && claim.status !== "cancelled") memberClaims.add(String(claim.event_ticket_id));
    }
  }
  const eventItems = eligible.filter((row:any) => memberClaims.has(String(row.id)) || Number(row.quota || 0) === 0 || (claimCounts.get(String(row.id)) || 0) < Number(row.quota || 0));
  if (eventItems.length) {
    blocks.push("活動票券\n" + eventItems.slice(0,8).map((row:any) => "・" + String(row.title || "活動票券") + (memberClaims.has(String(row.id)) ? "（已領取）" : "（可領取）")).join("\n"));
  }

  return blocks.length ? "【目前可用優惠】\n" + blocks.join("\n\n") + "\n請至會員系統查看與使用。" : "";
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
