// GALOIR WATI integration: server-side, opt-in-only, no client-side WATI credentials.
// WATI v3 send endpoint: https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send
// Required Supabase Edge secrets:
// WATI_API_TOKEN, WATI_CHANNEL_NUMBER, WATI_TEMPLATE_ORDER_CONFIRMED,
// WATI_TEMPLATE_READY_FOR_COLLECTION, WATI_NOTIFICATIONS_ENABLED=true
// Only activated explicitly after token + approved Utility templates are installed.
const CORS={
  "Access-Control-Allow-Origin":"https://app.galoir.com",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json",
};
const asJson=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:CORS});
const env=(key:string)=>String(Deno.env.get(key)||"").trim();
function formatPhone(raw:string):string{
  let phone=String(raw||"").replace(/\D/g,"");
  if(phone.startsWith("00"))phone=phone.slice(2);
  if(phone.length===10)phone="91"+phone;
  if(!/^[1-9]\d{10,14}$/.test(phone))throw new Error("Customer WhatsApp number is missing/invalid country code");
  return phone;
}
function rupees(n:number):string{
  return "₹"+new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
}
function indianDate(value:string):string{
  if(!/^\d{4}-\d\d-\d\d$/.test(String(value)))throw new Error("No valid delivery date on booked order");
  return new Date(value+"T12:00:00Z").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"});
}
const supabase=env("SUPABASE_URL");
const serviceKey=env("SUPABASE_SERVICE_ROLE_KEY");
if(!supabase||!serviceKey)throw Error("Missing Supabase server configuration");
const adminHeaders={
  apikey:serviceKey,
  Authorization:"Bearer "+serviceKey,
  "Content-Type":"application/json",
};
async function rest(path:string,init:RequestInit={}):Promise<any>{
  const response=await fetch(supabase+"/rest/v1/"+path,{
    ...init,headers:{...adminHeaders,...(init.headers||{})},
  });
  const body=await response.text();
  if(!response.ok)throw new Error("Database request failed ("+response.status+"): "+body.slice(0,250));
  if(!body)return null;
  try{return JSON.parse(body)}catch{return body}
}
async function getSingle(table:string,query:string):Promise<any>{
  const rows=await rest(table+"?"+query+"&limit=1");
  return Array.isArray(rows)?rows[0]||null:null;
}
async function patchOutbox(id:string,status:string,extra:Record<string,unknown>={}):Promise<void>{
  await rest("wati_notification_outbox?id=eq."+encodeURIComponent(id),{
    method:"PATCH",
    body:JSON.stringify({status,updated_at:new Date().toISOString(),...extra})
  });
}
const param=(key:string,val:string)=>({name:key,value:String(val??"")});
async function sendEvent(job:any,token:string,channel:string,orderTemplate:string,readyTemplate:string):Promise<void>{
  const m=await getSingle("measurements","id=eq."+encodeURIComponent(job.measurement_id)+
    "&select=id,slip_no,bill_no,workflow_status,customer_id,whatsapp_opt_in,paid_amount,final_billing_amount");
  if(!m||m.workflow_status!=="billed"||m.whatsapp_opt_in!==true||m.paid_amount===null){
    await patchOutbox(job.id,"skipped",{last_error:"No longer billed, opted in, or payment data missing"});return;
  }
  const order=await getSingle("orders","measurement_id=eq."+encodeURIComponent(m.id)+
    "&select=id,delivery_date,is_ready,status");
  if(!order)throw new Error("Booked order not found for slip");
  if(job.event_type==="ready_for_collection"&&(!order.is_ready||order.status==="delivered")){
    await patchOutbox(job.id,"skipped",{last_error:"Order no longer waiting for ready collection"});return;
  }
  const customer=await getSingle("customers","id=eq."+encodeURIComponent(m.customer_id)+"&select=full_name,phone");
  if(!customer)throw new Error("Customer record not found");
  const recipient=formatPhone(customer.phone);
  const name=String(customer.full_name||"Customer").trim().slice(0,120);
  const bill=String(m.bill_no||"").trim();
  const slip=String(m.slip_no||"").trim();
  if(!bill||!slip)throw new Error("Order slip or bill number missing");
  let parameters:any[],templateName:string;
  if(job.event_type==="order_confirmed"){
    const total=Number(m.final_billing_amount),paid=Number(m.paid_amount);
    if(!Number.isFinite(total)||!Number.isFinite(paid)||total<=0||paid<0||paid>total){
      throw new Error("Total or paid amount invalid");
    }
    templateName=orderTemplate;
    parameters=[
      param("customer_name",name),param("bill_no",bill),param("slip_no",slip),
      param("total_amount",rupees(total)),param("paid_amount",rupees(paid)),
      param("balance_amount",rupees(Math.round((total-paid)*100)/100)),
      param("delivery_date",indianDate(order.delivery_date))
    ];
  }else if(job.event_type==="ready_for_collection"){
    templateName=readyTemplate;
    parameters=[param("customer_name",name),param("slip_no",slip),param("bill_no",bill)];
  }else throw new Error("Unknown notification type");

  const payload={
    channel,
    template_name:templateName,
    broadcast_name:"galoir_"+job.event_type+"_"+slip,
    recipients:[{phone_number:recipient,custom_params:parameters}]
  };
  const wati=await fetch("https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(16000)
  });
  const raw=await wati.text();
  let result:any={};try{result=JSON.parse(raw)}catch{result={text:raw}}
  if(!wati.ok||result?.result===false||result?.error){
    throw new Error("WATI rejected template ("+wati.status+"): "+String(result?.error||result?.message||raw).slice(0,240));
  }
  const receivers=result?.receivers||result?.recipients||[];
  const errors=Array.isArray(receivers)?receivers.flatMap((r:any)=>r?.errors||[]):[];
  if(errors.length)throw new Error("WATI receiver rejected: "+JSON.stringify(errors).slice(0,220));
  const messageId=receivers[0]?.localMessageId||result?.localMessageId||result?.message_id||null;
  await patchOutbox(job.id,"accepted",{
    accepted_at:new Date().toISOString(),
    wati_message_id:messageId,
    last_error:null
  });
}
Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return asJson({error:"POST required"},405);
  try{
    const bearer=req.headers.get("authorization")||"";
    if(!/^Bearer\s+\S+$/i.test(bearer))return asJson({error:"User login required"},401);
    // Supabase user JWT checked again in Auth; an API key alone cannot dispatch messages.
    const auth=await fetch(supabase+"/auth/v1/user",{
      headers:{apikey:serviceKey,authorization:bearer}
    });
    if(!auth.ok)return asJson({error:"Invalid or expired user session"},401);
    const user=await auth.json();
    if(!user?.id)return asJson({error:"User required"},401);
    const profile=await getSingle("profiles","id=eq."+encodeURIComponent(user.id)+"&select=role,active");
    if(!profile?.active||!["admin","manager","sales","tailoring"].includes(profile.role))
      return asJson({error:"Staff role not authorized"},403);

    const token=env("WATI_API_TOKEN");
    const channel=env("WATI_CHANNEL_NUMBER").replace(/\D/g,"");
    const orderTemplate=env("WATI_TEMPLATE_ORDER_CONFIRMED");
    const readyTemplate=env("WATI_TEMPLATE_READY_FOR_COLLECTION");
    if(env("WATI_NOTIFICATIONS_ENABLED")!=="true"||!token||!channel||!orderTemplate||!readyTemplate)
      return asJson({configured:false,accepted:0,failed:0,
        info:"WATI sending disabled until token, sending channel and two approved templates are configured."});
    if(!/^\d{11,15}$/.test(channel)||!(/^[a-z0-9_]{1,100}$/i.test(orderTemplate)&&/^[a-z0-9_]{1,100}$/i.test(readyTemplate)))
      return asJson({configured:false,error:"Invalid WATI channel number or template names"},503);
    const pending=await rest("wati_notification_outbox?status=eq.pending&order=created_at.asc&limit=10&select=id,measurement_id,event_type,attempts");
    let accepted=0,failed=0,skipped=0;
    for(const job of (pending||[])){
      // Atomic compare-and-set prevents two staff devices sending the same event.
      const claimed=await rest("wati_notification_outbox?id=eq."+encodeURIComponent(job.id)+
        "&status=eq.pending&select=id",{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({status:"processing",locked_at:new Date().toISOString(),attempts:job.attempts+1,updated_at:new Date().toISOString()})
      });
      if(!Array.isArray(claimed)||!claimed.length)continue;
      try{
        await sendEvent(job,token,channel,orderTemplate,readyTemplate);
        const outcome=await getSingle("wati_notification_outbox","id=eq."+encodeURIComponent(job.id)+"&select=status");
        if(outcome?.status==="accepted")accepted++;
        else skipped++;
      }catch(e){
        failed++;
        await patchOutbox(job.id,"failed",{
          last_error:String(e instanceof Error?e.message:e).slice(0,500)
        });
      }
    }
    return asJson({configured:true,accepted,failed,skipped,
      info:"Accepted means WATI accepted the message request; final WhatsApp delivery is tracked by WATI."});
  }catch(e){
    return asJson({error:"WATI dispatcher error",detail:String(e instanceof Error?e.message:e).slice(0,280)},500);
  }
});