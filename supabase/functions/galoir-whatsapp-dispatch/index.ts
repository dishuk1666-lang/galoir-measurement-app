// GALOIR WATI v3 API dispatcher.
// Only authenticated, active GALOIR staff can invoke this endpoint.
// All message contents originate in the database triggers, never from the caller.
// Sending is disabled until an admin enables settings.whatsapp_enabled and sets WATI_* secrets.
const allowedOrigins = ['https://app.galoir.com', 'https://galoir-measurement-app.vercel.app'];

function headersFor(origin) {
  const allowed = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'Origin',
  };
}
function reply(origin, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(origin) });
}
function projectKey(jsonName, legacy) {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === 'string' && parsed.default) return parsed.default;
    } catch (_) { /* fall back to legacy */ }
  }
  return Deno.env.get(legacy) || '';
}
function formatRupees(v) {
  const number = Number(v);
  if (!Number.isFinite(number) || number < 0) throw new Error('Invalid amount in queued invoice');
  return number.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2});
}
function templateFor(row, config) {
  const data=row.template_data||{};
  const event=row.event_type;
  const fields=event==='order_confirmed'?{
    customer_name:data.customer_name,slip_no:data.slip_no,bill_no:data.bill_no,
    total_amount:formatRupees(data.total_amount),paid_amount:formatRupees(data.paid_amount),
    balance_amount:formatRupees(data.balance_amount),delivery_date:data.delivery_date
  }:event==='ready_for_collection'?{
    customer_name:data.customer_name,slip_no:data.slip_no,bill_no:data.bill_no
  }:null;
  if(!fields)throw new Error('Unknown notification type');
  if(Object.values(fields).some(v=>v===null||v===undefined||String(v).trim()===''))throw new Error('Missing order details');
  const name=event==='order_confirmed'?config.confirmedName:config.readyName;
  if(!/^[a-z0-9_]{1,100}$/i.test(name))throw new Error('Invalid WATI template name');
  const phone=String(row.phone_e164||'').replace(/\D/g,'');
  if(!/^[1-9]\d{10,14}$/.test(phone))throw new Error('Invalid international WhatsApp phone');
  return {
    channel:config.channel,
    template_name:name,
    broadcast_name:'galoir_'+event+'_'+String(data.slip_no||'').replace(/[^a-z0-9]/gi,''),
    recipients:[{phone_number:phone,custom_params:Object.entries(fields).map(([key,value])=>({
      name:key,value:String(value).trim().slice(0,1024)
    }))}]
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || 'https://app.galoir.com';
  if (req.method === 'OPTIONS') return new Response(null, {status:204, headers:headersFor(origin)});
  if (req.method !== 'POST') return reply(origin, {error:'Method not allowed'}, 405);
  const url = Deno.env.get('SUPABASE_URL') || '';
  const secretKey = projectKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
  const publicKey = projectKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
  if (!url || !secretKey || !publicKey) return reply(origin,{error:'Server settings unavailable'},503);
  const authorization = req.headers.get('authorization') || '';
  const bearer = authorization.match(/^Bearer (.+)$/i);
  if (!bearer) return reply(origin,{error:'Login required'},401);

  // Verify signed-in user with Supabase Auth; never trust the caller's claimed user ID or role.
  const authCheck = await fetch(url+'/auth/v1/user',{
    headers:{apikey:publicKey, authorization:'Bearer '+bearer[1]},
  }).catch(()=>null);
  if (!authCheck?.ok) return reply(origin,{error:'Session expired or invalid'},401);
  const caller = await authCheck.json().catch(()=>null);
  if (!caller?.id) return reply(origin,{error:'Session unavailable'},401);

  const dbHeaders = {
    apikey: secretKey,
    ...(secretKey.startsWith('eyJ')? {authorization:'Bearer '+secretKey}: {}),
    'content-type':'application/json',
    accept:'application/json',
  };
  async function dbRequest(path, opts={}) {
    const result = await fetch(url+'/rest/v1/'+path, {
      method:opts.method || 'GET',
      headers:{...dbHeaders,...(opts.prefer?{'prefer':opts.prefer}:{})},
      ...(opts.data===undefined?{}:{body:JSON.stringify(opts.data)}),
    });
    const body = await result.text();
    if(!result.ok) throw new Error('Database operation failed: '+result.status);
    return body?JSON.parse(body):null;
  }
  try {
    const profile = await dbRequest('profiles?id=eq.'+encodeURIComponent(caller.id)+'&select=active,role&limit=1');
    if (!profile?.[0]?.active || !['admin','manager','sales','tailoring'].includes(profile[0].role)) {
      return reply(origin,{error:'Staff account is not active or authorized'},403);
    }
    const input = await req.json().catch(()=>({}));
    const action = input?.action;
    if (action !== 'status' && action !== 'dispatch') return reply(origin,{error:'Unsupported action'},400);
    const settings = await dbRequest('settings?id=eq.1&select=whatsapp_enabled&limit=1');
    const enabled = settings?.[0]?.whatsapp_enabled === true;
    const token=Deno.env.get('WATI_API_TOKEN')||'';
    const channel=String(Deno.env.get('WATI_CHANNEL_NUMBER')||'').replace(/\D/g,'');
    const confirmedName=Deno.env.get('WATI_TEMPLATE_ORDER_CONFIRMED')||'galoir_order_finalised_wati_v1';
    const readyName=Deno.env.get('WATI_TEMPLATE_READY_FOR_COLLECTION')||'galoir_ready_for_collection_wati_v1';
    const configured=token.length>20&&/^[1-9]\d{10,14}$/.test(channel)
      &&/^[a-z0-9_]{1,100}$/i.test(confirmedName)&&/^[a-z0-9_]{1,100}$/i.test(readyName);
    if (action === 'status') return reply(origin,{
      enabled, configured,
      note: configured?'WATI token and channel present. Verify both Utility templates are approved in WATI.':'WATI API token or channel not configured.',
      provider:'WATI v3',templates: {order_confirmation:confirmedName, ready_collection:readyName},
    });
    if (!enabled) return reply(origin,{enabled:false,configured,submitted:0,notice:'WhatsApp automation disabled by Admin'});
    if (!configured) return reply(origin,{enabled:true,configured:false,submitted:0,notice:'WATI token, channel or approved templates missing'});
    const queued = await dbRequest('galoir_whatsapp_outbox?status=eq.pending&order=created_at.asc&limit=10&select=*');
    let submitted = 0, failed = 0, skipped = 0;
    for (const row of queued||[]) {
      // Atomic claim: two browser sessions never send the same queue item simultaneously.
      const claimed = await dbRequest('galoir_whatsapp_outbox?id=eq.'+encodeURIComponent(row.id)+'&status=eq.pending',{
        method:'PATCH',prefer:'return=representation',
        data:{status:'processing',claimed_at:new Date().toISOString(),attempts:Number(row.attempts||0)+1},
      });
      if (!Array.isArray(claimed) || claimed.length !== 1) {skipped++;continue}
      try {
        const payload=templateFor(row,{confirmedName,readyName,channel});
        const response=await fetch('https://live-mt-server.wati.io/api/ext/v3/messageTemplates/send',{
          method:'POST',
          headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'},
          body:JSON.stringify(payload),
          signal:AbortSignal.timeout(18000),
        });
        const body=await response.json().catch(()=>({}));
        const receivers=body?.receivers||body?.recipients||[];
        const errors=Array.isArray(receivers)?receivers.flatMap(r=>r?.errors||[]):[];
        if(!response.ok||body?.result===false||body?.error||errors.length){
          throw new Error('WATI '+response.status+': '+String(body?.error||body?.message||
            (errors.length?JSON.stringify(errors):'Template rejected')).slice(0,220));
        }
        // Accepted by WATI does not prove final delivery.
        const messageId=receivers?.[0]?.localMessageId||body?.localMessageId||body?.message_id||null;
        await dbRequest('galoir_whatsapp_outbox?id=eq.'+encodeURIComponent(row.id),{
          method:'PATCH',
          data:{status:'submitted',submitted_at:new Date().toISOString(),provider_message_id:messageId?String(messageId):null,last_error:null},
        });
        submitted++;
      } catch (e) {
        // A timeout may have been accepted upstream; avoid blind retries and duplicate customer messages.
        await dbRequest('galoir_whatsapp_outbox?id=eq.'+encodeURIComponent(row.id),{
          method:'PATCH',
          data:{status:'failed',last_error:String(e?.message||e).slice(0,450)},
        });
        failed++;
      }
    }
    return reply(origin,{enabled:true,configured:true,submitted,failed,skipped,provider:'WATI v3',remaining:'Accepted by WATI; delivery/read in WATI dashboard'});
  } catch (_) {
    // Never leak service keys or request payloads in client-facing responses.
    return reply(origin,{error:'WhatsApp dispatch temporarily unavailable'},503);
  }
});
