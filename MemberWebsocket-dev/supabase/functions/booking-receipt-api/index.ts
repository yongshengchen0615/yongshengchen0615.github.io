import { readJsonObject } from "../_shared/request-body.ts";
import { verifyLineIdTokenContract, requireActiveAdminContract } from "../_shared/auth-contract.ts";
import { resolveUserTestIdentity, TestModeAuthError } from "../_shared/test-mode-auth.ts";
import { hasCurrentTermsConsent } from "../_shared/membership-terms.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.0";

type Json = Record<string, unknown>;
type Identity = { lineUserId: string; displayName: string };

const BUCKET = "booking-receipts";
const MAX_REQUEST_BYTES = 24_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const READ_LIMIT = 90;
const WRITE_LIMIT = 20;
const ALLOWED_MIME = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);

class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message); this.status=status; this.code=code; this.details=details;
  }
}

function env(name: string): string { return (Deno.env.get(name) || "").trim(); }
function asText(value: unknown, max=1000): string { return String(value ?? "").trim().slice(0,max); }
function allowedOrigins(): Set<string> {
  return new Set((env("ALLOWED_ORIGINS") || "https://yongshengchen0615.github.io").split(",").map(v=>v.trim()).filter(Boolean));
}
function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins().has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "content-type, apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}
function response(origin: string | null,payload:unknown,status=200):Response {
  return new Response(JSON.stringify(payload),{status,headers:{...corsHeaders(origin),"Content-Type":"application/json; charset=utf-8"}});
}
function dbClient(): SupabaseClient {
  const url=env("SUPABASE_URL"); const key=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) throw new ApiError(503,"SUPABASE_CONFIG_MISSING","Supabase server 設定尚未完成。");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function sha256Hex(value: string):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function fileSha256Hex(bytes:ArrayBuffer):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function consumeRateLimit(supabase:SupabaseClient,identity:Identity,write:boolean):Promise<void>{
  const {data,error}=await supabase.rpc("consume_api_rate_limit",{
    p_principal_hash:await sha256Hex(identity.lineUserId),p_is_write:write,p_cost:1,
    p_read_limit:READ_LIMIT,p_write_limit:WRITE_LIMIT
  });
  if(error) throw new ApiError(503,"RATE_LIMIT_UNAVAILABLE","無法確認請求頻率限制。");
  if(!data) throw new ApiError(429,"RATE_LIMITED","請求過於密集，請稍後再試。");
}
async function resolveUserIdentity(supabase:SupabaseClient,body:Json):Promise<Identity>{
  try{
    const testIdentity=await resolveUserTestIdentity(supabase,asText(body.testSessionToken,200));
    if(testIdentity){
      if(testIdentity.surface!=="booking") throw new ApiError(403,"TEST_SESSION_SURFACE_MISMATCH","測試登入與目前功能不相符。");
      return {lineUserId:testIdentity.lineUserId,displayName:testIdentity.displayName};
    }
    return await verifyLineIdTokenContract({
      idToken:asText(body.idToken,10_000),
      expectedChannelId:env("LINE_BOOKING_CHANNEL_ID")||"2010787602",
      createError:(status,code,message,details=null)=>new ApiError(status,code,message,details),
    }) as Identity;
  }catch(error){
    if(error instanceof TestModeAuthError) throw new ApiError(error.status,error.code,error.message);
    throw error;
  }
}
async function resolveAdminIdentity(body:Json):Promise<Identity>{
  return await verifyLineIdTokenContract({
    idToken:asText(body.idToken,10_000),
    expectedChannelId:env("LINE_ADMIN_CHANNEL_ID")||"2010791619",
    createError:(status,code,message,details=null)=>new ApiError(status,code,message,details),
  }) as Identity;
}
async function requireMember(supabase:SupabaseClient,identity:Identity):Promise<any>{
  const result=await supabase.from("members")
    .select("id,line_user_id,display_name,member_code,status,membership_status")
    .eq("line_user_id",identity.lineUserId).maybeSingle();
  if(result.error) throw new ApiError(500,"DATABASE_ERROR","會員資料暫時無法讀取。");
  const member=result.data;
  if(!member||member.status!=="active"||member.membership_status!=="active") throw new ApiError(403,"MEMBERSHIP_REQUIRED","請先完成會員申請。");
  if(!await hasCurrentTermsConsent(supabase,member.id)) throw new ApiError(403,"TERMS_RECONSENT_REQUIRED","請先同意目前有效的會員條款。");
  return member;
}
function dbError(error:unknown):ApiError{
  const raw=error as {message?:string;details?:string;code?:string};
  const message=String(raw?.message||"")+" "+String(raw?.details||"");
  const rules:Array<[string,number,string,string]>=[
    ["BOOKING_NOT_FOUND",404,"BOOKING_NOT_FOUND","找不到這筆預約。"],
    ["BOOKING_NOT_OWNED",403,"BOOKING_NOT_OWNED","不可操作其他會員的預約。"],
    ["INVALID_BOOKING_TRANSITION",409,"INVALID_BOOKING_TRANSITION","此預約目前不能完成。"],
    ["BOOKING_CANCELLATION_PENDING",409,"BOOKING_CANCELLATION_PENDING","此預約仍有取消申請待處理。"],
    ["BOOKING_NOT_FINISHED_YET",409,"BOOKING_NOT_FINISHED_YET","預約服務時間尚未結束。"],
    ["BOOKING_ALREADY_COMPLETED_WITH_RECEIPT",409,"BOOKING_ALREADY_COMPLETED_WITH_RECEIPT","此預約已完成並綁定收據。"],
    ["RECEIPT_UPLOAD_IN_PROGRESS",409,"RECEIPT_UPLOAD_IN_PROGRESS","已有收據正在上傳，請稍後再試。"],
    ["RECEIPT_INVALID_MIME",400,"RECEIPT_INVALID_MIME","請拍攝或選擇支援的圖片格式。"],
    ["RECEIPT_FILE_TOO_LARGE",413,"RECEIPT_FILE_TOO_LARGE","收據圖片不可超過 5 MB。"],
    ["RECEIPT_INVALID_PATH",400,"RECEIPT_INVALID_PATH","收據上傳位置無效。"],
    ["RECEIPT_NOT_FOUND",404,"RECEIPT_NOT_FOUND","找不到這筆收據上傳。"],
    ["RECEIPT_NOT_OWNED",403,"RECEIPT_NOT_OWNED","不可操作其他會員的收據。"],
    ["RECEIPT_MIME_MISMATCH",400,"RECEIPT_MIME_MISMATCH","收據圖片格式與上傳資料不一致。"],
    ["RECEIPT_SIZE_MISMATCH",400,"RECEIPT_SIZE_MISMATCH","收據圖片大小與上傳資料不一致。"],
    ["RECEIPT_INVALID_HASH",400,"RECEIPT_INVALID_HASH","收據圖片驗證失敗。"],
    ["BOOKING_CONFLICT",409,"BOOKING_CONFLICT","預約資料已變更，請重新整理後再試。"],
    ["BOOKING_COMPLETION_ALREADY_SETTLED",409,"BOOKING_COMPLETION_ALREADY_SETTLED","此預約已完成結算。"],
    ["REQUEST_ID_CONFLICT",409,"REQUEST_ID_CONFLICT","同一操作識別不可套用不同內容。"],
    ["INVALID_REQUEST_ID",400,"INVALID_REQUEST_ID","操作識別格式不正確。"],
  ];
  for(const [needle,status,code,userMessage] of rules) if(message.includes(needle)) return new ApiError(status,code,userMessage);
  console.error(JSON.stringify({event:"booking_receipt_db_error",code:raw?.code||"",message:String(raw?.message||"").slice(0,300)}));
  return new ApiError(500,"DATABASE_ERROR","目前無法完成收據與預約操作。");
}
function extensionFor(mime:string):string{
  if(mime==="image/jpeg") return "jpg";
  if(mime==="image/png") return "png";
  if(mime==="image/webp") return "webp";
  if(mime==="image/heic") return "heic";
  return "heif";
}
function sniffMime(bytes:Uint8Array):string{
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff) return "image/jpeg";
  if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a) return "image/png";
  const ascii=(start:number,length:number)=>String.fromCharCode(...bytes.slice(start,start+length));
  if(bytes.length>=12&&ascii(0,4)==="RIFF"&&ascii(8,4)==="WEBP") return "image/webp";
  if(bytes.length>=12&&ascii(4,4)==="ftyp"){
    const brand=ascii(8,4).toLowerCase();
    if(["heic","heix","hevc","hevx"].includes(brand)) return "image/heic";
    if(["mif1","msf1","heif"].includes(brand)) return "image/heif";
  }
  return "";
}
async function drainCleanupQueue(supabase:SupabaseClient):Promise<void>{
  try{
    const rows=await supabase.from("booking_receipt_cleanup_queue").select("id,object_path,attempts").order("id",{ascending:true}).limit(20);
    if(rows.error||!rows.data?.length) return;
    for(const row of rows.data){
      const removed=await supabase.storage.from(BUCKET).remove([String(row.object_path)]);
      if(!removed.error){
        await supabase.from("booking_receipt_cleanup_queue").delete().eq("id",row.id);
      }else{
        await supabase.from("booking_receipt_cleanup_queue")
          .update({attempts:Number(row.attempts||0)+1,last_error:String(removed.error.message||"").slice(0,300)})
          .eq("id",row.id);
      }
    }
  }catch{ /* best-effort compensation; request path stays independent */ }
}
function localTaipeiNowMs():number{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`);
}
async function memberList(supabase:SupabaseClient,member:any):Promise<Json>{
  const result=await supabase.from("bookings")
    .select("id,status,updated_at,end_at,booking_date,end_time,starts_next_day,cancellation_requested_at,cancellation_reviewed_at,booking_receipts(receipt_id,status,created_at,bound_at,failure_reason)")
    .eq("member_id",member.id)
    .in("status",["confirmed","completed"])
    .order("booking_date",{ascending:false})
    .limit(80);
  if(result.error) throw new ApiError(500,"DATABASE_ERROR","預約收據資料暫時無法讀取。");
  const now=localTaipeiNowMs();
  const bookings=(result.data||[]).map((row:any)=>{
    const receipt=Array.isArray(row.booking_receipts)?row.booking_receipts.slice().sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null:null;
    const rawEndAt=String(row.end_at||"").trim().replace(" ","T");
    const normalizedEndAt=rawEndAt && !/(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(rawEndAt) ? rawEndAt+"+08:00" : rawEndAt;
    const endMs=normalizedEndAt?Date.parse(normalizedEndAt):Date.parse(`${row.booking_date}T${String(row.end_time||"00:00").slice(0,8)}+08:00`)+(row.starts_next_day?86400000:0);
    const cancellationPending=Boolean(row.cancellation_requested_at&&!row.cancellation_reviewed_at);
    return {
      bookingId:String(row.id),
      status:String(row.status||""),
      updatedAt:row.updated_at,
      canComplete:row.status==="confirmed"&&!cancellationPending&&Number.isFinite(endMs)&&now>=endMs,
      receipt:receipt?{
        receiptId:String(receipt.receipt_id||""),
        status:String(receipt.status||""),
        createdAt:receipt.created_at,
        boundAt:receipt.bound_at,
        failureReason:String(receipt.failure_reason||""),
      }:null,
    };
  });
  return {bookings};
}
async function prepare(supabase:SupabaseClient,identity:Identity,member:any,body:Json):Promise<Json>{
  const bookingId=asText(body.bookingId,80);
  const requestId=asText(body.requestId,120);
  const mime=asText(body.mimeType,80).toLowerCase();
  const size=Number(body.sizeBytes);
  if(!/^[0-9a-f-]{36}$/i.test(bookingId)) throw new ApiError(400,"INVALID_BOOKING_ID","預約識別格式不正確。");
  if(!ALLOWED_MIME.has(mime)) throw new ApiError(400,"RECEIPT_INVALID_MIME","請拍攝或選擇支援的圖片格式。");
  if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES) throw new ApiError(413,"RECEIPT_FILE_TOO_LARGE","收據圖片不可超過 5 MB。");

  const objectPath=`${member.id}/${bookingId}/${crypto.randomUUID()}.${extensionFor(mime)}`;
  const result=await supabase.rpc("prepare_booking_receipt_request",{
    p_booking_id:bookingId,p_member_id:member.id,p_request_id:requestId,
    p_object_path:objectPath,p_mime_type:mime,p_size_bytes:size
  });
  if(result.error) throw dbError(result.error);
  const prepared=(result.data||{}) as Json;
  const path=asText(prepared.objectPath,500);
  const signed=await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if(signed.error||!signed.data?.token) {
    await supabase.rpc("fail_booking_receipt_request",{p_receipt_id:prepared.receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,p_reason:"signed-upload-url-failed"});
    throw new ApiError(503,"RECEIPT_UPLOAD_UNAVAILABLE","目前無法建立安全上傳連結。");
  }
  return {
    receiptId:prepared.receiptId,
    objectPath:path,
    uploadToken:signed.data.token,
    uploadExpiresInSeconds:7200,
    alreadyPrepared:Boolean(prepared.alreadyPrepared),
  };
}
async function finalize(supabase:SupabaseClient,identity:Identity,member:any,body:Json):Promise<Json>{
  const receiptId=asText(body.receiptId,80);
  const expectedUpdatedAt=asText(body.expectedUpdatedAt,100);
  const receiptResult=await supabase.from("booking_receipts")
    .select("receipt_id,booking_id,member_id,object_path,declared_mime_type,declared_size_bytes,status")
    .eq("receipt_id",receiptId).maybeSingle();
  if(receiptResult.error) throw new ApiError(500,"DATABASE_ERROR","目前無法確認收據上傳。");
  const receipt=receiptResult.data;
  if(!receipt) throw new ApiError(404,"RECEIPT_NOT_FOUND","找不到這筆收據上傳。");
  if(String(receipt.member_id)!==String(member.id)) throw new ApiError(403,"RECEIPT_NOT_OWNED","不可操作其他會員的收據。");
  if(receipt.status==="bound"){
    const repeat=await supabase.rpc("complete_booking_with_receipt_request",{
      p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,
      p_expected_booking_updated_at:expectedUpdatedAt,p_actual_mime_type:receipt.declared_mime_type,
      p_actual_size_bytes:receipt.declared_size_bytes,p_sha256_hex:"0".repeat(64)
    });
    if(repeat.error) throw dbError(repeat.error);
    return (repeat.data||{}) as Json;
  }

  const downloaded=await supabase.storage.from(BUCKET).download(String(receipt.object_path));
  if(downloaded.error||!downloaded.data){
    await supabase.rpc("fail_booking_receipt_request",{p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,p_reason:"uploaded-object-missing"});
    throw new ApiError(409,"RECEIPT_UPLOAD_MISSING","找不到已上傳的收據圖片，請重新拍攝。");
  }
  if(downloaded.data.size<1||downloaded.data.size>MAX_FILE_BYTES){
    await supabase.rpc("fail_booking_receipt_request",{p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,p_reason:"actual-size-invalid"});
    await drainCleanupQueue(supabase);
    throw new ApiError(413,"RECEIPT_FILE_TOO_LARGE","收據圖片大小不符合限制。");
  }
  const bytes=await downloaded.data.arrayBuffer();
  const actualMime=sniffMime(new Uint8Array(bytes));
  const declared=String(receipt.declared_mime_type||"").toLowerCase();
  const heifPair=new Set([declared,actualMime]);
  const mimeMatches=declared===actualMime||(heifPair.has("image/heic")&&heifPair.has("image/heif"));
  if(!actualMime||!mimeMatches){
    await supabase.rpc("fail_booking_receipt_request",{p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,p_reason:"magic-mime-mismatch"});
    await drainCleanupQueue(supabase);
    throw new ApiError(400,"RECEIPT_MIME_MISMATCH","收據圖片實際格式與上傳資料不一致。");
  }
  if(downloaded.data.size!==Number(receipt.declared_size_bytes)){
    await supabase.rpc("fail_booking_receipt_request",{p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,p_reason:"actual-size-mismatch"});
    await drainCleanupQueue(supabase);
    throw new ApiError(400,"RECEIPT_SIZE_MISMATCH","收據圖片大小與上傳資料不一致。");
  }
  const hash=await fileSha256Hex(bytes);
  const completed=await supabase.rpc("complete_booking_with_receipt_request",{
    p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,
    p_expected_booking_updated_at:expectedUpdatedAt,p_actual_mime_type:declared,
    p_actual_size_bytes:downloaded.data.size,p_sha256_hex:hash
  });
  if(completed.error){
    await supabase.rpc("fail_booking_receipt_request",{p_receipt_id:receiptId,p_member_id:member.id,p_actor_line_user_id:identity.lineUserId,p_reason:"booking-completion-failed"});
    await drainCleanupQueue(supabase);
    throw dbError(completed.error);
  }
  return (completed.data||{}) as Json;
}
async function adminList(supabase:SupabaseClient):Promise<Json>{
  const result=await supabase.from("booking_receipts")
    .select("receipt_id,booking_id,status,bound_at,actual_mime_type,actual_size_bytes")
    .eq("status","bound")
    .order("bound_at",{ascending:false})
    .limit(200);
  if(result.error) throw new ApiError(500,"DATABASE_ERROR","收據快照暫時無法讀取。");
  return {receipts:(result.data||[]).map((row:any)=>({
    receiptId:String(row.receipt_id||""),bookingId:String(row.booking_id||""),status:String(row.status||""),
    boundAt:row.bound_at,mimeType:String(row.actual_mime_type||""),sizeBytes:Number(row.actual_size_bytes||0)
  }))};
}
async function adminUrl(supabase:SupabaseClient,body:Json):Promise<Json>{
  const bookingId=asText(body.bookingId,80);
  const result=await supabase.from("booking_receipts").select("receipt_id,object_path,bound_at")
    .eq("booking_id",bookingId).eq("status","bound").maybeSingle();
  if(result.error) throw new ApiError(500,"DATABASE_ERROR","收據快照暫時無法讀取。");
  if(!result.data) throw new ApiError(404,"RECEIPT_NOT_FOUND","此預約沒有可查看的收據快照。");

  const bookingResult=await supabase.from("bookings")
    .select("id,member_id,booking_date,start_time,end_time,starts_next_day,status,completed_at")
    .eq("id",bookingId).maybeSingle();
  if(bookingResult.error||!bookingResult.data) throw new ApiError(500,"DATABASE_ERROR","預約核對資料暫時無法讀取。");

  const [memberResult,itemsResult]=await Promise.all([
    supabase.from("members").select("member_code,display_name,surname,salutation").eq("id",bookingResult.data.member_id).maybeSingle(),
    supabase.from("booking_items").select("service_title,quantity,unit_price_amount,service_type").eq("booking_id",bookingId).order("created_at",{ascending:true}),
  ]);
  if(memberResult.error||itemsResult.error) throw new ApiError(500,"DATABASE_ERROR","預約核對資料暫時無法讀取。");

  const signed=await supabase.storage.from(BUCKET).createSignedUrl(String(result.data.object_path),120);
  if(signed.error||!signed.data?.signedUrl) throw new ApiError(503,"RECEIPT_VIEW_UNAVAILABLE","目前無法建立安全檢視連結。");

  const member:any=memberResult.data||{};
  return {
    receiptId:result.data.receipt_id,
    signedUrl:signed.data.signedUrl,
    expiresInSeconds:120,
    boundAt:result.data.bound_at,
    booking:{
      bookingId:String(bookingResult.data.id||""),
      bookingDate:String(bookingResult.data.booking_date||""),
      startTime:String(bookingResult.data.start_time||"").slice(0,5),
      endTime:String(bookingResult.data.end_time||"").slice(0,5),
      startsNextDay:Boolean(bookingResult.data.starts_next_day),
      status:String(bookingResult.data.status||""),
      completedAt:bookingResult.data.completed_at,
      member:{
        memberCode:String(member.member_code||""),
        displayName:String(member.display_name||""),
        surname:String(member.surname||""),
        salutation:String(member.salutation||""),
      },
      items:(itemsResult.data||[]).map((item:any)=>({
        title:String(item.service_title||"預約項目"),
        quantity:Math.max(1,Number(item.quantity||1)),
        unitPriceAmount:Math.max(0,Number(item.unit_price_amount||0)),
        serviceType:String(item.service_type||""),
      })),
    },
  };
}

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get("Origin");
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders(origin)});
  if(request.method!=="POST") return response(origin,{ok:false,error:{code:"METHOD_NOT_ALLOWED",message:"只支援 POST。"}},405);
  if(origin&&!allowedOrigins().has(origin)) return response(origin,{ok:false,error:{code:"ORIGIN_DENIED",message:"不允許的來源。"}},403);

  try{
    const body=await readJsonObject(request,MAX_REQUEST_BYTES,ApiError);
    const action=asText(body.action,100);
    const userActions=new Set(["user.booking.receipt.list","user.booking.receipt.prepare","user.booking.receipt.finalize"]);
    const adminActions=new Set(["admin.booking.receipt.list","admin.booking.receipt.url"]);
    if(!userActions.has(action)&&!adminActions.has(action)) throw new ApiError(404,"ACTION_NOT_FOUND","不支援的收據操作。");

    const supabase=dbClient();
    const expiredReceipts=await supabase.rpc("expire_stale_booking_receipts");
    if(expiredReceipts.error) console.warn("booking receipt stale cleanup failed", expiredReceipts.error.message);
    await drainCleanupQueue(supabase);

    let data:Json;
    if(userActions.has(action)){
      if(asText(body.clientType,20)!=="booking") throw new ApiError(403,"CLIENT_ACTION_MISMATCH","操作端與功能不相符。");
      const identity=await resolveUserIdentity(supabase,body);
      await consumeRateLimit(supabase,identity,action!=="user.booking.receipt.list");
      const member=await requireMember(supabase,identity);
      if(action==="user.booking.receipt.list") data=await memberList(supabase,member);
      else if(action==="user.booking.receipt.prepare") data=await prepare(supabase,identity,member,body);
      else data=await finalize(supabase,identity,member,body);
    }else{
      if(asText(body.clientType,20)!=="admin") throw new ApiError(403,"CLIENT_ACTION_MISMATCH","操作端與功能不相符。");
      const identity=await resolveAdminIdentity(body);
      await requireActiveAdminContract({supabase,identity,createError:(status,code,message,details=null)=>new ApiError(status,code,message,details)});
      await consumeRateLimit(supabase,identity,action==="admin.booking.receipt.url");
      data=action==="admin.booking.receipt.list"?await adminList(supabase):await adminUrl(supabase,body);
    }

    return response(origin,{ok:true,status:200,data});
  }catch(error){
    const e=error instanceof ApiError?error:new ApiError(500,"INTERNAL_ERROR","收據服務暫時無法完成操作。");
    return response(origin,{ok:false,status:e.status,error:{code:e.code,message:e.message,details:e.details}},e.status);
  }
});
