// GALOIR WhatsApp Cloud API dispatcher.
// Only authenticated, active GALOIR staff can invoke this endpoint.
// All message contents originate in the database triggers, never from the caller.
// Sending is disabled until an admin enables settings.whatsapp_enabled and sets WA_* secrets.
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
  const data = row.template_data || {};
  let name, values;
  if (row.event_type === 'order_confirmed') {
    name = config.confirmedName;
    values = [
      data.customer_name, data.slip_no, data.bill_no,
      formatRupees(data.total_amount), formatRupees(data.paid_amount),
      formatRupees(data.balance_amount), data.delivery_date
    ];
  } else if (row.event_type === 'ready_for_collection') {
    name = config.readyName;
    values = [data.customer_name, data.slip_no, data.bill_no, data.delivery_date];
  } else throw new Error('Unexpected queued event');
  if (!name || values.some(x => x === null || x === undefined || String(x).trim() === '')) {
    throw new Error('Missing template name or required message details');
  }
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error('Invalid WhatsApp template name');
  const to = String(row.phone_e164 || '').replace(/[^0-9]/g,'');
  if (!/^[1-9][0-9]{9,14}$/.test(to)) throw new Error('Invalid WhatsApp international phone number');
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name,
      language: {code: config.language},
      components: [{
        type: 'body',
        parameters: values.map(x => ({type:'text', text:String(x).trim().slice(0,1024)})),
      }],
    },
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
    const token = Deno.env.get('WA_ACCESS_TOKEN') || '';
    const phoneId = Deno.env.get('WA_PHONE_NUMBER_ID') || '';
    const confirmedName = Deno.env.get('WA_TEMPLATE_CONFIRMED') || 'galoir_order_confirmed_v1';
    const readyName = Deno.env.get('WA_TEMPLATE_READY') || 'galoir_ready_for_collection_v1';
    const language = Deno.env.get('WA_TEMPLATE_LANGUAGE') || 'en';
    const graph = Deno.env.get('WA_GRAPH_VERSION') || 'v25.0';
    const configured = token.length>20 && /^[0-9]{5,25}$/.test(phoneId)
      && /^[a-z0-9_]{1,512}$/.test(confirmedName)
      && /^[a-z0-9_]{1,512}$/.test(readyName)
      && /^[a-z_]{2,12}$/.test(language)
      && /^v[0-9]{1,2}\.[0-9]$/.test(graph);
    if (action === 'status') return reply(origin,{
      enabled, configured,
      note: configured?'Credentials present. Meta template approval must also be confirmed.':'Missing WhatsApp Cloud API credentials.',
      templates: {order_confirmation:confirmedName, ready_collection:readyName, language},
    });
    if (!enabled) return reply(origin,{enabled:false,configured,submitted:0,notice:'WhatsApp automation disabled by Admin'});
    if (!configured) return reply(origin,{enabled:true,configured:false,submitted:0,notice:'WhatsApp credentials missing'});
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
        const payload = templateFor(row,{confirmedName,readyName,language});
        const response = await fetch('https://graph.facebook.com/'+graph+'/'+phoneId+'/messages',{
          method:'POST',
          headers:{authorization:'Bearer '+token,'content-type':'application/json'},
          body:JSON.stringify(payload),
          signal:AbortSignal.timeout(18000),
        });
        const body = await response.json().catch(()=>({}));
        const messageId = body?.messages?.[0]?.id;
        if (!response.ok || !messageId) {
          throw new Error('Meta '+response.status+': '+String(body?.error?.message||'No message ID returned').slice(0,220));
        }
        await dbRequest('galoir_whatsapp_outbox?id=eq.'+encodeURIComponent(row.id),{
          method:'PATCH',
          data:{status:'submitted',submitted_at:new Date().toISOString(),provider_message_id:String(messageId),last_error:null},
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
    return reply(origin,{enabled:true,configured:true,submitted,failed,skipped,remaining:'Check notification log for pending entries'});
  } catch (_) {
    // Never leak service keys or request payloads in client-facing responses.
    return reply(origin,{error:'WhatsApp dispatch temporarily unavailable'},503);
  }
});
