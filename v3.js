
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.GALOIR_CONFIG||{};const ready=cfg.supabaseUrl?.startsWith('https://')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.startsWith('REPLACE_');
const sb=ready?createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Display-only redaction: full numbers stay available for exact customer lookup and WATI.
function maskCustomerPhone(value){
 const digits=String(value??'').replace(/\D/g,'');
 if(!digits)return '—';
 return digits.length<=4?'••••':'••••••'+digits.slice(-4);
}
function phoneForDisplay(value){return role==='sales'?maskCustomerPhone(value):String(value||'—')}
const dateStr=d=>{let y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
let today=dateStr(new Date());let me=null,role=null,tab='dashboard',customers=[],measurements=[],orders=[],profiles=[],salespeople=[],capacity=20,lastCreated=null,lastBilledSlipId=null,editingDraftId=null,manualEditingId=null,manualImportSearch='',manualLastImportedGL='',recordedAudio=null,activeRecorder=null,recordingStream=null,lastReadyScanResult=null,statusSearchQuery='',waEnabled=false,waNotifications=[],waConfiguration=null,waDispatchLast=0,waDispatchBusy=false,month=new Date(),selectedDate=today;
const allowed={admin:['dashboard','measurements','manual_import','scanner','alerts','customers','cashier','calendar','daily','tailoring','settings','salespeople','staff','reports'],manager:['dashboard','measurements','manual_import','scanner','alerts','customers','cashier','calendar','daily','tailoring','settings','reports'],sales:['dashboard','measurements','scanner','alerts','customers','cashier','calendar','daily'],tailoring:['dashboard','measurements','scanner','alerts','customers','daily','tailoring']};
const titles={dashboard:'Dashboard',scanner:'Scan Ready Outfit',alerts:'Reminders',customers:'Customers',measurements:'Measurements',manual_import:'Manual Booklet Orders',cashier:'Billing Desk',calendar:'Delivery Calendar',daily:'Daily Deliveries',tailoring:'Tailoring Board',settings:'Capacity Settings',salespeople:'Salespeople',staff:'Staff Management',reports:'Reports'};
const can=a=>({admin:['customers','measurements','bookings','daily','tailoring','capacity','reports','staff'],manager:['customers','measurements','bookings','daily','tailoring','capacity','reports'],sales:['customers','measurements','bookings','daily'],tailoring:['daily','tailoring']}[role]||[]).includes(a);
function notify(s){$('notice').textContent=s;$('notice').classList.remove('hidden');setTimeout(()=>$('notice').classList.add('hidden'),4500)}
function error(e){notify('Error: '+(e?.message||e));console.error(e)}
async function query(table,fields='*'){const pageSize=500;let offset=0;const rows=[];while(true){const {data,error:e}=await sb.from(table).select(fields).range(offset,offset+pageSize-1);if(e)throw e;rows.push(...(data||[]));if(!data||data.length<pageSize)break;offset+=pageSize}return rows}

const formatInr=v=>'₹'+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
async function whatsappConnectionStatus(){
 const {data,error:e}=await sb.functions.invoke('galoir-whatsapp-dispatch',{body:{action:'status'}});
 if(e)throw e;
 waConfiguration=data||null;
 return waConfiguration;
}
async function dispatchPendingWhatsapp(force=false){
 if(!waEnabled||!sb||waDispatchBusy||(!force&&Date.now()-waDispatchLast<12000))return null;
 waDispatchBusy=true;waDispatchLast=Date.now();
 try{
  const {data,error:e}=await sb.functions.invoke('galoir-whatsapp-dispatch',{body:{action:'dispatch'}});
  if(e)throw e;
  return data;
 }catch(e){
  console.warn('WhatsApp notification dispatch pending:',e?.message||e);
  return null;
 }finally{waDispatchBusy=false}
}
function updateCashierBalance(form){
 const total=Number(form.querySelector('[name="final_billing_amount"]')?.value);
 const paidInput=form.querySelector('[name="paid_amount"]'),balance=form.querySelector('.cashierBalance');
 if(!paidInput||!balance)return;
 const entered=String(paidInput.value||'').trim(),paid=Number(entered);
 const invalid=entered!==''&&(!Number.isFinite(paid)||paid<0||!Number.isFinite(total)||paid>total);
 balance.textContent=entered===''?'Enter amount paid':invalid?'Paid amount cannot exceed the total':formatInr(total-paid);
 balance.classList.toggle('payment-invalid',invalid);
}

async function refresh(){today=dateStr(new Date());const [a,b,c,d,e]=await Promise.all([query('customers'),query('measurements'),query('orders'),query('settings'),query('salespeople')]);customers=a;measurements=b;orders=c;salespeople=e;capacity=d[0]?.daily_capacity||20;waEnabled=d[0]?.whatsapp_enabled===true;if(role==='admin')profiles=await query('profiles');if(tab==='settings'){const {data,error:queueError}=await sb.from('galoir_whatsapp_outbox').select('id,measurement_id,event_type,status,created_at,submitted_at,attempts,last_error').order('created_at',{ascending:false}).limit(60);waNotifications=queueError?[]:data||[]}render();if(waEnabled)void dispatchPendingWhatsapp()}
function customerName(id){return customers.find(x=>x.id===id)?.full_name||'Customer'}
function countDate(d){return orders.filter(x=>x.delivery_date===d&&x.order_type!=='new_make').length}
function newCount(d){return orders.filter(x=>x.delivery_date===d&&x.order_type==='new_make').length}
function daysUntil(d){return Math.round((Date.parse(d+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000)}
function activeOrders(){return orders.filter(o=>o.status!=='delivered'&&!o.is_ready)}
function supplierAlerts(){return activeOrders().filter(o=>o.order_type==='new_make'&&!o.supplier_notified_at&&daysUntil(o.delivery_date)<=2)}
function alterationAlerts(){return activeOrders().filter(o=>o.order_type!=='new_make'&&daysUntil(o.delivery_date)<=Number(o.days_required??2))}
function outputDate(d){return d?new Date(d+'T12:00:00').toLocaleDateString('en-IN'):'—'}
const canImportManual=()=>role==='admin'||role==='manager';
function render(){if(!role)return;const menu=allowed[role]||[];
 if(tab==='measurements'&&editingDraftId&&measurements.length&&
    !measurements.some(m=>m.id===editingDraftId&&m.workflow_status==='draft')){
   clearMeasurementRecovery();editingDraftId=null;
   notify('This draft is no longer editable. Start a new slip if needed.');
 }if(!menu.includes(tab))tab=menu[0]||'daily';$('heading').textContent=titles[tab];$('who').textContent=`${esc(me.email)} · ${role}`;$('nav').innerHTML=menu.map(x=>`<button data-tab="${x}" class="${tab===x?'active':''}">${titles[x]}</button>`).join('');$('nav').querySelectorAll('button').forEach(b=>b.onclick=async()=>{if(tab==='measurements')captureMeasurementRecovery();stopBarcodeScan();stopReadyCamera();tab=b.dataset.tab;try{await refresh()}catch(x){error(x)}});const f={dashboard:dashboardView,scanner:readyScannerView,alerts:alertsView,customers:customersView,measurements:measurementsView,manual_import:manualImportView,cashier:cashierView,calendar:calendarView,daily:dailyView,tailoring:tailoringView,settings:settingsView,salespeople:salespeopleView,staff:staffView,reports:reportsView};$('view').innerHTML=f[tab]();bind()}
function masterRoomDate(o){
 const delivery=Date.parse(String(o.delivery_date||'')+'T00:00:00Z');
 if(!Number.isFinite(delivery))return '';
 const days=Math.max(0,Number(o.days_required)||0);
 return new Date(delivery-days*86400000).toISOString().slice(0,10);
}
function istDate(v){return v?new Date(new Date(v).getTime()+330*60000).toISOString().slice(0,10):''}
function masterRoomToday(){
 return orders.filter(o=>o.order_type==='self_alter'&&o.status!=='delivered'&&!o.is_ready&&masterRoomDate(o)<=today
 &&(!o.master_room_sent_at||istDate(o.master_room_sent_at)===today))
 .sort((a,b)=>a.delivery_date.localeCompare(b.delivery_date));
}
function deliveriesToday(){return orders.filter(o=>o.delivery_date===today||(o.delivery_date<today&&o.status!=='delivered')).sort((a,b)=>Number(a.status==='delivered')-Number(b.status==='delivered')||String(a.delivery_date).localeCompare(String(b.delivery_date)))}
function worklistRow(o,kind){
 const m=measurements.find(x=>x.id===o.measurement_id);
 const c=customers.find(x=>x.id===o.customer_id);
 const alreadyDelivered=o.status==='delivered';
 const sent=!!o.master_room_sent_at;
 const isMaster=kind==='master';
 const checked=isMaster?sent:alreadyDelivered;
 const blocked=!isMaster&&!o.is_ready&&!alreadyDelivered;
 const label=isMaster?'Sent to master room':'Delivered to customer';
 const badge=isMaster?(sent?'Sent to master':'Awaiting handoff'):(alreadyDelivered?'Delivered':o.is_ready?'Ready for delivery':'Not ready');
 const extra=isMaster?`<small class="worklist-date">${masterRoomDate(o)<today?'⚠ Overdue for master room':'Send today'} · Delivery ${esc(outputDate(o.delivery_date))}</small>`:
 `<small class="worklist-date">${o.delivery_date<today?'⚠ Overdue · original delivery ':'Delivery '}${esc(outputDate(o.delivery_date))} · ${o.is_ready?'Outfit ready':'Outfit not ready'}</small>`;
 return `<article class="worklist-row ${checked?'worklist-checked':''}">
 <div class="worklist-entry">
  <strong>${esc(c?.full_name||customerName(o.customer_id))}</strong>
  <span>${esc(phoneForDisplay(c?.phone))} · <b>${esc(m?.slip_no||'No GL slip')}</b></span>
  <span>${esc(o.item_name)} · ${o.order_type==='new_make'?'New Make':'Self Alter'}</span>
  ${extra}
  <span class="worklist-status">${esc(badge)}</span>
 </div>
 <label class="worklist-check">
  <input type="checkbox" ${isMaster?'data-master-id':'data-deliver-id'}="${esc(o.id)}" ${checked?'checked':''} ${blocked?'disabled':''}>
  <span>${label}</span>
 </label>
 </article>`;
}
function phoneStatusMatch(phone,search){
 const full=String(phone||'').replace(/\D/g,''),term=String(search||'').replace(/\D/g,'');
 if(term.length<7||term.length>15)return false;
 if(full===term)return true;
 return term.length===10&&full==='91'+term || term.length===12&&term.startsWith('91')&&full===term.slice(2);
}
function computeOutfitStatus(order){
 if(!order)return {label:'Awaiting Billing',cls:'draft',note:'Unbilled draft. No delivery date is confirmed yet.'};
 if(order.status==='delivered')return {label:'Delivered',cls:'delivered',note:'Customer delivery is marked complete.'};
 if(order.is_ready)return {label:'Ready',cls:'ready',note:'Outfit has been marked ready. Confirm pickup arrangements with the store.'};
 const due=String(order.delivery_date||'');
 if(due&&due<today)return {label:'Delivery Overdue',cls:'overdue',note:'Scheduled delivery date has passed. Store staff should confirm a revised date.'};
 if(order.order_type==='self_alter'){
  if(order.master_room_sent_at)return {label:'Sent to Master Room',cls:'master',note:'Alteration work is in progress. The outfit is not yet marked ready.'};
  if(masterRoomDate(order)>today)return {label:'Date Not Due',cls:'notdue',note:'Master-room preparation is scheduled for '+outputDate(masterRoomDate(order))+'.'};
  return {label:'Send to Master Room',cls:'attention',note:'Preparation date has arrived; outfit is awaiting master-room handoff.'};
 }
 if(due&&daysUntil(due)>2)return {label:'Date Not Due',cls:'notdue',note:'New Make order is booked. Supplier follow-up is scheduled two days before delivery.'};
 if(!order.supplier_notified_at)return {label:'Supplier Follow-Up Due',cls:'attention',note:'New Make supplier should be contacted to confirm readiness.'};
 return {label:'Awaiting Supplier',cls:'master',note:'Supplier has been notified. Outfit is not yet marked ready.'};
}
function statusLookupResults(query){
 const raw=String(query||'').trim();
 if(!raw)return '<p class="muted">Enter a phone, GL slip, old manual slip or bill number to check its status.</p>';
 const slip=raw.toUpperCase().replace(/[\s-]/g,'');
 const isSlip=/^GL\d{1,16}$/.test(slip);
 const isPhone=/^[+()\d\s-]+$/.test(raw)&&/^\d{7,15}$/.test(raw.replace(/\D/g,''));
 // Exact bill-number match (case-insensitive), including short numeric and alphanumeric bills.
 // Check phone, GL slip and bill together so a numeric bill matching a phone is not missed.
 const billLookup=raw.toLowerCase();
 const custIds=new Set(isPhone?customers.filter(c=>phoneStatusMatch(c.phone,raw)).map(c=>c.id):[]);
 const foundMeasurements=measurements.filter(m=>
  (isSlip&&String(m.slip_no||'').toUpperCase()===slip)||
  (String(m.bill_no||'').trim()!==''&&String(m.bill_no).trim().toLowerCase()===billLookup)||
  (m.imported_from_manual&&(
    String(m.manual_slip_no||'').trim().toLowerCase()===billLookup||
    (String(m.manual_booklet_name||'').trim()+'/'+String(m.manual_slip_no||'').trim()).toLowerCase()===billLookup))||
  custIds.has(m.customer_id));
 const slipIds=new Set(foundMeasurements.map(m=>m.id));
 const foundOrders=orders.filter(o=>slipIds.has(o.measurement_id)||custIds.has(o.customer_id));
 const bySlip=new Map(foundOrders.filter(o=>o.measurement_id).map(o=>[o.measurement_id,o]));
 const results=foundMeasurements.map(m=>({m,o:bySlip.get(m.id)||null}));
 const linkedOrderIds=new Set(results.map(r=>r.o?.id).filter(Boolean));
 for(const o of foundOrders)if(!linkedOrderIds.has(o.id))results.push({m:null,o});
 if(!results.length)return '<p class="status-lookup-message">No matching bill number, measurement slip, or customer phone number found. Enter the full phone number or exact bill number.</p>';
 results.sort((a,b)=>String(b.o?.delivery_date||b.m?.created_at||'').localeCompare(String(a.o?.delivery_date||a.m?.created_at||'')));
 const count=results.length;
 const cards=results.slice(0,60).map(({m,o})=>{
  const c=customers.find(x=>x.id===(m?.customer_id||o?.customer_id));
  const state=computeOutfitStatus(o),due=String(o?.delivery_date||'');
  const expectation=!o?'Not confirmed — billing pending':due&&due<today&&o.status!=='delivered'?
   'Overdue (booked '+outputDate(due)+')':outputDate(due);
  const makeType=o?.order_type||m?.order_type;
  return `<article class="status-result-card">
   <div class="status-result-top"><strong>${esc(m?.slip_no||'Booking without GL slip')}</strong>
     <span class="status-pill ${state.cls}">${esc(state.label)}</span></div>
   <div class="status-result-details">
    <div><span>Customer</span><strong>${esc(c?.full_name||'Customer')}</strong></div>
    <div><span>Phone</span><strong>${esc(phoneForDisplay(c?.phone))}</strong></div>
    <div><span>Bill Number</span><strong>${esc(m?.bill_no||'Pending Billing')}</strong></div>
    ${m?.imported_from_manual?`<div><span>Old Manual Slip</span><strong>${esc(m.manual_slip_no||'—')}</strong></div>
     <div><span>Booklet</span><strong>${esc(m.manual_booklet_name||'—')}</strong></div>`:''}
    <div><span>Outfit</span><strong>${esc(o?.item_name||m?.item_name||'—')}</strong></div>
    <div><span>Order Type</span><strong>${makeType==='new_make'?'New Make':'Self Alter'}</strong></div>
    <div><span>Expected Delivery</span><strong>${esc(expectation)}</strong></div>
    <div><span>Master Room Date</span><strong>${o?.order_type==='self_alter'?esc(outputDate(masterRoomDate(o))):'—'}</strong></div>
   </div><p class="status-description">${esc(state.note)}${o&&due>=today&&o.status!=='delivered'?' This is the booked delivery date, subject to outfit readiness.':''}</p>
   ${m?`<div class="status-result-actions">
    <button type="button" class="btn alt" data-status-view="${esc(m.id)}">View Measurements</button>
    ${m.photo_path?`<button type="button" class="btn alt" data-status-photo="${esc(m.id)}">View Photo</button>`:''}
    ${m.manual_booklet_photo_path?`<button type="button" class="btn alt" data-status-booklet="${esc(m.id)}">View Booklet Page</button>`:''}
    ${m.workflow_status==='billed'&&m.bill_no?`<button type="button" class="btn" data-status-print="${esc(m.id)}">View / Print A4 Slip</button>`:''}
   </div>`:'<p class="muted">No measurement slip is linked to this booking.</p>'}
  </article>`;
 }).join('');
 return `<p class="status-result-count">${count} matching record${count===1?'':'s'}${count>60?' · showing first 60':''}</p>
 <div class="status-result-grid">${cards}</div>`;
}
function statusSlipPreviewHtml(m){
 const c=customers.find(x=>x.id===m.customer_id);
 const order=orders.find(o=>o.measurement_id===m.id);
 const billed=m.workflow_status==='billed'&&Boolean(m.bill_no);
 const measureValue=v=>v==null||String(v).trim()==='0'?'':String(v).trim();
 const meta=[
  ['GL Slip Number',m.slip_no||'—'],['Stage',billed?'Billed':'Draft'],
  ['Customer',c?.full_name||'—'],['Phone',phoneForDisplay(c?.phone)],
  ['Outfit',m.item_name||order?.item_name||'—'],['Order Type',m.order_type==='new_make'?'New Make':'Self Alter'],
  ['Salesperson',m.salesperson_name||'—'],['Delivery Date',m.delivery_date?outputDate(m.delivery_date):'Not booked'],
  ['Bill Number',m.bill_no||'Pending'],['Design Number',m.design_number||'—'],
  ['Product Barcode',m.product_barcode||'—'],['Preparation Days',m.days_required??'—'],
  ...(m.imported_from_manual?[['Old Manual Slip',m.manual_slip_no||'—'],['Booklet',m.manual_booklet_name||'—']]:[]),
  ['Company',m.company_name||'—'],['Reviewed By',m.reviewed_by||'—'],
  ['Size Basis',m.ready_body||'—']
 ];
 const groups=Object.entries(measureGroups).map(([g,items])=>`
  <section class="status-preview-measurements">
   <h4>${esc(measurementGroupDisplayName(g))}</h4>
   <div class="status-preview-grid">
    ${items.map(n=>`<div class="status-preview-cell"><span>${esc(n)}</span>
     <strong>${esc(measureValue(measurementValue(m.values,g,n)))||'—'}</strong></div>`).join('')}
   </div>
  </section>`).join('');
 const deliver=[m.deliver_top?'Top':null,m.deliver_bottom?'Bottom':null,m.deliver_dupatta?'Dupatta':null].filter(Boolean);
 return `<div class="status-preview-header">
  <div><div class="status-preview-brand">GALOIR</div><h3 id="statusSlipTitle">Measurement Slip ${esc(m.slip_no||'—')}</h3></div>
  <span class="status-pill ${billed?'ready':'draft'}">${billed?'Billed':'Draft — not printable'}</span>
 </div>
 <div class="status-preview-meta">${meta.map(([label,v])=>`<div><span>${esc(label)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
 ${groups}
 <section class="status-preview-notes">
  <div><h4>Remarks</h4><p>${esc(m.remarks||'—')}</p></div>
  <div><h4>Fitting Instructions</h4><p>${esc(m.fitting_notes||'—')}</p></div>
 </section>
 <p class="muted">Items to deliver: ${esc(deliver.length?deliver.join(', '):'Not specified')}</p>
 ${m.photo_path?'<p class="muted">Reference photo attached — use View Photo in the search result.</p>':''}
 ${m.manual_booklet_photo_path?'<p class="muted">Original handwritten booklet page attached — use View Booklet Page in the search result.</p>':''}
 <p class="muted">${billed?'Open View / Print A4 Slip from the search result for the official tailor printout.':'The cashier must finish billing before this slip can be printed.'}</p>`;
}
function manualMeasurementsFields(m=null){
 return Object.entries(measureGroups).map(([group,items])=>
 `<section class="manual-measure-group"><h4>${esc(measurementGroupDisplayName(group))}</h4><div class="fields">
 ${items.map(name=>`<div><label>${esc(name)}</label><input name="m_${esc(group+' / '+name)}" type="text" maxlength="120" value="${esc(measurementValue(m?.values,group,name))}"></div>`).join('')}
 </div></section>`).join('');
}
function manualOrderStatus(o){
 if(!o)return 'Booking missing';
 if(o.status==='delivered')return 'Delivered';
 if(o.is_ready)return 'Ready for Collection';
 if(o.master_room_sent_at)return 'Sent to Master Room';
 if(o.status==='stitching')return 'Stitching';
 if(o.status==='trial')return 'Trial';
 if(o.status==='alteration')return 'Alteration';
 if(o.delivery_date<today)return 'Overdue';
 return 'Pending';
}
function manualImportRows(){
 const q=manualImportSearch.trim().toLowerCase();
 return measurements.filter(m=>m.imported_from_manual).filter(m=>{
  const c=customers.find(x=>x.id===m.customer_id);
  return !q||`${m.manual_booklet_name} ${m.manual_slip_no} ${m.slip_no} ${m.bill_no} ${c?.full_name||''} ${c?.phone||''}`.toLowerCase().includes(q);
 }).sort((a,b)=>String(a.delivery_date||'').localeCompare(String(b.delivery_date||''))).slice(0,250).map(m=>{
  const c=customers.find(x=>x.id===m.customer_id),o=orders.find(x=>x.measurement_id===m.id);
  return `<article class="manual-import-row">
    <div class="manual-import-row-details"><strong>${esc(m.slip_no)} ← ${esc(m.manual_booklet_name)} / ${esc(m.manual_slip_no)}</strong>
     <span>${esc(c?.full_name||'Customer')} · ${esc(phoneForDisplay(c?.phone))} · Bill ${esc(m.bill_no)}</span>
     <span>Delivery ${esc(outputDate(m.delivery_date))} · <b>${esc(manualOrderStatus(o))}</b></span>
     <span class="manual-badge ${m.needs_measurement_entry?'warning':'done'}">${m.needs_measurement_entry?'Measurements pending':'Measurements entered'}</span>
     <span class="manual-badge ${m.manual_booklet_photo_path?'done':'warning'}">${m.manual_booklet_photo_path?'Booklet photo attached':'Booklet photo missing'}</span>
    </div><div class="manual-import-row-actions">
     <button type="button" class="btn alt" data-manual-edit="${esc(m.id)}">Edit / Attach Photo</button>
     ${m.manual_booklet_photo_path?`<button type="button" class="btn alt" data-manual-photo="${esc(m.id)}">View Booklet</button>`:''}
     <button type="button" class="btn" data-manual-print="${esc(m.id)}">Print GL Slip</button>
    </div></article>`;
 }).join('')||'<p class="muted">No imported booklet orders match.</p>';
}
function manualImportView(){
 if(!(role==='admin'||role==='manager'))return '<div class="panel">Admin or Manager access required.</div>';
 const all=measurements.filter(m=>m.imported_from_manual);
 const ed=all.find(m=>m.id===manualEditingId);
 const open=all.filter(m=>orders.some(o=>o.measurement_id===m.id&&o.status!=='delivered'));
 const stats=[['Total imported',all.length],['Still open',open.length],['Measurements pending',all.filter(m=>m.needs_measurement_entry).length],['Booklet photos needed',all.filter(m=>!m.manual_booklet_photo_path).length],['Due or overdue',open.filter(m=>m.delivery_date<=today).length]];
 const editor=ed?`<section class="panel manual-import-editor" id="manualEditor"><div class="manual-heading"><h3>Complete Imported Slip ${esc(ed.slip_no)}</h3><button class="btn alt" type="button" id="manualCancelEdit">Close</button></div>
  <p class="muted">Original: ${esc(ed.manual_booklet_name)} / ${esc(ed.manual_slip_no)} · Bill ${esc(ed.bill_no)}. Previously billed: no new invoice.</p>
  <form id="manualEditForm">
   <div><label>Upload / replace booklet page photo</label><input type="file" name="manual_booklet_file" accept="image/*" capture="environment"><p class="muted">Private photo, up to 15 MB. Cover any written customer phone number before photographing; the page may appear on the tailor slip.</p></div>
   <details ${ed.needs_measurement_entry?'open':''}><summary>Digital measurements</summary>${manualMeasurementsFields(ed)}</details>
   <div class="fields"><div class="span"><label>Remarks</label><textarea name="remarks" maxlength="6000" rows="3">${esc(ed.remarks||'')}</textarea></div>
   <div class="span"><label>Fitting instructions</label><textarea name="fitting_notes" maxlength="6000" rows="3">${esc(ed.fitting_notes||'')}</textarea></div>
   <div class="span"><label class="manual-check"><input type="checkbox" name="needs_measurement_entry" ${ed.needs_measurement_entry?'checked':''}> Still needs full digital measurements</label></div></div>
   <button type="submit" class="btn" id="manualEditSave">Save Measurements / Photo</button>
  </form></section>`:'';
 return `<div class="manual-overview">${stats.map(([label,value])=>`<div class="card"><b>${value}</b><small>${esc(label)}</small></div>`).join('')}</div>
  ${manualLastImportedGL?`<div class="manual-import-success" role="status">Imported ${esc(manualLastImportedGL)} — original POS bill linked without billing again.</div>`:''}
  ${editor}
  <section class="panel"><h3>📖 Import Existing Manual Booklet Order</h3>
   <p class="muted"><b>Not a new sale.</b> Enter the old booklet and POS bill numbers. Past delivery dates and existing commitments are accepted, and imported orders appear in Daily Deliveries and Master Room lists.</p>
   <form id="manualImportForm" autocomplete="off"><div class="fields">
    <div><label>Booklet / Register Name *</label><input required maxlength="100" name="manual_booklet_name" placeholder="Book 3 — Oct 2026"></div>
    <div><label>Original Manual Slip No. *</label><input required maxlength="80" name="manual_slip_no" placeholder="4852"></div>
    <div><label>Existing POS Bill Number *</label><input required maxlength="100" name="bill_no"></div>
    <div><label>Customer Phone Number *</label><input required maxlength="30" type="tel" id="manualImportPhone" name="customer_phone"><p class="muted" id="manualImportPhoneStatus">Existing customers matched automatically.</p></div>
    <div><label>Customer Name (if new)</label><input maxlength="120" id="manualImportCustomerName" name="customer_name"></div>
    <div><label>Original Salesperson</label><input list="manualSalespeople" maxlength="120" name="salesperson_name"><datalist id="manualSalespeople">${salespeople.map(x=>`<option value="${esc(x.full_name)}"></option>`).join('')}</datalist></div>
    <div><label>Original Order Date *</label><input required name="order_date" type="date" max="${esc(today)}" placeholder="Choose original date"></div>
    <div><label>Original Promised Delivery Date *</label><input required name="delivery_date" type="date"><p class="muted">Past dates are allowed and show as overdue.</p></div>
    <div><label>Order Type</label><select name="order_type"><option value="self_alter">Self Alter</option><option value="new_make">New Make</option></select></div>
    <div><label>Days Needed to Prepare</label><input required name="days_required" type="number" min="0" max="60" value="3"></div>
    <div><label>Current Status</label><select name="current_status">
      <option value="pending">Pending</option><option value="sent_master">Sent to Master Room</option>
      <option value="stitching">Stitching</option><option value="alteration">Alteration</option>
      <option value="trial">Trial</option><option value="ready">Ready for Collection</option>
      <option value="delivered">Already Delivered</option></select></div>
    <div><label>Original Total (₹, optional)</label><input name="final_billing_amount" type="number" min="0.01" step="0.01" max="9999999999.99"></div>
    <div><label>Already Paid (₹, optional)</label><input name="paid_amount" type="number" min="0" step="0.01"></div>
    <div><label>Photograph Handwritten Page</label><input name="manual_booklet_file" type="file" accept="image/*" capture="environment"><p class="muted">Recommended · maximum 15 MB · can attach later. Cover any written customer phone number before photographing; the page may appear on the tailor slip.</p></div>
    <div class="span"><label>Original Remarks</label><textarea name="remarks" maxlength="6000" rows="3"></textarea></div>
    <div class="span"><label>Fitting Instructions</label><textarea name="fitting_notes" maxlength="6000" rows="2"></textarea></div>
    <div class="span"><label class="manual-check"><input type="checkbox" name="needs_measurement_entry" checked> Digital measurements to enter later</label></div>
    <div class="span"><label class="manual-check"><input type="checkbox" name="whatsapp_opt_in"> Customer consented to future Ready-for-Collection WhatsApp updates</label>
     <p class="muted">Historical order-confirmation WhatsApp is not sent on import.</p></div>
   </div>
   <details><summary>Optional: Enter digital measurements now</summary>${manualMeasurementsFields()}</details>
   <button id="manualImportSave" class="btn" type="submit">Import Old Order & Assign GL Barcode</button>
   </form></section>
  <section class="panel"><div class="manual-heading"><h3>Imported Booklet Orders</h3><label>Filter <input type="search" id="manualImportSearch" value="${esc(manualImportSearch)}" placeholder="Phone, bill, old slip, GL slip"></label></div>
   <p class="muted">${all.length} imported. Add photos and measurements at any time. Status updates remain in Dashboard / Daily Deliveries.</p>
   <div id="manualImportRows">${manualImportRows()}</div></section>`;
}
async function uploadManualBookletPhoto(id,file){
 if(!(file instanceof File)||!file.size)return null;
 const mime=String(file.type||'').split(';')[0].toLowerCase();
 const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'};
 const ext=types[mime];
 if(!ext)throw Error('Use JPG, PNG, WebP or HEIC for a booklet photo');
 if(file.size>15728640)throw Error('Booklet photo must be 15 MB or smaller');
 const path=id+'/manual-'+crypto.randomUUID()+'.'+ext;
 const {error:err}=await sb.storage.from('galoir-measurement-media').upload(path,file,{contentType:mime,upsert:false});
 if(err)throw err;
 const {error:linkError}=await sb.rpc('update_imported_booklet_photo',{p_measurement_id:id,p_path:path});
 if(linkError)throw linkError;
 return path;
}
async function openManualBookletPhoto(m){
 if(!m?.manual_booklet_photo_path)return notify('No booklet photo attached');
 const win=window.open('about:blank','_blank');
 try{
  const {data,error:e}=await sb.storage.from('galoir-measurement-media').createSignedUrl(m.manual_booklet_photo_path,900);
  if(e||!data?.signedUrl)throw e||Error('Cannot load photo');
  if(win)win.location.href=data.signedUrl;else notify('Enable pop-ups to view the booklet photo');
 }catch(e){win?.close();error(e)}
}
function collectManualFields(form,includeBlanks=false){
 const fd=new FormData(form),values={};
 for(const [group,names] of Object.entries(measureGroups))
  for(const name of names){
   const key=group+' / '+name;
   const value=String(fd.get('m_'+key)??'').trim();
   if(value||includeBlanks)values[key]=value;
  }
 return values;
}
async function submitManualImport(e){
 e.preventDefault();
 if(!canImportManual())return notify('Admin or Manager access required');
 const form=e.target,f=new FormData(form);
 const photo=f.get('manual_booklet_file');
 const booklet=String(f.get('manual_booklet_name')||'').trim();
 const originalSlip=String(f.get('manual_slip_no')||'').trim();
 const bill=String(f.get('bill_no')||'').trim();
 const phone=String(f.get('customer_phone')||'').trim();
 const originalDate=String(f.get('order_date')||'');
 const deliveryDate=String(f.get('delivery_date')||'');
 const orderType=String(f.get('order_type')||'self_alter');
 const status=String(f.get('current_status')||'pending');
 if(!booklet||!originalSlip||!bill)throw Error('Enter booklet name, old slip and existing POS bill');
 if(phoneDigits(phone).length<7)throw Error('Enter a complete customer phone number');
 if(originalDate>today)throw Error('Original order date cannot be in the future');
 if(!deliveryDate||deliveryDate<originalDate)throw Error('Enter the original promised delivery date');
 if(status==='sent_master'&&orderType!=='self_alter')throw Error('Master Room status is for Self Alter only');
 const values=collectManualFields(form);
 if(!f.has('needs_measurement_entry')&&!Object.values(values).some(Boolean))
  throw Error('Enter digital measurements or tick Enter later');
 const total=String(f.get('final_billing_amount')||'').trim();
 const paid=String(f.get('paid_amount')||'').trim();
 if(paid&&!total)throw Error('Enter original total before entering paid amount');
 if(total&&(!/^\d+(?:\.\d{1,2})?$/.test(total)||Number(total)<=0))throw Error('Invalid original total');
 if(paid&&(!/^\d+(?:\.\d{1,2})?$/.test(paid)||Number(paid)>Number(total)))throw Error('Paid amount cannot exceed total');
 if(photo instanceof File&&photo.size>15728640)throw Error('Booklet photo must be 15 MB or smaller');
 const payload={
  manual_booklet_name:booklet,manual_slip_no:originalSlip,bill_no:bill,
  customer_name:String(f.get('customer_name')||'').trim(),
  customer_phone:phone,salesperson_name:f.get('salesperson_name')||'',
  order_date:originalDate,delivery_date:deliveryDate,order_type:orderType,
  current_status:status,days_required:Number(f.get('days_required')||3),
  final_billing_amount:total||null,paid_amount:paid||null,
  whatsapp_opt_in:f.has('whatsapp_opt_in'),needs_measurement_entry:f.has('needs_measurement_entry'),
  remarks:f.get('remarks')||'',fitting_notes:f.get('fitting_notes')||'',values
 };
 const submit=form.querySelector('button[type="submit"]');
 if(submit)submit.disabled=true;
 try{
  const {data,error:e}=await sb.rpc('import_manual_booklet_order',{p_payload:payload});
  if(e)throw e;
  let warning='';
  if(photo instanceof File&&photo.size){
   try{await uploadManualBookletPhoto(data.measurement_id,photo)}
   catch(err){warning=' Booklet photo upload failed: '+(err.message||err)+'. Reopen this imported order to retry.'}
  }
  manualLastImportedGL=data.slip_no;
  manualEditingId=null;
  await refresh();
  notify('Manual slip '+originalSlip+' imported as '+data.slip_no+'. Existing bill retained; no new billing.'+warning);
 }finally{if(submit?.isConnected)submit.disabled=false}
}
async function submitManualEdit(e){
 e.preventDefault();
 if(!canImportManual())return notify('Admin or Manager access required');
 const form=e.target,id=manualEditingId;
 const m=measurements.find(x=>x.id===id&&x.imported_from_manual);
 if(!m)throw Error('Imported slip not found');
 const values=collectManualFields(form,true);
 const f=new FormData(form);
 if(!f.has('needs_measurement_entry')&&!Object.values(values).some(Boolean))
  throw Error('Enter measurements before marking transcription complete');
 const photo=f.get('manual_booklet_file');
 if(photo instanceof File&&photo.size>15728640)throw Error('Photo cannot exceed 15 MB');
 const button=form.querySelector('button[type="submit"]');
 if(button)button.disabled=true;
 try{
  const {error:e}=await sb.rpc('update_imported_measurements',{
   p_measurement_id:id,p_values:values,p_remarks:f.get('remarks')||'',
   p_fitting_notes:f.get('fitting_notes')||'',
   p_needs_measurement_entry:f.has('needs_measurement_entry')
  });
  if(e)throw e;
  let warning='';
  if(photo instanceof File&&photo.size){
   try{await uploadManualBookletPhoto(id,photo)}
   catch(err){warning=' Booklet photo failed: '+(err.message||err)}
  }
  manualEditingId=null;
  await refresh();
  notify('Imported '+m.slip_no+' updated.'+warning);
 }finally{if(button?.isConnected)button.disabled=false}
}
function dashboardView(){
 const due=deliveriesToday(),master=masterRoomToday();
 const delivered=due.filter(o=>o.status==='delivered').length;
 const sent=master.filter(o=>o.master_room_sent_at).length;
 const overdueDelivery=orders.filter(o=>o.delivery_date<today&&o.status!=='delivered').length;
 return `${can('measurements')?`<div class="dashboard-top-actions"><button class="btn dashboard-new-measurement" type="button" id="dashboardNewMeasurement" aria-label="Create new measurement slip"><span class="dashboard-plus-icon" aria-hidden="true">+</span> New Measurement</button></div>`:''}
 ${canImportManual()?`<div class="dashboard-manual-action"><button type="button" class="btn alt" id="dashboardImportManual">📖 + Import Manual Order</button></div>`:''}
 <section class="panel status-lookup-panel">
  <h3>Search Customer / Slip / Bill Status</h3>
  <p class="muted">Enter a customer phone, GL slip, old manual slip number, or exact bill number to see its status and expected delivery.</p>
  <form id="statusSearchForm" role="search" class="status-search-form" autocomplete="off">
   <input type="search" id="statusSearchInput" maxlength="100" value="${esc(statusSearchQuery)}" placeholder="Phone, GL, Old Slip or Bill" aria-label="Search by phone, GL slip, manual slip or bill number">
   <button class="btn" type="submit">Search Status</button>
   <button class="btn alt" type="button" id="statusSearchClear">Clear</button>
  </form>
  <div id="statusSearchResults" aria-live="polite">${statusLookupResults(statusSearchQuery)}</div>
 </section>
 <dialog id="statusSlipDialog" class="status-slip-dialog" aria-labelledby="statusSlipTitle">
  <div class="status-slip-dialog-controls"><span>GALOIR Measurement Preview</span><button id="closeStatusSlipPreview" type="button" class="btn alt">Close ✕</button></div>
  <div id="statusSlipPreview"></div>
 </dialog>
 <div class="dashboard-summary">
  <div class="card"><div class="muted">Due today + overdue</div><div class="stat">${due.length-delivered}<small> remaining / ${due.length} total</small></div></div>
  <div class="card"><div class="muted">Send to master room</div><div class="stat">${master.length-sent}<small> pending / ${master.length} today</small></div></div>
  <div class="card"><div class="muted">Overdue deliveries</div><div class="stat">${overdueDelivery}</div></div>
  <div class="card"><div class="muted">Outfits ready</div><div class="stat">${orders.filter(o=>o.is_ready&&o.status!=='delivered').length}</div></div>
 </div>
 <div class="dashboard-two-columns">
  <section class="panel dashboard-worklist"><div class="dashboard-list-heading"><h3>🚚 Deliver Today / Overdue</h3><span>${delivered} of ${due.length} delivered</span></div>
   <p class="muted">Tick <b>Delivered</b> after handing over the outfit. An outfit must be marked Ready first.</p>
   ${due.length?due.map(o=>worklistRow(o,'deliver')).join(''):'<p class="dashboard-empty">No deliveries scheduled today.</p>'}
  </section>
  <section class="panel dashboard-worklist"><div class="dashboard-list-heading"><h3>✂ Send to Master Room Today</h3><span>${sent} sent</span></div>
   <p class="muted">Self Alter outfits due for preparation today, including anything overdue. Tick once given to the master.</p>
   ${master.length?master.map(o=>worklistRow(o,'master')).join(''):'<p class="dashboard-empty">Nothing is waiting to be sent to the master room.</p>'}
  </section>
 </div>
 <div class="panel scan-dashboard-cta"><div><h3>Outfit Ready Scanner</h3><p class="muted">Scan the GL barcode printed on the tailor slip to mark the matching outfit ready.</p></div><button type="button" class="btn" id="openReadyScanner">Scan Ready Outfit</button></div>
 <div class="panel"><h3>Other action reminders</h3><p>${alterationAlerts().length} alterations need preparation · ${supplierAlerts().length} New Make supplier follow-ups</p><button class="btn alt" id="openAlerts">Open reminders</button></div>`;
}
function readyScannerView(){
 const last=lastReadyScanResult;
 return `<div class="panel ready-scanner-panel">
  <h3>Scan Ready Outfit</h3>
  <p class="muted">Use a phone/tablet camera or a handheld USB/Bluetooth barcode scanner. Scan the <b>GL barcode on the tailor slip</b>, not the product barcode.</p>
  <form id="readyScannerForm" autocomplete="off">
   <label for="readySlipInput">Tailor Slip Barcode / GL Slip Number</label>
   <div class="ready-scanner-row">
    <input id="readySlipInput" type="text" name="slip_no" maxlength="20" required autocapitalize="characters" spellcheck="false" inputmode="text">
    <button type="submit" class="btn" id="markScannedReady">Mark Ready</button>
   </div>
  </form>
  <div class="actions" style="margin-top:12px">
   <button type="button" class="btn alt" id="startReadyCamera">Scan with Camera</button>
   <button type="button" class="btn alt hidden" id="stopReadyCamera">Stop Camera</button>
  </div>
  <video id="readyScanVideo" class="hidden" autoplay muted playsinline style="max-height:300px;width:100%;object-fit:cover;border-radius:10px;margin-top:12px"></video>
  <p id="readyScanStatus" class="muted" aria-live="polite">The matching billed outfit will be marked ready automatically after a successful scan.</p>
  ${last?`<div class="scan-success"><strong>${esc(last.slip_no)} — ${last.already_ready?'Already ready':'Marked READY ✓'}</strong><p>${esc(last.customer_name||'Customer')} · ${esc(last.item_name||'Outfit')}</p></div>`:''}
 </div>
 <div class="panel"><h3>Ready for Collection</h3>
  ${ordersTable(orders.filter(o=>o.is_ready&&o.status!=='delivered').slice().sort((a,b)=>a.delivery_date.localeCompare(b.delivery_date)).slice(0,100))}
 </div>`;
}
function slipCode39Svg(raw){
 const code=String(raw||'').toUpperCase();
 if(!/^GL[0-9]{1,16}$/.test(code))return '';
 const patterns={
 '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw',
 '5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
 'G':'nnnnnwwnw','L':'nnwnnnnww','*':'nwnnwnwnn'
 };
 const narrow=2,wide=5,quiet=24,barHeight=60,gap=2;
 let x=quiet;const bars=[];
 for(const letter of '*'+code+'*'){
  const pattern=patterns[letter];if(!pattern)return '';
  for(let i=0;i<pattern.length;i++){
   const width=pattern[i]==='w'?wide:narrow;
   if(i%2===0)bars.push(`<rect x="${x}" y="0" width="${width}" height="${barHeight}"/>`);
   x+=width;
  }
  x+=gap;
 }
 const width=x+quiet;
 return `<svg class="tailor-slip-barcode" role="img" aria-label="Unique GL barcode ${esc(code)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 84" width="100%" height="74" preserveAspectRatio="xMidYMid meet">
 <rect width="${width}" height="84" fill="white"/>
 <g fill="#151515">${bars.join('')}</g>
 <text x="${width/2}" y="80" font-family="Arial,sans-serif" font-size="13" text-anchor="middle" font-weight="bold" letter-spacing="2">${esc(code)}</text>
 </svg>`;
}
function ordersTable(rows){return `<table><thead><tr><th>Customer / Slip</th><th>Outfit / Type</th><th>Delivery</th><th>Status</th><th>CRM Ready</th><th>Supplier Follow-up</th></tr></thead><tbody>${rows.length?rows.map(o=>{const slip=measurements.find(m=>m.id===o.measurement_id)?.slip_no||'—';return `<tr><td>${esc(customerName(o.customer_id))}<br><strong>${esc(slip)}</strong></td><td>${esc(o.item_name)}<br><span class="muted">${o.order_type==='new_make'?'New Make':'Self Alter'}</span></td><td>${esc(outputDate(o.delivery_date))}</td><td><span class="pill">${esc(o.status)}</span></td><td><label><input type="checkbox" data-ready-id="${esc(o.id)}" ${o.is_ready?'checked':''} style="width:auto"> Ready</label></td><td>${o.order_type==='new_make'?`<button type="button" class="btn alt" data-supplier-id="${esc(o.id)}">${o.supplier_notified_at?'✓ Supplier informed':'Mark supplier informed'}</button>`:'—'}</td></tr>`}).join(''):'<tr><td colspan="6">No records</td></tr>'}</tbody></table>`}
function alertsView(){return `<div class="panel"><h3>New Make · Contact supplier 2 days before delivery</h3><p class="muted">These reminders appear from 2 days before delivery until marked Supplier Informed or Ready.</p>${ordersTable(supplierAlerts())}</div><div class="panel"><h3>Self Alter · Put on alteration / prepare</h3><p class="muted">Reminders begin the selected number of preparation days before delivery.</p>${ordersTable(alterationAlerts())}</div>`}
function customerOptions(){return customers.map(c=>`<option value="${c.id}">${esc(c.full_name)} — ${esc(phoneForDisplay(c.phone))}</option>`).join('')}
function customersView(){return `${can("customers") ? `<div class="panel"><h3>Add customer</h3><form id="customerForm"><div class="fields"><div><label>Full name</label><input name="full_name" required maxlength="120"></div><div><label>Phone</label><input name="phone" required maxlength="30"></div><div class="span"><label>Notes</label><textarea name="notes" rows="2"></textarea></div></div><button class="btn">Save Customer</button></form></div>` : ""}<div class="panel"><h3>Customer profiles</h3><input id="searchCustomers"><div id="customerRows">${customerTable(customers)}</div></div>`}
function customerTable(rows){return `<table><tr><th>Name</th><th>Phone</th><th>Measurements</th></tr>${rows.map(c=>`<tr><td>${esc(c.full_name)}</td><td>${esc(phoneForDisplay(c.phone))}</td><td>${measurements.filter(m=>m.customer_id===c.id).length}</td></tr>`).join('')}</table>`}
// Reuse the original Lehenga / Sharara storage keys to keep old slips compatible.
const measureGroups={"Top / Ready / Body":["Length","Upper Chest","Chest","Waist/Tummy","Hip","Shoulder","Armhole","Sleeves","Front Neck","Back Neck","Ghera","Back Darts","Dart Point","Chak/Slit"],"Lehenga / Sharara":["Length","Waist","Hip/Knee","Flair","Thigh"]};
function measurementGroupDisplayName(group){return group==='Lehenga / Sharara'?'Lehenga / Sharara / Saree / Pant':group}
function measurementValue(values,group,name){
 const key=group+' / '+name;
 if(values&&Object.prototype.hasOwnProperty.call(values,key))return values[key];
 // Existing Pant / Plazo measurements continue to appear for old slips.
 if(group==='Lehenga / Sharara'&&['Length','Waist','Thigh'].includes(name))
  return values?.['Salwar / Pant / Plazo / '+name]??'';
 return '';
}
function measurementInputs(group,items){const current=measurements.find(m=>m.id===editingDraftId);return `<div class="panel span"><h3>${esc(measurementGroupDisplayName(group))} — numbers or tailor instructions</h3><div class="fields">${items.map(x=>`<div><label>${esc(x)}</label><input type="text" maxlength="120" name="m_${esc(group+' / '+x)}" value="${initialField(current,group,x)}"></div>`).join('')}</div></div>`}
function makeOptions(){return `<option value="new_make">New Make — no daily limit</option><option value="self_alter">Self Alter — daily limit applies</option>`}
function overrideFields(prefix){return `<div class="panel hidden override-box" id="${prefix}Override"><h3>Self Alter date full — supervisor password required</h3><p class="muted">An Admin or Manager must enter their own login email and password to approve this one extra booking. This approval expires after 3 minutes and cannot be reused.</p><div class="fields"><div><label>Supervisor email</label><input type="email" name="reviewer_email" autocomplete="off"></div><div><label>Supervisor password</label><input type="password" name="reviewer_password" autocomplete="off"></div></div></div>`}
function phoneDigits(v){let d=String(v||'').replace(/\D/g,'');return d.length===12&&d.startsWith('91')?d.slice(2):d}
function phoneMatches(v){const q=phoneDigits(v);return q.length>=7?customers.filter(c=>phoneDigits(c.phone)===q):[]}
function lastMeasurement(customerId){return measurements.filter(m=>m.customer_id===customerId).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]||null}
function initialField(draft,group,name){return esc(measurementValue(draft?.values,group,name))}
function customerNamePhone(draft){return customers.find(c=>c.id===draft?.customer_id)||null}
function preparationLeadTimeMessage(date,days){
 const lead=Number(days);
 if(!Number.isInteger(lead)||lead<0||lead>60)return 'Preparation days must be a whole number between 0 and 60.';
 if(!date)return '';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))return 'Select a valid delivery date.';
 const remaining=daysUntil(date);
 if(!Number.isFinite(remaining))return 'Select a valid delivery date.';
 if(remaining<0)return 'Delivery date cannot be in the past.';
 if(remaining>=lead)return '';
 const earliest=new Date(Date.parse(today+'T00:00:00Z')+lead*86400000).toISOString().slice(0,10);
 return `Preparation requires ${lead} day${lead===1?'':'s'}, but delivery is only ${remaining} day${remaining===1?'':'s'} away. Select ${outputDate(earliest)} or later, or reduce preparation days.`;
}
function bindPreparationWarnings(){
 const monitor=(form,dateInput,daysInput,warn,submit,baseDisabled=()=>false)=>{
  if(!form||!dateInput||!warn)return;
  const check=()=>{
   const days=daysInput?.value!==undefined&&daysInput.value!==''?daysInput.value:form.dataset.preparationDays??3;
   const message=preparationLeadTimeMessage(dateInput.value,days);
   warn.textContent=message;
   warn.classList.toggle('hidden',!message);
   const picker=dateInput.closest?.('.colored-date-picker');
   const trigger=picker?.querySelector('[data-color-toggle]');
   trigger?.classList.toggle('prep-invalid',!!message);
   if(submit)submit.disabled=!!message||!!baseDisabled();
  };
  dateInput.addEventListener('change',check);
  daysInput?.addEventListener('input',check);
  daysInput?.addEventListener('change',check);
  check();
 };
 const slip=$('measurementForm');
 if(slip)monitor(slip,$('slipDate'),slip.elements.namedItem('days_required'),$('slipLeadWarning'),$('saveSlipBtn'));
 const booking=$('bookingForm');
 if(booking)monitor(booking,$('bookingDate'),booking.elements.namedItem('days_required'),$('bookingLeadWarning'),
    booking.querySelector('button[type="submit"]'),()=>!customers.length||$('bookingDate')?.value<today);
 document.querySelectorAll('.cashierForm').forEach(form=>{
  const m=measurements.find(x=>x.id===form.dataset.slipId);
  if(!m)return;
  form.dataset.preparationDays=String(m.days_required??3);
  monitor(form,form.querySelector('.cashierDate'),null,form.querySelector('.cashierLeadWarning'),
    form.querySelector('button[type="submit"]'));
 });
}
function coloredDateInput(id,value,allowPast=false){
 const raw=/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?value:'';
 const className=id.startsWith('cashierDate-')?'cashierDate':'';
 return `<div class="colored-date-picker" data-allow-past="${allowPast?'true':'false'}">
 <input type="hidden" name="delivery_date" id="${esc(id)}" class="${className}" value="${esc(raw)}">
 <button type="button" class="color-calendar-trigger" data-color-toggle aria-expanded="false" aria-label="Choose delivery date">${raw?esc(outputDate(raw)):'Choose delivery date'} <span aria-hidden="true">▾</span></button>
 <div class="color-calendar-panel hidden" data-color-panel></div>
 </div>`;
}
function coloredCalendarMonth(year,month,selected,allowPast=false){
 const title=new Date(year,month,1).toLocaleString('en-IN',{month:'long',year:'numeric'});
 const daysInMonth=new Date(year,month+1,0).getDate(),start=new Date(year,month,1).getDay();
 const cells=Array.from({length:start},()=>'<span class="color-calendar-empty" aria-hidden="true"></span>');
 for(let d=1;d<=daysInMonth;d++){
  const date=dateStr(new Date(year,month,d)),weekday=new Date(year,month,d).getDay();
  const weekend=weekday===0||weekday===6,past=date<today,used=countDate(date);
  const type=weekend?'weekend':past?'past':used>=capacity?'full':'available';
  const slots=Math.max(0,capacity-used);
  const aria=`${outputDate(date)}, ${weekend?'weekend, ':''}${slots} Self Alter slots remaining`;
  cells.push(`<button type="button" data-color-day="${date}" class="color-calendar-day ${type} ${selected===date?'selected':''}" ${past&&!allowPast?'disabled':''} aria-label="${esc(aria)}" title="${esc(aria)}"><b>${d}</b><small>${slots} left</small></button>`);
 }
 return `<div class="color-calendar-heading"><button type="button" data-color-nav="-1" aria-label="Previous month">‹</button><strong>${esc(title)}</strong><button type="button" data-color-nav="1" aria-label="Next month">›</button></div>
 <div class="color-calendar-days">${['S','M','T','W','T','F','S'].map((x,i)=>`<span class="${i===0||i===6?'weekend-label':''}">${x}</span>`).join('')}${cells.join('')}</div>
 <div class="color-calendar-key"><span class="key green">Available</span><span class="key red">Sat / Sun</span><span class="key amber">Alter full</span><span class="key gray">Past</span></div>
 <p class="muted">Colors show Self Alter slots. New Make is unlimited; weekends remain bookable.</p>`;
}
function bindColoredCalendars(){
 document.querySelectorAll('.colored-date-picker').forEach(picker=>{
  const input=picker.querySelector('input[name="delivery_date"]'),trigger=picker.querySelector('[data-color-toggle]'),panel=picker.querySelector('[data-color-panel]'),allowPast=picker.dataset.allowPast==='true';
  if(!input||!trigger||!panel)return;
  let pointer=input.value&&/^\d{4}-\d{2}-\d{2}$/.test(input.value)?new Date(input.value+'T12:00:00'):new Date(today+'T12:00:00');
  const display=()=>{trigger.innerHTML=(input.value?esc(outputDate(input.value)):'Choose delivery date')+' <span aria-hidden="true">▾</span>'};
  const draw=()=>{
   panel.innerHTML=coloredCalendarMonth(pointer.getFullYear(),pointer.getMonth(),input.value,allowPast);
   panel.querySelectorAll('[data-color-nav]').forEach(b=>b.onclick=()=>{
    pointer=new Date(pointer.getFullYear(),pointer.getMonth()+Number(b.dataset.colorNav),1);
    draw();
   });
   panel.querySelectorAll('[data-color-day]').forEach(b=>b.onclick=()=>{
    const date=b.dataset.colorDay;
    if(!allowPast&&date<today)return;
    input.value=date;display();
    input.dispatchEvent(new Event('change',{bubbles:true}));
    panel.classList.add('hidden');trigger.setAttribute('aria-expanded','false');
   });
  };
  trigger.onclick=()=>{
   if(panel.classList.contains('hidden')){
    if(input.value&&/^\d{4}-\d{2}-\d{2}$/.test(input.value))pointer=new Date(input.value+'T12:00:00');
    draw();panel.classList.remove('hidden');trigger.setAttribute('aria-expanded','true');
   }else{panel.classList.add('hidden');trigger.setAttribute('aria-expanded','false')}
  };
 });
}
let measurementRecoveryTimer=null,measurementSaving=false,measurementDirty=false;
function measurementRecoveryKey(){return me?.id?'galoir:measurement-recovery:v1:'+me.id:'';}
function readMeasurementRecovery(){
 const key=measurementRecoveryKey();if(!key)return null;
 try{
  const record=JSON.parse(sessionStorage.getItem(key)||'null');
  if(!record||record.version!==1||record.userId!==me.id||!record.fields||typeof record.fields!=='object')return null;
  if(!Number.isFinite(record.timestamp)||Date.now()-record.timestamp>8*60*60*1000||record.timestamp>Date.now()+60000){
   sessionStorage.removeItem(key);return null;
  }
  return record;
 }catch{return null}
}
function clearMeasurementRecovery(){
 clearTimeout(measurementRecoveryTimer);measurementRecoveryTimer=null;measurementDirty=false;
 const key=measurementRecoveryKey();if(key)try{sessionStorage.removeItem(key)}catch{}
}
function measurementSaveFeedback(message,kind='info'){
 const label=$('slipSaveFeedback');
 if(label){label.textContent=message;label.className='slip-save-feedback '+(kind==='error'?'slip-save-error':kind==='success'?'slip-save-success':'slip-save-info');}
}
function captureMeasurementRecovery(){
 if(measurementSaving||!me?.id||tab!=='measurements')return false;
 const form=$('measurementForm');if(!form)return false;
 const fields={};let hasAttachments=false;
 for(const input of Array.from(form.elements||[])){
  if(!input.name||input.disabled||input.type==='submit'||input.type==='button')continue;
  if(input.type==='file'){if(input.files?.length)hasAttachments=true;continue}
  if(input.type==='checkbox')fields[input.name]=!!input.checked;
  else if(input.type==='radio'){if(input.checked)fields[input.name]=input.value}
  else fields[input.name]=String(input.value??'');
 }
 const record={version:1,userId:me.id,timestamp:Date.now(),draftId:editingDraftId||null,fields,hasAttachments};
 const key=measurementRecoveryKey();
 try{
  sessionStorage.setItem(key,JSON.stringify(record));measurementDirty=true;
  measurementSaveFeedback('Unsaved entries protected in this tab. Tap Save Draft to store them in GALOIR.'+(hasAttachments?' Reattach photos/videos if you reload this page.':''),'info');
  return true;
 }catch{
  measurementSaveFeedback('Temporary backup unavailable. Save Draft before leaving the app.','error');return false;
 }
}
function scheduleMeasurementRecovery(){
 if(measurementSaving)return;
 measurementDirty=true;measurementSaveFeedback('Unsaved entries. Tap Save Draft — temporary recovery is enabled.','info');
 clearTimeout(measurementRecoveryTimer);measurementRecoveryTimer=setTimeout(()=>{measurementRecoveryTimer=null;captureMeasurementRecovery()},220);
}
function restoreMeasurementRecovery(){
 const record=readMeasurementRecovery(),form=$('measurementForm');
 if(!record||!form||record.draftId!==(editingDraftId||null))return false;
 const fields=record.fields;
 const setField=(input)=>{
  if(!input?.name||input.type==='file'||!Object.prototype.hasOwnProperty.call(fields,input.name))return;
  const val=fields[input.name];
  if(input.type==='checkbox')input.checked=!!val;
  else if(input.type==='radio')input.checked=input.value===val;
  else input.value=String(val??'');
 };
 for(const el of Array.from(form.elements||[]))if(el.name==='customer_phone'||el.name==='force_new_customer')setField(el);
 updatePhoneLookup();
 for(const el of Array.from(form.elements||[]))setField(el);
 updateOverrideVisibility('slip');
 measurementDirty=true;
 measurementSaveFeedback('Recovered unsaved entries. Tap Save Draft to save to GALOIR.'+(record.hasAttachments?' Reattach any photo/video before saving.':''),'info');
 return true;
}
function prepareMeasurementRecoveryOnLogin(){
 if(!can('measurements'))return;const saved=readMeasurementRecovery();if(!saved)return;
 tab='measurements';editingDraftId=saved.draftId||null;
}
function measurementSaveFailure(message){
 const msg=String(message||'Unable to save');
 measurementSaveFeedback('NOT SAVED: '+msg+'. Your entries remain on this screen. Retry Save Draft.','error');
 notify('Not saved: '+msg);
}
function measurementsView(){
 const d=measurements.find(m=>m.id===editingDraftId&&m.workflow_status==='draft')||null;
 const c=customerNamePhone(d);
 const field=(key)=>esc(d?.[key]??'');
 const selected=(key,val)=>d?.[key]===val?'selected':'';
 const checked=(key)=>d?.[key]?'checked':'';
 const ready=salespeople.some(s=>s.active);
 return `${can('measurements')?`<div class="panel">
 <h3>${d?'Continue Measurement Slip':'New GALOIR Measurement Slip'}</h3>
 <div class="slip-number-banner" id="slipNoBanner" role="status" aria-live="polite">
  <div>
   <span class="slip-number-label">SLIP NUMBER</span>
   <strong class="slip-number-value" id="slipNoDisplay">${d?esc(d.slip_no):'Pending'}</strong>
  </div>
  <p class="slip-number-help">${d?'Unique GL number saved with this customer.':'A unique GL number is assigned automatically when you press Save Draft.'}</p>
 </div>
 <p class="muted">Find by phone to reuse customer details and last measurements, or add a new customer. Save at any point. <strong>Drafts do not reserve a delivery slot</strong> until the cashier enters a bill number and confirms booking.</p>
 <form id="measurementForm"><div class="fields">
  <div><label>Customer phone number *</label><input id="slipPhone" type="${role==='sales'&&c?.phone?'password':'tel'}" inputmode="tel" name="customer_phone" value="${esc(c?.phone||'')}" autocomplete="${role==='sales'&&c?.phone?'off':'tel'}" required maxlength="30">${role==='sales'&&c?.phone?`<p class="muted">Saved number: ${esc(maskCustomerPhone(c.phone))}. Enter a full number only if correcting it.</p>`:''}</div>
  <div><label>Customer found</label><div id="phoneLookupStatus" class="muted">Type phone number to search</div><button id="forceNewCustomer" type="button" class="btn alt">Add new customer</button><input type="hidden" name="force_new_customer" id="forceNewCustomerValue" value="false"></div>
  <div class="span hidden" id="existingCustomerBox"><label>Select customer</label><select name="customer_id" id="slipCustomerSelect"></select></div>
  <div class="span" id="newCustomerBox"><label>New customer name</label><input id="slipNewCustomerName" name="customer_name" maxlength="120" value="${esc(c?.full_name||'')}"></div>
  <div><label>Salesperson</label><select name="salesperson_name"><option value="">Select (optional for draft)</option>${salespeople.filter(s=>s.active).map(s=>`<option value="${esc(s.full_name)}" ${selected('salesperson_name',s.full_name)}>${esc(s.full_name)}</option>`).join('')}</select>${!ready?'<p class="muted">Admin can add salespeople later</p>':''}</div>
  <div><label>New Make / Self Alter</label><select name="order_type" id="slipType"><option value="new_make" ${!d||selected('order_type','new_make')?'selected':''}>New Make — unlimited</option><option value="self_alter" ${selected('order_type','self_alter')}>Self Alter — capacity controlled</option></select></div>
  <input type="hidden" name="item_name" value="${field('item_name')}">
  <div><label>Product barcode (optional for New Make)</label><input id="slipBarcode" type="text" name="product_barcode" maxlength="120" value="${field('product_barcode')}"><div class="actions"><button class="btn alt" type="button" id="startBarcodeScan">Scan with camera</button><button class="btn alt hidden" type="button" id="stopBarcodeScan">Stop</button></div><video id="barcodeVideo" autoplay playsinline muted class="hidden" style="width:100%;max-height:220px;object-fit:cover;border-radius:9px"></video><p id="barcodeScanStatus" class="muted">Supports handheld barcode scanners and camera where available.</p></div>
  <div><label>Design Number (optional)</label><input type="text" name="design_number" value="${field('design_number')}" maxlength="100"></div>
  <div><label>Final Billing Amount (₹) — required for billing</label><input type="number" name="final_billing_amount" min="0.01" max="9999999999.99" step="0.01" inputmode="decimal" value="${field('final_billing_amount')}"><p class="muted">May be blank in a draft. Mandatory before the cashier confirms billing. Not printed on the tailor slip.</p></div>
  <div><label>Company name</label><input name="company_name" value="${field('company_name')}" maxlength="120"></div>
  <div><label>Reviewed by</label><input name="reviewed_by" value="${field('reviewed_by')}" maxlength="120"></div>
  <div><label>Order date</label><input type="date" name="order_date" value="${d?.order_date||today}"></div>
  <div><label>Delivery date (optional for draft)</label>${coloredDateInput('slipDate',d?.delivery_date||'')}</div>
  <div><label>Preparation days</label><input name="days_required" id="slipPrepDays" type="number" min="0" max="60" step="1" value="${d?.days_required??3}"></div>
  <div class="span preparation-lead-warning hidden" id="slipLeadWarning" role="alert" aria-live="assertive"></div>
  <div><label>Measurements based on</label><select name="ready_body"><option value="body" ${!d||selected('ready_body','body')?'selected':''}>Body</option><option value="ready" ${selected('ready_body','ready')}>Ready</option></select></div>
  <div class="span"><label>Items to deliver</label><div class="actions"><label><input type="checkbox" name="deliver_top" style="width:auto" ${checked('deliver_top')}> Top</label><label><input type="checkbox" name="deliver_bottom" style="width:auto" ${checked('deliver_bottom')}> Bottom</label><label><input type="checkbox" name="deliver_dupatta" style="width:auto" ${checked('deliver_dupatta')}> Dupatta</label></div></div>
  ${Object.entries(measureGroups).map(([name,items])=>measurementInputs(name,items)).join('')}
  <div class="span"><label>Remarks / Alteration details</label><textarea name="remarks" rows="4">${field('remarks')}</textarea></div>
  <div class="span"><label>Fitting instructions</label><textarea name="fitting_notes" rows="2">${field('fitting_notes')}</textarea></div>
  <div><label>Take photo / upload image</label><input type="file" name="photo_file" accept="image/*" capture="environment"><p class="muted">Optional private image, up to 15 MB</p></div>
  <div class="span"><label>Outfit / fitting video (optional)</label>
   <div class="fields">
     <div><label>Upload video from device</label><input type="file" name="video_file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"></div>
     <div><label>Record a new video</label><input type="file" name="video_camera" accept="video/*" capture="environment"></div>
   </div>
   <p class="muted">Choose one video (maximum 40 MB). Private to authorized staff and linked to this measurement slip.</p>
   ${d?.video_path?`<button type="button" class="btn alt" data-media="${esc(d.id)}" data-kind="video">View saved video</button>`:''}
  </div>
  <div><label>Voice remarks</label><div class="actions"><button type="button" class="btn alt" id="recordVoice">● Record</button><button type="button" class="btn alt" id="stopVoice" disabled>Stop</button></div><p id="voiceStatus" class="muted">No new voice note recorded</p></div>
 </div>
 <div class="slip-save-bar">
 <div class="actions"><button type="submit" class="btn" id="saveSlipBtn">Save Draft${d?' '+esc(d.slip_no):' — Reserve GL Slip No.'}</button>${d?'<button type="button" class="btn alt" id="cancelDraftEdit">New slip instead</button>':''}</div>
 <div id="slipSaveFeedback" class="slip-save-feedback slip-save-info" role="status" aria-live="polite">Tap Save Draft to store measurements in GALOIR. Unfinished entries can be recovered temporarily in this tab.</div>
 </div>
 <p class="muted">Bill number and delivery confirmation are entered in Billing Desk. Printing is enabled after billing.</p>
 </form></div>`:''}
 <div class="panel"><h3>Measurement History</h3><input id="searchMeasurements"><div id="measurementRows">${measurementTable(measurements)}</div></div>`;
}
function measurementTable(rows){
 const list=rows.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,200);
 return `<p class="muted">${list.length} slips shown${rows.length>200?' (search to find older records)':''}</p><table><tr><th>Slip / Stage</th><th>Customer / Phone</th><th>Outfit / Design / Barcode</th><th>Salesperson</th><th>Delivery</th><th>Bill</th><th>Final Amount (₹)</th><th>Actions</th></tr>${list.map(m=>{
  const c=customers.find(x=>x.id===m.customer_id);
  const isBilled=m.workflow_status==='billed'&&Boolean(m.bill_no);
  const deletable=role==='admin'&&m.workflow_status==='draft'&&!String(m.bill_no||'').trim()&&!orders.some(o=>o.measurement_id===m.id);
  return `<tr><td><strong>${esc(m.slip_no||'—')}</strong>
    ${m.imported_from_manual?`<br><small class="muted">Manual ${esc(m.manual_booklet_name)} / ${esc(m.manual_slip_no)}</small>`:''}
    <br><span class="pill">${isBilled?'Billed':'Draft'}</span></td><td>${esc(c?.full_name||'Customer')}<br><span class="muted">${esc(phoneForDisplay(c?.phone))}</span></td><td>${esc(m.item_name||'Not entered')}<br><span class="muted">Design: ${esc(m.design_number||'—')}</span><br><span class="muted">Barcode: ${esc(m.product_barcode||'—')}</span></td><td>${esc(m.salesperson_name||'—')}</td><td>${esc(outputDate(m.delivery_date))}</td><td>${esc(m.bill_no||'Pending billing')}</td><td>${m.final_billing_amount==null?'—':'₹'+esc(Number(m.final_billing_amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td><td><div class="actions">${isBilled?`<button type="button" class="btn alt" data-print="${esc(m.id)}">Print</button>`:`${can('measurements')?`<button type="button" class="btn alt" data-edit-draft="${esc(m.id)}">Continue draft</button><button type="button" class="btn" data-open-cashier="${esc(m.id)}">Bill</button>`:''}`}
  ${deletable?`<button type="button" class="btn danger-outline" data-delete-draft="${esc(m.id)}">Delete Draft</button>`:''}
  ${m.photo_path?`<button type="button" class="btn alt" data-media="${esc(m.id)}" data-kind="photo">Photo</button>`:''}${m.voice_path?`<button type="button" class="btn alt" data-media="${esc(m.id)}" data-kind="voice">Voice</button>`:''}${m.video_path?`<button type="button" class="btn alt" data-media="${esc(m.id)}" data-kind="video">Video</button>`:''}</div><details><summary>Measurements</summary><pre>${esc(JSON.stringify(m.values,null,2))}</pre><p class="muted">${esc(m.remarks||'')}</p></details></td></tr>`;
 }).join('')}</table>`;
}
function cashierView(){
 const drafts=measurements.filter(m=>m.workflow_status==='draft').sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const billed=measurements.filter(m=>m.workflow_status==='billed'&&m.bill_no).sort((a,b)=>b.billed_at?.localeCompare(a.billed_at||'')||0).slice(0,60);
 const justBilled=measurements.find(m=>m.id===lastBilledSlipId&&m.workflow_status==='billed'&&m.bill_no);
 return `${justBilled?`<div class="panel billing-success" id="billingSuccess">
 <h3>Billing complete — ${esc(justBilled.slip_no)}</h3>
 <p>Bill No. <strong>${esc(justBilled.bill_no)}</strong> was saved and the delivery was booked successfully.</p>
 <p><strong>Total:</strong> ${formatInr(justBilled.final_billing_amount)} &nbsp; <strong>Paid:</strong> ${justBilled.paid_amount==null?'Not recorded':formatInr(justBilled.paid_amount)} &nbsp; <strong>Balance:</strong> ${justBilled.paid_amount==null?'—':formatInr(Number(justBilled.final_billing_amount||0)-Number(justBilled.paid_amount))}</p>
 <p class="muted">A WhatsApp confirmation is queued only with customer consent and when the Admin enables messaging.</p>
 <button type="button" class="btn" data-print="${esc(justBilled.id)}">Print Tailor Slip Now</button>
 </div>`:''}<div class="panel"><h3>Cashier Billing Desk · ${drafts.length} draft slip${drafts.length===1?'':'s'} waiting</h3><p class="muted">Sales can save half-filled slips. The cashier must enter the final billing amount, bill number and remaining delivery details before confirming. The amount is kept for internal records and never appears on the tailor printout. Only billed slips can be printed. This desk works with the common Sales login or Admin login.</p>${drafts.length?drafts.map(m=>{
  const c=customers.find(x=>x.id===m.customer_id),full=m.order_type==='self_alter'&&m.delivery_date&&countDate(m.delivery_date)>=capacity;
  return `<div class="panel"><h3>Slip ${esc(m.slip_no)} — Ready for Billing</h3>
  <div class="fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px;margin-bottom:18px;padding:14px;background:#f4f2ee;border-radius:10px">
   <div><label>Customer Name</label><strong>${esc(c?.full_name||'Unknown customer')}</strong></div>
   <div><label>Phone Number</label><strong>${esc(phoneForDisplay(c?.phone))}</strong></div>
   <div><label>Order Type</label><strong>${m.order_type==='new_make'?'New Make':'Self Alter'}</strong></div>
   <div><label>Design Number</label><strong>${esc(m.design_number||'Not entered')}</strong></div>
  </div>
  <form class="cashierForm" data-slip-id="${esc(m.id)}">
  <p class="muted">Enter the bill number and final amount, then confirm. The Print Tailor Slip button appears immediately afterward.</p>
  <div class="fields">
  <div><label>Bill number *</label><input name="bill_no" maxlength="100" required></div>
  <div><label>Total Billing Amount (₹) *</label><input name="final_billing_amount" type="number" min="0.01" max="9999999999.99" step="0.01" inputmode="decimal" value="${esc(m.final_billing_amount??'')}" required></div>
  <div><label>Amount Paid (₹) *</label><input name="paid_amount" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(m.paid_amount??'')}" required><p class="muted">Enter 0 if nothing has been paid yet.</p></div>
  <div><label>Balance Due (₹)</label><div class="cashierBalance payment-balance">Enter amount paid</div><p class="muted">Automatically calculated: Total − Paid.</p></div>
  <div class="span whatsapp-optin"><label><input type="checkbox" name="whatsapp_opt_in" value="yes" style="width:auto" ${m.whatsapp_opt_in?'checked':''}> Customer has agreed to receive order updates on WhatsApp</label><p class="muted">Optional, unchecked by default. Without consent, no WhatsApp messages are queued. Notifications also require Admin to enable the WhatsApp integration.</p></div>
  <input type="hidden" name="item_name" value="${esc(m.item_name||(m.order_type==='new_make'?'New Make Outfit':'Self Alter Outfit'))}">
  <div><label>Delivery date *</label>${coloredDateInput('cashierDate-'+m.id,m.delivery_date||'')}</div>
  <div><label>Product Barcode (optional${m.order_type==='new_make'?' for New Make':''})</label><input name="product_barcode" maxlength="120" value="${esc(m.product_barcode||'')}"></div>
  <div><label>Design Number (optional)</label><input name="design_number" maxlength="100" value="${esc(m.design_number||'')}"></div>
  </div><p class="muted">Preparation required: <strong>${m.days_required??3} day(s)</strong> — set on the measurement slip. To change it, choose Complete measurements first.</p>
  <p class="preparation-lead-warning hidden cashierLeadWarning" role="alert" aria-live="assertive"></p>
  <p class="muted">Self Alter slots: ${m.delivery_date?countDate(m.delivery_date):'—'}/${capacity}. New Make is unlimited. Dates are booked on this confirmation.</p>
  <div class="panel cashierOverride ${full?'':'hidden'}"><h3>Full-date authorization</h3><p class="muted">Enter the Admin or Manager email and password for one extra Self Alter booking.</p><div class="fields"><div><label>Supervisor email</label><input name="reviewer_email" type="email" autocomplete="off"></div><div><label>Supervisor password</label><input name="reviewer_password" type="password" autocomplete="off"></div></div></div>
  <button type="submit" class="btn">Confirm Billing & Enable Print</button><button type="button" class="btn alt" data-edit-draft="${esc(m.id)}">Complete measurements first</button>
  ${role==='admin'&&!String(m.bill_no||'').trim()&&!orders.some(o=>o.measurement_id===m.id)?`<button type="button" class="btn danger-outline" data-delete-draft="${esc(m.id)}">Delete Unbilled Draft</button>`:''}
  </form></div>`;
 }).join(''):'<p>No drafts waiting for billing.</p>'}</div><div class="panel"><h3>Billed Slips · Ready to print</h3>${billed.length?`<table><tr><th>Slip</th><th>Customer / Phone</th><th>Order Type</th><th>Bill No.</th><th>Design No.</th><th>Barcode</th><th>Total (₹)</th><th>Paid (₹)</th><th>Balance (₹)</th><th>Print</th></tr>${billed.map(m=>{const c=customers.find(x=>x.id===m.customer_id);return `<tr><td>${esc(m.slip_no)}</td><td>${esc(c?.full_name||'—')}<br><span class="muted">${esc(phoneForDisplay(c?.phone))}</span></td><td>${m.order_type==='new_make'?'New Make':'Self Alter'}</td><td>${esc(m.bill_no)}</td><td>${esc(m.design_number||'—')}</td><td>${esc(m.product_barcode||'—')}</td><td>${m.final_billing_amount==null?'—':esc(formatInr(m.final_billing_amount))}</td><td>${m.paid_amount==null?'—':esc(formatInr(m.paid_amount))}</td><td>${m.paid_amount==null||m.final_billing_amount==null?'—':esc(formatInr(Number(m.final_billing_amount)-Number(m.paid_amount)))}</td><td><button class="btn" type="button" data-print="${esc(m.id)}">Print Tailor Slip</button></td></tr>`}).join('')}</table>`:'<p class="muted">No billed slips yet.</p>'}</div>`;
}
function calendarView(){const year=month.getFullYear(),mo=month.getMonth(),first=new Date(year,mo,1).getDay(),days=new Date(year,mo+1,0).getDate();let cells=Array(first).fill('<div></div>');for(let n=1;n<=days;n++){const d=dateStr(new Date(year,mo,n)),cnt=countDate(d),weekday=new Date(year,mo,n).getDay(),weekend=weekday===0||weekday===6,past=d<today,dayClass=weekend?'weekend':past?'past':cnt>=capacity?'full':'available';cells.push(`<button class="day ${dayClass} ${selectedDate===d?'selected':''}" data-date="${d}" aria-label="${d}, ${weekend?'weekend, ':''}${Math.max(0,capacity-cnt)} Self Alter slots free"><strong>${n}</strong><small>${Math.max(0,capacity-cnt)} / ${capacity} Alter slots</small><small>${newCount(d)} New Make</small></button>`)}return `<div class="panel"><div class="top"><h3>${month.toLocaleString('en-IN',{month:'long',year:'numeric'})}</h3><div class="actions"><button class="btn alt" id="prevMonth">Previous</button><button class="btn alt" id="nextMonth">Next</button></div></div><p class="muted">Green: available Self Alter slots · Red: Saturday / Sunday · Amber: full Self Alter date · Grey: past weekday. Weekends can still be booked according to normal rules; New Make remains unlimited.</p><div class="calendar">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((x,i)=>`<div class="right ${i===0||i===6?'weekend-heading':'muted'}">${x}</div>`).join('')}${cells.join('')}</div></div><div class="panel"><h3>Book delivery — ${esc(selectedDate)}</h3><p class="muted">${countDate(selectedDate)} of ${capacity} Self Alter slots used · ${newCount(selectedDate)} New Make bookings (unlimited).</p>${can('bookings')?`<form id="bookingForm"><div class="fields">
<div><label>Customer</label><select name="customer_id" id="bookingCustomer" required>${customerOptions()}</select></div>
<div><label>Outfit</label><input name="item_name" required maxlength="200"></div>
<div><label>Order type</label><select name="order_type" id="bookingType">${makeOptions()}</select></div>
<div><label>Delivery date</label>${coloredDateInput('bookingDate',selectedDate)}</div>
<div><label>Measurement slip (optional)</label><select name="measurement_id" id="bookingMeasurement"><option value="">None</option></select></div>
<div><label>Preparation days</label><input name="days_required" id="bookingPrepDays" type="number" min="0" max="60" step="1" value="3" required></div>
 <div class="span preparation-lead-warning hidden" id="bookingLeadWarning" role="alert" aria-live="assertive"></div>
<div class="span"><label>Booking notes</label><textarea name="notes"></textarea></div>
</div>${overrideFields('booking')}<button class="btn" type="submit" ${!customers.length||selectedDate<today?'disabled':''}>Book delivery</button></form>`:'<p>Read-only calendar.</p>'}</div><div class="panel"><h3>Scheduled outfits</h3>${ordersTable(orders.filter(o=>o.delivery_date===selectedDate))}</div>`}
function dailyView(){return `<div class="panel"><h3>Daily delivery list</h3><div class="actions"><div style="width:min(370px,100%)"><label>Choose delivery date</label>${coloredDateInput('dailyDate',selectedDate,true)}</div></div>${ordersTable(orders.filter(o=>o.delivery_date===selectedDate))}</div><div class="panel"><h3>Overdue and pending work</h3>${ordersTable(orders.filter(o=>o.delivery_date<today&&o.status!=='delivered'))}</div>`}
function tailoringView(){const statuses=['pending','stitching','trial','alteration','ready','delivered'];return `<div class="panel"><h3>Update tailoring progress</h3><table><tr><th>Customer</th><th>Outfit</th><th>Due</th><th>Status</th></tr>${orders.filter(o=>o.status!=='delivered').map(o=>`<tr><td>${esc(customerName(o.customer_id))}</td><td>${esc(o.item_name)}</td><td>${esc(o.delivery_date)}</td><td><select data-status="${o.id}">${statuses.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</table></div>`}
function settingsView(){
 const submitted=waNotifications.filter(x=>x.status==='submitted').length,
 pending=waNotifications.filter(x=>x.status==='pending'||x.status==='processing').length,
 failed=waNotifications.filter(x=>x.status==='failed').length;
 const configStatus=waConfiguration
  ?waConfiguration.configured?'WATI credentials present (verify approved Utility templates).':'WATI API token or sending channel missing.'
  :'Not checked — press Check API Setup.';
 const waRows=waNotifications.map(x=>{
  const m=measurements.find(v=>v.id===x.measurement_id);
  return `<tr><td>${esc(m?.slip_no||'—')}</td><td>${x.event_type==='order_confirmed'?'Order Finalised':'Ready for Collection'}</td>
  <td><span class="pill">${esc(x.status)}</span></td><td>${esc(x.submitted_at?new Date(x.submitted_at).toLocaleString('en-IN'):new Date(x.created_at).toLocaleString('en-IN'))}</td>
  <td>${esc(x.last_error||'—')}</td></tr>`;
 }).join('');
 return `<div class="panel"><h3>Self Alter daily capacity</h3><p>Current limit: <strong>${capacity} Self Alter outfits per day</strong>. New Make is unlimited. Over-capacity Self Alter bookings require a new Admin/Manager password approval per booking.</p><form id="capacityForm"><label>Self Alter daily limit</label><input name="capacity" type="number" min="1" max="1000" value="${capacity}" required style="max-width:220px"><p><button class="btn">Save capacity</button></p></form></div>
 <section class="panel whatsapp-settings-panel">
  <div class="top"><h3>WhatsApp Business Notifications · WATI</h3><span class="pill">${waEnabled?'ENABLED':'OFF — SAFE MODE'}</span></div>
  <p>Send two customer-approved messages: <b>Order Finalised</b> (total, paid, balance and delivery date), and <b>Ready for Collection</b> (GL slip and pickup notification).</p>
  <p class="muted">Only send to customers who expressly consent at Billing Desk. These are business-initiated messages: your two Utility templates must be approved in WATI. The WATI API token stays in Supabase Edge Function Secrets.</p>
  <p><strong>Connection:</strong> ${esc(configStatus)}</p>
  <div class="actions">
   <button type="button" class="btn alt" id="waCheckSetup">Check API Setup</button>
   ${role==='admin'?`<button type="button" class="btn ${waEnabled?'alt':'primary'}" id="waToggle">${waEnabled?'Disable WhatsApp Automation':'Enable WhatsApp Automation'}</button>`:''}
  </div>
  ${!waEnabled&&role==='admin'?'<label class="wa-approval"><input type="checkbox" id="waTemplatesApproved" style="width:auto"> I have approved both Utility templates in WATI, verified our connected WhatsApp sending number, and will collect customer opt-in.</label>':''}
  <p class="muted">No messages will be sent until this integration is enabled by Admin. Newly finalized opted-in orders will be queued automatically after activation; already-billed orders are not contacted retroactively.</p>
  <p class="muted"><b>WATI setup:</b> WATI Connector → API → Create API Token (permission: messagetemplatev3:write). Set <code>WATI_API_TOKEN</code>, <code>WATI_CHANNEL_NUMBER</code>, <code>WATI_TEMPLATE_ORDER_CONFIRMED</code>, and <code>WATI_TEMPLATE_READY_FOR_COLLECTION</code> as Supabase Edge Function Secrets. Never enter the token in this browser.</p>
  <div class="wa-count-grid"><div><strong>${pending}</strong><small>Pending</small></div><div><strong>${submitted}</strong><small>Accepted by WATI</small></div><div><strong>${failed}</strong><small>Need attention</small></div></div>
  <p class="muted">Submitted means WATI accepted the message request. Delivery/read receipts are not tracked yet. Showing the latest 60 queued records.</p>
  <div class="table-scroll"><table><tr><th>GL Slip</th><th>Notification</th><th>State</th><th>Event Time</th><th>Error</th></tr>${waRows||'<tr><td colspan="5">No notifications have been queued yet.</td></tr>'}</table></div>
 </section>`;
}
function salespersonOptions(){return salespeople.filter(s=>s.active).slice().sort((a,b)=>a.full_name.localeCompare(b.full_name)).map(s=>`<option value="${esc(s.full_name)}">${esc(s.full_name)}</option>`).join('')}
function salespeopleView(){const rows=salespeople.slice().sort((a,b)=>a.full_name.localeCompare(b.full_name));return `<div class="panel"><h3>Salespeople</h3><p class="muted">Salespeople do not need separate logins. Staff can use the common Sales account and select their own name when taking measurements.</p><form id="addSalespersonForm"><div class="fields"><div><label>Add salesperson name</label><input name="full_name" maxlength="100" required></div></div><button class="btn">Add Salesperson</button></form></div><div class="panel"><h3>Manage salesperson names</h3><table><tr><th>Name</th><th>Active</th><th>Actions</th></tr>${rows.map(s=>`<tr><td><input data-salesperson-name="${esc(s.id)}" value="${esc(s.full_name)}" maxlength="100" aria-label="Salesperson name"></td><td>${s.active?'Active':'Inactive'}</td><td><button type="button" class="btn alt" data-rename-salesperson="${esc(s.id)}">Rename</button> <button type="button" class="btn alt" data-toggle-salesperson="${esc(s.id)}">${s.active?'Deactivate':'Reactivate'}</button></td></tr>`).join('')||'<tr><td colspan="3">No salespeople yet. Add the first name above.</td></tr>'}</table><p class="muted">Deactivating a salesperson hides their name from new forms; past measurement records retain their original name.</p></div>`}
function staffView(){return `<div class="panel"><h3>Manage existing Supabase users</h3><p class="muted">For one common Sales login, create a Supabase Authentication user, then copy its User UID and assign the Sales role here. Manage employees' individual names separately under Salespeople.</p><form id="staffForm"><div class="fields"><div><label>Full name</label><input name="full_name" required></div><div><label>Supabase Auth User UID</label><input name="user_id" required></div><div><label>Role</label><select name="role"><option value="sales">Sales</option><option value="tailoring">Tailoring</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div></div><button class="btn">Save Staff Role</button></form></div><div class="panel"><h3>Staff access</h3><table><tr><th>Name / Email</th><th>Role</th><th>Active</th><th>Action</th></tr>${profiles.map(p=>`<tr><td>${esc(p.full_name)}<br><span class="muted">${esc(p.email)}</span></td><td><select data-role="${p.id}">${['sales','tailoring','manager','admin'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join('')}</select></td><td><input type="checkbox" data-active="${p.id}" ${p.active?'checked':''} style="width:auto"></td><td><button class="btn alt" data-save-staff="${p.id}">Save</button></td></tr>`).join('')}</table></div>`}
function reportsView(){return `<div class="grid">${[['Total customers',customers.length],['Total orders',orders.length],['Delivered',orders.filter(o=>o.status==='delivered').length],['Open',orders.filter(o=>o.status!=='delivered').length]].map(x=>`<div class="card"><div class="muted">${x[0]}</div><div class="stat">${x[1]}</div></div>`).join('')}</div>`}
async function staffCall(payload){const p=payload.action==='update'?profiles.find(x=>x.id===payload.id):null;const {error:e}=await sb.rpc('admin_set_staff',{p_user_id:payload.action==='update'?payload.id:payload.user_id,p_role:payload.role,p_full_name:p?p.full_name:payload.full_name,p_active:payload.action==='update'?payload.active:true});if(e)throw e;return {ok:true}}
async function deleteUnbilledDraft(m){
 if(role!=='admin'||m.workflow_status!=='draft'||String(m.bill_no||'').trim()||orders.some(o=>o.measurement_id===m.id)){
  return notify('Only Admin can delete slips that have no bill number or delivery booking');
 }
 if(!window.confirm('Permanently delete '+(m.slip_no||'this slip')+' and all attached photos, voice notes and videos? This cannot be undone.'))return;
 const bucket=sb.storage.from('galoir-measurement-media');
 try{
  // Delete actual files through the Storage API to avoid orphaned objects.
  let empty=false;
  for(let i=0;i<100;i++){
    const {data:files,error:listError}=await bucket.list(m.id,{limit:100,offset:0});
    if(listError)throw listError;
    if(!files||files.length===0){empty=true;break}
    const paths=files.filter(x=>x.name&&x.id).map(x=>m.id+'/'+x.name);
    if(paths.length!==files.length)throw Error('Unexpected storage folder contents; deletion stopped');
    const {error:removeError}=await bucket.remove(paths);
    if(removeError)throw removeError;
  }
  if(!empty)throw Error('Too many attachments to delete automatically');
  const {data:deletedSlip,error:deleteError}=await sb.rpc('admin_delete_unbilled_slip',{p_measurement_id:m.id});
  if(deleteError)throw deleteError;
  if(editingDraftId===m.id)editingDraftId=null;
  await refresh();
  notify('Deleted unbilled measurement slip '+(deletedSlip||m.slip_no));
 }catch(e){error(e)}
}
function bindSharedActions(){document.querySelectorAll('[data-ready-id]').forEach(el=>el.onchange=async()=>{const checked=el.checked;try{const {error:e}=await sb.rpc('set_order_ready',{p_order_id:el.dataset.readyId,p_ready:checked});if(e)throw e;notify(checked?'Outfit marked READY':'Outfit marked NOT READY');await refresh()}catch(x){el.checked=!checked;error(x)}});document.querySelectorAll('[data-supplier-id]').forEach(el=>el.onclick=async()=>{const o=orders.find(x=>x.id===el.dataset.supplierId);try{const {error:e}=await sb.rpc('set_supplier_informed',{p_order_id:el.dataset.supplierId,p_informed:!o?.supplier_notified_at});if(e)throw e;notify(o?.supplier_notified_at?'Supplier follow-up reopened':'Supplier informed');await refresh()}catch(x){error(x)}});document.querySelectorAll('[data-print]').forEach(el=>el.onclick=()=>{const m=measurements.find(x=>x.id===el.dataset.print);if(m)printSlip(m).catch(error)});document.querySelectorAll('[data-media]').forEach(el=>el.onclick=()=>{const m=measurements.find(x=>x.id===el.dataset.media);if(m)openPrivateMedia(m,el.dataset.kind)});
document.querySelectorAll('[data-edit-draft]').forEach(el=>el.onclick=()=>{const draft=measurements.find(m=>m.id===el.dataset.editDraft);if(!draft||draft.workflow_status!=='draft')return;editingDraftId=draft.id;tab='measurements';render();window.scrollTo({top:0,behavior:'smooth'})});
document.querySelectorAll('[data-open-cashier]').forEach(el=>el.onclick=()=>{tab='cashier';render();document.querySelector('[data-slip-id="'+el.dataset.openCashier+'"]')?.scrollIntoView({behavior:'smooth',block:'center'})});
document.querySelectorAll('[data-delete-draft]').forEach(el=>el.onclick=async()=>{
 const draft=measurements.find(m=>m.id===el.dataset.deleteDraft);
 if(!draft)return;
 el.disabled=true;
 try{await deleteUnbilledDraft(draft)}finally{if(el.isConnected)el.disabled=false}
});
document.querySelectorAll('.cashierForm').forEach(form=>{
 const id=form.dataset.slipId,m=measurements.find(x=>x.id===id);
 if(!m)return;
 const dateInput=form.querySelector('.cashierDate'),warning=form.querySelector('.cashierOverride');
 const toggle=()=>{const date=dateInput?.value,full=m.order_type==='self_alter'&&date&&countDate(date)>=capacity;warning?.classList.toggle('hidden',!full)};
 dateInput?.addEventListener('change',toggle);toggle();
 form.querySelector('[name="paid_amount"]')?.addEventListener('input',()=>updateCashierBalance(form));
 form.querySelector('[name="final_billing_amount"]')?.addEventListener('input',()=>updateCashierBalance(form));
 updateCashierBalance(form);
 form.addEventListener('submit',async e=>{
  e.preventDefault();const f=new FormData(form),submit=form.querySelector('button[type="submit"]');
  if(submit)submit.disabled=true;
  try{
   const day=String(f.get('delivery_date')||''),bill=String(f.get('bill_no')||'').trim(),item=String(f.get('item_name')||'').trim();
   if(!bill)throw Error('Enter the bill number to complete billing');
   if(!day||day<today)throw Error('Select a valid delivery date from the colored calendar');
   const leadProblem=preparationLeadTimeMessage(day,m.days_required??3);
   if(leadProblem)throw Error(leadProblem);
   const amountText=String(f.get('final_billing_amount')||'').trim();
   const finalAmount=Number(amountText);
   if(!/^\d+(?:\.\d{1,2})?$/.test(amountText)||!Number.isFinite(finalAmount)||finalAmount<=0||finalAmount>9999999999.99)
     throw Error('Enter a valid final billing amount in rupees (greater than ₹0, maximum two decimals)');
   const paidText=String(f.get('paid_amount')||'').trim();
   const paidAmount=Number(paidText);
   if(!/^\d+(?:\.\d{1,2})?$/.test(paidText)||!Number.isFinite(paidAmount)||paidAmount<0||paidAmount>finalAmount)
     throw Error('Paid amount must be between ₹0 and the total billing amount (up to two decimals)');
   const approval=await getOverrideForBooking(f,m.order_type,day);
   const {data,error:billError}=await sb.rpc('finalize_slip_billing_v4',{
    p_measurement_id:id,
    p_bill_no:bill,
    p_item_name:item,
    p_delivery_date:day,
    p_product_barcode:f.get('product_barcode')||null,
    p_design_number:f.get('design_number')||null,
    p_final_billing_amount:finalAmount,
    p_paid_amount:paidAmount,
    p_whatsapp_opt_in:f.has('whatsapp_opt_in'),
    p_override_token:approval
   });
   if(billError)throw billError;
   lastBilledSlipId=data.measurement_id;
   editingDraftId=null;
   await refresh();
   $('billingSuccess')?.scrollIntoView({behavior:'smooth',block:'start'});
   notify(data.slip_no+' billed — '+formatInr(finalAmount)+' total, '+formatInr(paidAmount)+' paid, '+formatInr(finalAmount-paidAmount)+' balance. Print is ready.'+(f.has('whatsapp_opt_in')&&!waEnabled?' WhatsApp disabled until Admin setup.':''));
  }catch(err){error(err)}finally{if(submit&&submit.isConnected)submit.disabled=false}
 });
});

 document.querySelectorAll('[data-master-id]').forEach(el=>el.onchange=async()=>{
  const next=el.checked;el.disabled=true;
  try{
   const {error:e}=await sb.rpc('set_master_room_sent',{p_order_id:el.dataset.masterId,p_sent:next});
   if(e)throw e;
   notify(next?'Marked as sent to master room':'Master-room handoff reopened');
   await refresh();
  }catch(e){el.checked=!next;error(e)}finally{if(el.isConnected)el.disabled=false}
 });
 document.querySelectorAll('[data-deliver-id]').forEach(el=>el.onchange=async()=>{
  const next=el.checked;el.disabled=true;
  try{
   const {error:e}=await sb.rpc('set_outfit_delivered',{p_order_id:el.dataset.deliverId,p_delivered:next});
   if(e)throw e;
   notify(next?'Outfit marked delivered':'Delivery marked as not delivered');
   await refresh();
  }catch(e){el.checked=!next;error(e)}finally{if(el.isConnected)el.disabled=false}
 });
}
function updateOverrideVisibility(prefix){const type=$(prefix==='slip'?'slipType':'bookingType')?.value,date=$(prefix==='slip'?'slipDate':'bookingDate')?.value,panel=$(prefix+'Override');if(panel)panel.classList.toggle('hidden',!(type==='self_alter'&&date&&countDate(date)>=capacity))}
async function getOverrideForBooking(formData,type,date){if(type!=='self_alter'||countDate(date)<capacity)return null;const email=String(formData.get('reviewer_email')||'').trim(),password=String(formData.get('reviewer_password')||'');if(!email||!password)throw Error('Self Alter date is full — Admin/Manager login email and password required');const reviewer=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'galoir-one-time-supervisor'}});try{const {error:e}=await reviewer.auth.signInWithPassword({email,password});if(e)throw Error('Supervisor password incorrect or account unavailable');const {data,error:issueError}=await reviewer.rpc('issue_booking_override',{p_delivery_date:date});if(issueError)throw Error('Only an active Admin or Manager can authorize: '+issueError.message);return data}finally{try{await reviewer.auth.signOut({scope:'local'})}catch(_){}}}
async function uploadMedia(id,kind,file){
 let mime=String(file.type||'').split(';')[0].toLowerCase();
 const supported={
  photo:{'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'},
  voice:{'audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav','audio/x-m4a':'m4a','video/mp4':'mp4'},
  video:{'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','video/x-m4v':'m4v'}
 };
 if(kind==='video'&&!mime){
  const extension=String(file.name||'').split('.').pop().toLowerCase();
  mime={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/x-m4v'}[extension]||'';
 }
 const ext=supported[kind]?.[mime];
 if(!ext)throw Error('Unsupported '+kind+' format '+(mime||'unknown'));
 const limit=kind==='video'?41943040:15728640;
 if(file.size>limit)throw Error('Maximum '+kind+' size is '+(kind==='video'?'40 MB':'15 MB'));
 const path=id+'/'+kind+'-'+crypto.randomUUID()+'.'+ext;
 const {error:upError}=await sb.storage.from('galoir-measurement-media').upload(path,file,{contentType:mime,upsert:false});
 if(upError)throw upError;
 const {error:attachError}=await sb.rpc('attach_measurement_media',{p_measurement_id:id,p_kind:kind,p_path:path});
 if(attachError)throw attachError;
 return path;
}
async function openPrivateMedia(m,kind){
 const path=kind==='photo'?m.photo_path:kind==='voice'?m.voice_path:kind==='video'?m.video_path:null;
 if(!path)return notify('No attachment found');
 const win=window.open('about:blank','_blank');
 try{
  const {data,error:e}=await sb.storage.from('galoir-measurement-media').createSignedUrl(path,kind==='video'?900:300);
  if(e)throw e;
  if(win)win.location.href=data.signedUrl;
  else notify('Enable pop-ups to open media');
 }catch(err){if(win)win.close();error(err)}
}
async function printSlip(m){
  if(m.workflow_status!=='billed'||!m.bill_no)return notify('Complete billing before printing this slip');
  const win=window.open('','_blank');
  if(!win)return notify('Please allow pop-ups to print the slip');
  try{
    const customer=customers.find(x=>x.id===m.customer_id);
    const order=orders.find(x=>x.measurement_id===m.id);
    const printPhotoPath=m.photo_path||m.manual_booklet_photo_path;
    const photoIsBooklet=!m.photo_path&&!!m.manual_booklet_photo_path;
    let photoURL='';
    if(printPhotoPath){
      const {data,error:photoSignError}=await sb.storage.from('galoir-measurement-media').createSignedUrl(printPhotoPath,900);
      if(photoSignError||!data?.signedUrl)throw new Error('Reference photo could not be accessed. Reopen the slip and retry printing.');
      photoURL=data.signedUrl;
    }
    const displayValue=v=>{
      if(v===null||v===undefined)return '';
      const value=String(v).trim();
      return value===''||value==='0'||value==='0.0'||value==='0.00'?'':value;
    };
    const deliver=[m.deliver_top?'Top':null,m.deliver_bottom?'Bottom':null,m.deliver_dupatta?'Dupatta':null].filter(Boolean).join(', ');
    const details=[
      ['Customer',customer?.full_name],['Phone',maskCustomerPhone(customer?.phone)],['Bill No.',m.bill_no],
      ['Product Barcode',m.product_barcode],['Design Number',m.design_number],
      ['Order Date',outputDate(m.order_date)],['Order Type',m.order_type==='new_make'?'New Make':'Self Alter'],
      ['Outfit',m.item_name],['Company',m.company_name],
      ['Reviewed By',m.reviewed_by],['Size Basis',m.ready_body],
      ['Preparation Days',m.days_required],['CRM Ready',order?.is_ready?'Yes':'No'],['Deliver',deliver],
       ...(m.imported_from_manual?[['Old Manual Slip',m.manual_slip_no],['Booklet',m.manual_booklet_name]]:[])
    ];
    // Two clean print columns. Read down the left column, then down the right.
    // Only the print layout is reordered: stored measurement keys never change.
    const groups=Object.entries(measureGroups).map(([title,items])=>{
      const rows=Math.ceil(items.length/2);
      const printOrder=[];
      for(let i=0;i<rows;i++){
        printOrder.push(items[i]);
        if(items[i+rows])printOrder.push(items[i+rows]);
      }
      return `<section class="measure-section" style="--rows:${rows}">
        <h3>${esc(measurementGroupDisplayName(title))} — INCHES</h3>
        <div class="measure-grid">${printOrder.map(name=>`
          <div class="measure-cell">
            <span class="measure-name">${esc(name)}</span>
            <strong class="measure-value">${esc(displayValue(measurementValue(m.values,title,name)))}</strong>
          </div>`).join('')}
        </div>
      </section>`;
    }).join('');
    const doc=`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>GALOIR Tailor Slip — ${esc(m.slip_no||'')}</title>
    <style>
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#ececec;color:#171717;font-family:Arial,Helvetica,sans-serif}
      .print-toolbar{padding:13px;text-align:center}
      .print-toolbar button{border:0;border-radius:7px;padding:11px 24px;background:#25211e;color:#fff;font-size:15px;cursor:pointer}
      #printPage{width:190mm;height:265mm;overflow:hidden;background:#fff;margin:0 auto 12px;box-shadow:0 2px 18px #0002}
      #printSheet{width:190mm;min-height:265mm;height:auto;display:flex;flex-direction:column;gap:6px;padding:0 1mm;
        font-size:14px;line-height:1.22;transform-origin:top left;overflow:visible}
      .slip-header{display:flex;align-items:center;justify-content:space-between;gap:12px;
        padding:2px 3px 6px;border-bottom:2px solid #292521;flex-shrink:0}
      .brand-block{flex:1 1 auto;min-width:0}
      .header-barcode{flex:0 1 46%;max-width:325px;min-width:205px;text-align:right;display:flex;
        flex-direction:column;align-items:flex-end;gap:2px}
      .header-barcode .slip-title{font-size:12px;font-weight:800;letter-spacing:.35px}
      .header-barcode .tailor-slip-barcode{display:block;width:100%;height:64px;max-width:320px;min-width:0}
      .header-barcode .barcode-hint{font-size:9px;font-weight:700;letter-spacing:.35px;color:#48413a}
      .brand{font-size:30px;font-weight:800;letter-spacing:1px}
      .address{font-size:11px;line-height:1.4}
      .slip-title{text-align:right;font-size:13px;font-weight:700}
      .slip-number{font-size:23px;font-weight:850;margin-top:4px}
      .priority-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:2px solid #333;background:#f3f3f3;flex-shrink:0}
      .priority-cell{min-width:0;padding:7px 9px;border-right:1px solid #777}
      .priority-cell:last-child{border-right:0}
      .priority-label{display:block;color:#333;font-weight:800;font-size:11px;letter-spacing:.65px;margin-bottom:5px}
      .priority-value{display:block;font-size:20px;line-height:1.2;font-weight:850;overflow-wrap:anywhere}
      .slip-id{font-size:23px}
      .order-details{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 9px;flex-shrink:0}
      .detail{display:flex;justify-content:space-between;align-items:baseline;gap:5px;
        border-bottom:1px dotted #b7b7b7;min-width:0;min-height:27px;padding:5px 2px}
      .detail-label{font-size:12px;color:#4e4e4e;flex:0 0 auto}
      .detail-value{font-size:14px;font-weight:700;text-align:right;overflow-wrap:anywhere;min-width:0}
      .measurement-sections{display:flex;flex-direction:column;flex:1 0 auto;gap:6px;min-height:min-content}
      .measure-section{display:flex;flex-direction:column;flex:var(--rows) 1 auto;break-inside:avoid;min-height:max-content}
      .measure-section h3{font-size:15px;font-weight:800;margin:0;background:#dedede;
        padding:7px 10px;letter-spacing:.2px}
      .measure-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
        grid-auto-rows:minmax(28px,1fr);column-gap:15px;flex:1 0 auto}
      .measure-cell{display:grid;grid-template-columns:42% minmax(0,1fr);align-items:center;
        gap:7px;border-bottom:1px dotted #aaa;padding:4px 9px;min-width:0;min-height:28px}
      .measure-name{font-size:14px;font-weight:550;overflow-wrap:anywhere}
      .measure-value{font-size:18px;font-weight:800;text-align:right;overflow-wrap:anywhere;min-width:0}
      .remarks-area{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;min-height:118px;flex-shrink:0}
      /* Pant/Plazo section is gone: use the freed vertical space for a much larger
         reference image (roughly 5 × 5 cm) alongside both instruction boxes. */
      .remarks-area.with-photo{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 222px;min-height:225px}
      .remark-panel,.reference-panel{display:flex;flex-direction:column;min-width:0}
      .remark-panel h3,.reference-panel h3{font-size:14px;margin:0 0 5px;font-weight:800}
      .remark-box{flex:1;border:1px solid #aaa;padding:8px;min-height:86px;
        white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;font-weight:650;line-height:1.35}
      .reference-image-box{display:flex;flex:1;align-items:center;justify-content:center;min-height:208px;border:1px solid #aaa;padding:5px;background:white;overflow:hidden}
      .reference-photo{display:block;width:auto;height:auto;max-width:208px;max-height:202px;object-fit:contain}
      .photo-load-warning{font-size:12px;color:#a12a2a;font-weight:700}
      .print-toolbar button:disabled{opacity:.55;cursor:not-allowed}
      .print-footer{padding-top:4px;border-top:1px solid #bbb;font-size:10px;color:#444;flex-shrink:0}
      /* Compact only when the measured content would otherwise overflow A4. */
      #printSheet.compact-print{gap:3px}
      .compact-print .detail{min-height:24px;padding:3px 2px}
      .compact-print .priority-cell{padding:5px 7px}
      .compact-print .measure-grid{grid-auto-rows:minmax(25px,1fr)}
      .compact-print .measure-cell{min-height:25px;padding:2px 7px}
      .compact-print .measure-section h3{padding:5px 9px}
      .compact-print .remarks-area{min-height:96px}
      .compact-print .remarks-area.with-photo{min-height:205px}
      .compact-print .remark-box{min-height:68px;padding:6px}
      .compact-print .reference-image-box{min-height:188px}
      .compact-print .reference-photo{max-width:208px;max-height:184px}
      @page{size:A4 portrait;margin:8mm}
      @media print{
        /* iPadOS Safari: never put a full-page 'break-inside:avoid' element in
           normal print flow. Safari may move that element to a second page,
           leaving the first page blank even when the content visually fits.
           An absolutely positioned print surface has no pagination footprint. */
        html,body{width:190mm!important;height:0!important;min-height:0!important;
          max-height:0!important;margin:0!important;padding:0!important;
          overflow:visible!important;background:#fff!important}
        body{display:block!important;position:relative!important;
          -webkit-print-color-adjust:exact;print-color-adjust:exact}
        .print-toolbar{display:none!important}
        #printPage{display:block!important;position:absolute!important;top:0!important;left:0!important;
          width:190mm!important;height:265mm!important;max-height:265mm!important;
          margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;
          overflow:hidden!important;transform:none!important;
          break-before:auto!important;page-break-before:auto!important;
          break-inside:auto!important;page-break-inside:auto!important;
          break-after:auto!important;page-break-after:auto!important}
        #printSheet{width:190mm!important;height:auto!important;min-height:0!important;
          max-width:190mm!important;margin:0!important;overflow:visible!important;
          break-inside:auto!important;page-break-inside:auto!important}
        .measure-section{break-inside:auto!important;page-break-inside:auto!important}
      }
    </style></head><body>
    <div class="print-toolbar"><button type="button" id="printNow">Print A4 Tailor Slip</button><p id="photoLoadWarning" class="photo-load-warning" hidden></p></div>
    <main id="printPage"><article id="printSheet">
      <header class="slip-header">
        <div class="brand-block"><div class="brand">GALOIR</div>
          <div class="address">J-79, Rajouri Garden Main Market, New Delhi-110027</div></div>
        <div class="header-barcode"><div class="slip-title">TAILOR ORDER SLIP</div>
          ${slipCode39Svg(m.slip_no)}
          <div class="barcode-hint">SCAN GL BARCODE WHEN OUTFIT IS READY</div>
        </div>
      </header>
      <div class="priority-strip" aria-label="Important tailor details">
        <div class="priority-cell"><span class="priority-label">SLIP NUMBER</span><strong class="priority-value slip-id">${esc(m.slip_no||'—')}</strong></div>
        <div class="priority-cell"><span class="priority-label">DELIVERY DATE</span><strong class="priority-value">${esc(outputDate(m.delivery_date))}</strong></div>
        <div class="priority-cell"><span class="priority-label">SALESPERSON</span><strong class="priority-value">${esc(m.salesperson_name||'—')}</strong></div>
      </div>
      <div class="order-details">${details.map(([key,value])=>`
        <div class="detail"><span class="detail-label">${esc(key)}</span>
        <strong class="detail-value">${esc(displayValue(value))}</strong></div>`).join('')}</div>
      <div class="measurement-sections">${groups}</div>
      <div class="remarks-area ${photoURL?'with-photo':''}">
        <div class="remark-panel"><h3>REMARKS</h3><div class="remark-box">${esc(displayValue(m.remarks))}</div></div>
        <div class="remark-panel"><h3>FITTING INSTRUCTIONS</h3><div class="remark-box">${esc(displayValue(m.fitting_notes))}</div></div>
        ${photoURL?`<div class="reference-panel"><h3>${photoIsBooklet?'MANUAL BOOKLET PHOTO':'REFERENCE PHOTO'}</h3>
          <div class="reference-image-box"><img class="reference-photo" id="refPhoto" src="${esc(photoURL)}" alt="Outfit reference photo"></div>
        </div>`:''}
      </div>
      <footer class="print-footer">Voice note: ${m.voice_path?'Attached digitally':'None'}
        · Video: ${m.video_path?'Attached digitally':'None'}
        · GALOIR Measurement Studio</footer>
    </article></main></body></html>`;
    win.document.open();win.document.write(doc);win.document.close();
    function fitPage(){
      const sheet=win.document.getElementById('printSheet');
      const page=win.document.getElementById('printPage');
      if(!sheet)return;
      // Measure actual, unconstrained content. The old fixed-height flexbox
      // could shrink rows over one another while scrollHeight stayed one page.
      sheet.style.transform='none';
      sheet.classList.remove('compact-print');
      const maxPageHeightPx=265/25.4*96;
      const usableHeightPx=Math.min(page?.clientHeight||maxPageHeightPx,maxPageHeightPx);
      const fits=()=>sheet.scrollHeight<=usableHeightPx-4;
      if(!fits())sheet.classList.add('compact-print');
      // Never remove an attached photo. Scale the complete printable content, including the image.
      const naturalHeight=sheet.scrollHeight;
      const scale=Math.min(1,(usableHeightPx-4)/Math.max(naturalHeight,1));
      sheet.style.transform='scale('+scale+')';
    }
    const printButton=win.document.getElementById('printNow');
    const image=win.document.getElementById('refPhoto');
    const photoWarning=win.document.getElementById('photoLoadWarning');
    // Wait until the photo has actually loaded; otherwise browser print previews may omit it.
    const photoReady=()=>{
      fitPage();
      if(printButton){printButton.disabled=false;printButton.textContent='Print A4 Tailor Slip'}
    };
    const photoFailed=()=>{
      if(printButton){printButton.disabled=true;printButton.textContent='Reference photo unavailable'}
      if(photoWarning){photoWarning.hidden=false;photoWarning.textContent='Photo could not be loaded. Reopen the slip before printing so it is not missing.'}
    };
    if(printButton)printButton.onclick=()=>{
      if(image&&(!image.complete||!image.naturalWidth))return photoFailed();
      fitPage();win.focus();win.print();
    };
    if(image){
      if(printButton){printButton.disabled=true;printButton.textContent='Loading reference photo...'}
      if(image.complete){if(image.naturalWidth)photoReady();else photoFailed()}
      else{image.addEventListener('load',photoReady,{once:true});image.addEventListener('error',photoFailed,{once:true})}
    }else photoReady();
    win.addEventListener('beforeprint',fitPage);
    win.document.fonts?.ready.then(fitPage).catch(()=>{});
    fitPage();
  }catch(e){win.close();error(e)}
}
async function startRecording(){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return notify('Voice recording is unsupported in this browser');try{recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});const type=['audio/mp4','audio/webm','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));activeRecorder=new MediaRecorder(recordingStream,type?{mimeType:type}:undefined);const chunks=[];activeRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};activeRecorder.onstop=()=>{const mime=String(activeRecorder.mimeType||type||'audio/webm').split(';')[0];recordedAudio=new Blob(chunks,{type:mime});recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;if($('voiceStatus'))$('voiceStatus').textContent='Voice note captured ('+Math.ceil(recordedAudio.size/1024)+' KB)';if($('recordVoice'))$('recordVoice').disabled=false;if($('stopVoice'))$('stopVoice').disabled=true};activeRecorder.start();if($('voiceStatus'))$('voiceStatus').textContent='Recording…';$('recordVoice').disabled=true;$('stopVoice').disabled=false}catch(err){recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;error(err)}}
function updatePhoneLookup(){
 const phone=$('slipPhone'),select=$('slipCustomerSelect'),existing=$('existingCustomerBox'),fresh=$('newCustomerBox'),name=$('slipNewCustomerName'),status=$('phoneLookupStatus'),button=$('forceNewCustomer'),mode=$('forceNewCustomerValue');
 if(!phone||!select||!existing||!fresh||!name||!status||!mode)return;
 const matches=phoneMatches(phone.value);
 const forceNew=mode.value==='true';
 const before=select.value;
 select.innerHTML=matches.map(c=>`<option value="${esc(c.id)}">${esc(c.full_name)} · ${esc(phoneForDisplay(c.phone))}</option>`).join('');
 const editing=measurements.find(m=>m.id===editingDraftId);
 if(matches.some(c=>c.id===before))select.value=before;
 else if(editing&&matches.some(c=>c.id===editing.customer_id))select.value=editing.customer_id;
 if(matches.length&&!forceNew){
  existing.classList.remove('hidden');fresh.classList.add('hidden');name.required=false;
  status.textContent=matches.length===1?'Existing customer found — previous measurements available':`${matches.length} customer records match this phone. Choose the correct name.`;
 }else{
  existing.classList.add('hidden');fresh.classList.remove('hidden');name.required=!!phone.value.trim();select.innerHTML='';
  status.textContent=phoneDigits(phone.value).length>=7?'No customer selected — enter a new customer name':'Enter at least 7 digits to search or add a customer';
 }
 if(button)button.textContent=forceNew&&matches.length?'Use existing customer':'Add new customer';
}
function refillLastMeasurements(customerId){
 if(!customerId)return;
 const m=lastMeasurement(customerId);if(!m)return;
 const form=$('measurementForm');if(!form)return;
 // Refill the unified lower section, including legacy Pant thigh measurements.
 for(const [group,items] of Object.entries(measureGroups)){
  for(const name of items){
   const el=form.elements.namedItem('m_'+group+' / '+name);
   if(el)el.value=String(measurementValue(m.values,group,name)??'');
  }
 }
 const keys=['company_name','reviewed_by','ready_body','lehenga_style','bottom_style','fitting_notes','remarks'];
 keys.forEach(k=>{const el=form.elements.namedItem(k);if(el&&m[k]!=null)el.value=String(m[k])});
 for(const key of ['deliver_top','deliver_bottom','deliver_dupatta']){const el=form.elements.namedItem(key);if(el)el.checked=!!m[key]}
 if($('phoneLookupStatus'))$('phoneLookupStatus').textContent='Previous measurement details loaded from '+(m.slip_no||'last visit')+'. Review or change the values before saving.';
}
let barcodeControls=null,barcodeStream=null,barcodeSession=0;
function stopBarcodeScan(){
 ++barcodeSession;
 try{barcodeControls?.stop?.()}catch(_){}
 barcodeControls=null;
 barcodeStream?.getTracks?.().forEach(t=>t.stop());barcodeStream=null;
 const video=$('barcodeVideo');if(video){try{video.pause()}catch(_){}video.srcObject=null;video.classList.add('hidden')}
 $('stopBarcodeScan')?.classList.add('hidden');
}
async function startBarcodeScan(){
 const video=$('barcodeVideo'),target=$('slipBarcode'),msg=$('barcodeScanStatus');if(!video||!target)return;
 stopBarcodeScan();const session=++barcodeSession;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable. Type barcode or use a handheld scanner.');
  video.classList.remove('hidden');$('stopBarcodeScan')?.classList.remove('hidden');
  if(window.BarcodeDetector){
   barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(session!==barcodeSession){barcodeStream?.getTracks().forEach(t=>t.stop());return}
   video.srcObject=barcodeStream;await video.play();
   const scanner=new BarcodeDetector({formats:['code_128','code_39','ean_13','ean_8','upc_a','upc_e','qr_code','itf']});
   if(msg)msg.textContent='Point the camera at the barcode';
   async function detect(){
    if(session!==barcodeSession||!video.isConnected)return;
    try{const found=await scanner.detect(video);if(found?.length&&found[0].rawValue){
      target.value=String(found[0].rawValue).slice(0,120);stopBarcodeScan();if(msg)msg.textContent='Barcode scanned successfully';return;
    }}catch(_){}
    if(session===barcodeSession)requestAnimationFrame(detect);
   }
   detect();
  }else{
   if(msg)msg.textContent='Opening camera scanner…';
   const zxing=await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm');
   if(session!==barcodeSession)return;
   const reader=new zxing.BrowserMultiFormatReader();
   const controls=await reader.decodeFromVideoDevice(undefined,video,(result)=>{if(session!==barcodeSession)return;if(result){target.value=String(result.getText()).slice(0,120);stopBarcodeScan();if(msg)msg.textContent='Barcode scanned successfully'}});if(session!==barcodeSession){controls.stop();return}barcodeControls=controls;
   if(msg&&session===barcodeSession)msg.textContent='Point the camera at the barcode';
  }
 }catch(err){stopBarcodeScan();if(msg)msg.textContent='Camera scanner unavailable: '+(err?.message||err)+'. You can enter or scan the barcode manually.'}
}
function normalizeSlipBarcode(raw){return String(raw||'').trim().toUpperCase().replace(/^\*/,'').replace(/\*$/,'').replace(/[\s-]/g,'')}
let readyCameraControls=null,readyCameraStream=null,readyCameraSession=0,readyBusy=false;
function stopReadyCamera(){
 ++readyCameraSession;
 try{readyCameraControls?.stop?.()}catch(_){}
 readyCameraControls=null;
 readyCameraStream?.getTracks?.().forEach(t=>t.stop());readyCameraStream=null;
 const video=$('readyScanVideo');
 if(video){try{video.pause()}catch(_){}video.srcObject=null;video.classList.add('hidden')}
 $('stopReadyCamera')?.classList.add('hidden');
}
async function markReadyByScannedCode(raw){
 if(readyBusy)return;
 const code=normalizeSlipBarcode(raw);
 if(!/^GL[0-9]{1,16}$/.test(code))throw Error('Scan the unique GL barcode on the tailor slip, for example GL2001');
 readyBusy=true;
 try{
  const {data,error:e}=await sb.rpc('mark_outfit_ready_by_slip',{p_slip_no:code});
  if(e)throw e;
  stopReadyCamera();lastReadyScanResult=data;
  await refresh();
  const scanStatus=$('readyScanStatus');
  if(scanStatus)scanStatus.textContent=(data.already_ready?'Already ready':'Successfully marked READY')+' · '+data.slip_no+' · '+(data.customer_name||'Customer');
  if($('readySlipInput')){$('readySlipInput').value='';$('readySlipInput').focus()}
  notify(data.slip_no+(data.already_ready?' was already ready':' marked READY after barcode scan'));
  return data;
 }finally{readyBusy=false}
}
async function startReadyCamera(){
 const video=$('readyScanVideo'),status=$('readyScanStatus');
 if(!video)return;
 stopReadyCamera();const session=++readyCameraSession;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera unavailable. Type or scan the GL number in the field above.');
  video.classList.remove('hidden');
  $('stopReadyCamera')?.classList.remove('hidden');
  const markResult=async value=>{
   if(session!==readyCameraSession)return;
   const code=normalizeSlipBarcode(value);
   if(!/^GL[0-9]{1,16}$/.test(code)){
    if(status)status.textContent='This barcode is not a GL tailor-slip barcode. Scan the code printed on the tailor slip.';
    return;
   }
   if($('readySlipInput'))$('readySlipInput').value=code;
   stopReadyCamera();
   try{await markReadyByScannedCode(code)}catch(e){error(e);const s=$('readyScanStatus');if(s)s.textContent='Scan failed: '+(e.message||e)}
  };
  let useNative=!!window.BarcodeDetector;
  if(useNative&&typeof BarcodeDetector.getSupportedFormats==='function'){
   const formats=await BarcodeDetector.getSupportedFormats();
   useNative=formats.includes('code_39');
  }
  if(useNative){
   readyCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(session!==readyCameraSession){readyCameraStream?.getTracks?.().forEach(t=>t.stop());return}
   video.srcObject=readyCameraStream;await video.play();
   const detector=new BarcodeDetector({formats:['code_39']});
   if(status)status.textContent='Point your camera at the barcode on the tailor slip';
   async function detect(){
    if(session!==readyCameraSession||!video.isConnected)return;
    try{const found=await detector.detect(video);if(found?.length&&found[0]?.rawValue){await markResult(found[0].rawValue);if(session!==readyCameraSession)return}}
    catch(e){if(status)status.textContent='Camera scanning: '+(e.message||e)}
    if(session===readyCameraSession)requestAnimationFrame(detect);
   }
   detect();
  }else{
   const zxing=await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm');
   if(session!==readyCameraSession)return;
   const reader=new zxing.BrowserMultiFormatReader();
   const controls=await reader.decodeFromVideoDevice(undefined,video,result=>{if(result&&session===readyCameraSession)markResult(result.getText())});
   if(session!==readyCameraSession){controls.stop();return}
   readyCameraControls=controls;
   if(status)status.textContent='Point your camera at the barcode on the tailor slip';
  }
 }catch(e){
  stopReadyCamera();
  if(status)status.textContent='Camera scanner unavailable: '+(e.message||e)+'. Use a handheld barcode scanner or type the GL number.';
 }
}
function bind(){const on=(id,event,fn)=>{const el=$(id);if(el)el.addEventListener(event,fn)};bindSharedActions();bindColoredCalendars();bindPreparationWarnings();
 on('manualImportForm','submit',e=>{submitManualImport(e).catch(error)});
 on('manualEditForm','submit',e=>{submitManualEdit(e).catch(error)});
 on('manualCancelEdit','click',()=>{manualEditingId=null;render()});
 on('manualImportPhone','input',e=>{
  const v=e.target.value,matches=phoneMatches(v),status=$('manualImportPhoneStatus'),name=$('manualImportCustomerName');
  if(status)status.textContent=matches.length===1?'Existing customer: '+matches[0].full_name:
   matches.length>1?'Multiple matching customers — resolve duplicates first':
   phoneDigits(v).length>=7?'New phone: enter customer name':'Existing customers are matched automatically';
  if(name&&matches.length===1&&!name.value)name.value=matches[0].full_name;
 });
 on('manualImportSearch','input',e=>{manualImportSearch=e.target.value;if($('manualImportRows'))$('manualImportRows').innerHTML=manualImportRows()});
 // Delegate to the results container: filtering replaces row nodes without losing actions.
 on('manualImportRows','click',e=>{
  const el=e.target?.closest?.('[data-manual-edit],[data-manual-photo],[data-manual-print]');
  if(!el||!canImportManual())return;
  const id=el.dataset.manualEdit||el.dataset.manualPhoto||el.dataset.manualPrint;
  const m=measurements.find(x=>x.id===id&&x.imported_from_manual);
  if(!m)return notify('Imported slip not found');
  if(el.hasAttribute('data-manual-edit')){
    manualEditingId=m.id;tab='manual_import';render();
    $('manualEditor')?.scrollIntoView({behavior:'smooth',block:'start'});
  }else if(el.hasAttribute('data-manual-photo'))openManualBookletPhoto(m);
  else printSlip(m).catch(error);
 });
 on('dashboardImportManual','click',()=>{if(!canImportManual())return;manualEditingId=null;tab='manual_import';render();window.scrollTo?.({top:0,behavior:'smooth'})});
 on('dashboardNewMeasurement','click',()=>{
  if(!can('measurements'))return notify('Your account cannot create measurement slips');
  if(measurementDirty&&!window.confirm('Unsaved measurements exist. Discard their temporary copy and start a new slip?'))return;
  clearMeasurementRecovery();stopBarcodeScan();stopReadyCamera();
  editingDraftId=null;
  recordedAudio=null;
  tab='measurements';
  render();
  if(typeof window.scrollTo==='function')window.scrollTo({top:0,behavior:'smooth'});
 });
 on('statusSearchForm','submit',e=>{e.preventDefault();statusSearchQuery=String($('statusSearchInput')?.value||'').trim();if($('statusSearchResults'))$('statusSearchResults').innerHTML=statusLookupResults(statusSearchQuery)});
 on('statusSearchInput','input',e=>{statusSearchQuery=e.target.value;if($('statusSearchResults'))$('statusSearchResults').innerHTML=statusLookupResults(statusSearchQuery)});
 on('statusSearchClear','click',()=>{statusSearchQuery='';if($('statusSearchInput')){$('statusSearchInput').value='';$('statusSearchInput').focus()}if($('statusSearchResults'))$('statusSearchResults').innerHTML=statusLookupResults('')});
 // Delegated handler survives a fresh search that replaces result cards.
 on('statusSearchResults','click',e=>{
  const el=e.target?.closest?.('[data-status-photo], [data-status-booklet], [data-status-view], [data-status-print]');
  if(!el)return;
  const id=el.dataset.statusPhoto||el.dataset.statusBooklet||el.dataset.statusView||el.dataset.statusPrint;
  const m=measurements.find(x=>x.id===id);
  if(!m)return notify('Measurement slip not found. Refresh the dashboard and try again.');
  if(el.hasAttribute('data-status-booklet')){
   if(m.manual_booklet_photo_path)openManualBookletPhoto(m);
   else notify('No original booklet photo attached.');
  }else if(el.hasAttribute('data-status-photo')){
   if(m.photo_path)openPrivateMedia(m,'photo');
   else notify('No photo attached to this slip.');
  }else if(el.hasAttribute('data-status-print')){
   if(m.workflow_status==='billed'&&m.bill_no)printSlip(m).catch(error);
   else notify('Printing is available only after billing.');
  }else{
   const dialog=$('statusSlipDialog'),body=$('statusSlipPreview');
   if(!dialog||!body)return;
   body.innerHTML=statusSlipPreviewHtml(m);
   if(typeof dialog.showModal==='function')dialog.showModal();
   else{dialog.setAttribute('open','');dialog.classList.add('status-slip-fallback')}
  }
 });
 on('closeStatusSlipPreview','click',()=>{const dialog=$('statusSlipDialog');if(dialog?.close)dialog.close();else{dialog?.removeAttribute('open');dialog?.classList.remove('status-slip-fallback')}});
 on('statusSlipDialog','click',e=>{if(e.target?.id==='statusSlipDialog'&&e.target?.close)e.target.close()});
 on('openAlerts','click',()=>{tab='alerts';render()});on('openReadyScanner','click',()=>{stopBarcodeScan();tab='scanner';render()});on('readyScannerForm','submit',async e=>{e.preventDefault();try{await markReadyByScannedCode($('readySlipInput')?.value)}catch(err){error(err);if($('readyScanStatus'))$('readyScanStatus').textContent='Scan error: '+(err.message||err)}});on('startReadyCamera','click',startReadyCamera);on('stopReadyCamera','click',stopReadyCamera);on('slipType','change',()=>updateOverrideVisibility('slip'));on('slipDate','change',()=>updateOverrideVisibility('slip'));on('bookingType','change',()=>updateOverrideVisibility('booking'));on('bookingDate','change',()=>updateOverrideVisibility('booking'));on('recordVoice','click',startRecording);
on('slipPhone','input',()=>{if($('forceNewCustomerValue'))$('forceNewCustomerValue').value='false';updatePhoneLookup()});
on('slipPhone','blur',()=>{const matches=phoneMatches($('slipPhone')?.value);if(matches.length===1&&!editingDraftId&&$('forceNewCustomerValue')?.value!=='true')refillLastMeasurements(matches[0].id)});
on('slipCustomerSelect','change',e=>refillLastMeasurements(e.target.value));
on('forceNewCustomer','click',()=>{const input=$('forceNewCustomerValue');if(!input)return;input.value=input.value==='true'?'false':'true';updatePhoneLookup()});
on('startBarcodeScan','click',startBarcodeScan);
on('stopBarcodeScan','click',stopBarcodeScan);
on('cancelDraftEdit','click',()=>{
  if(measurementDirty&&!window.confirm('Discard unsaved measurements and start a new slip?'))return;
  clearMeasurementRecovery();editingDraftId=null;recordedAudio=null;render()
 });
 const measurementForm=$('measurementForm');
 if(measurementForm){
  measurementForm.addEventListener('input',scheduleMeasurementRecovery);
  measurementForm.addEventListener('change',scheduleMeasurementRecovery);
  measurementForm.addEventListener('invalid',e=>{
   const label=e.target?.closest?.('div')?.querySelector?.('label')?.textContent?.trim()||e.target?.name||'required field';
   captureMeasurementRecovery();
   measurementSaveFailure('Please complete '+label);
  },true);
 }
 updatePhoneLookup();restoreMeasurementRecovery();on('stopVoice','click',()=>{if(activeRecorder?.state==='recording')activeRecorder.stop()});updateOverrideVisibility('slip');updateOverrideVisibility('booking');
on('customerForm','submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{const {error:x}=await sb.from('customers').insert({full_name:f.get('full_name'),phone:f.get('phone'),notes:f.get('notes'),created_by:me.id});if(x)throw x;notify('Customer saved');await refresh()}catch(x){error(x)}});
on('searchCustomers','input',e=>{$('customerRows').innerHTML=customerTable(customers.filter(c=>(c.full_name+' '+c.phone).toLowerCase().includes(e.target.value.toLowerCase())))});
on('searchMeasurements','input',e=>{const term=e.target.value.toLowerCase().trim();$('measurementRows').innerHTML=measurementTable(measurements.filter(m=>{const c=customers.find(x=>x.id===m.customer_id);return `${c?.full_name||''} ${c?.phone||''} ${m.fitting_notes||''} ${m.salesperson_name||''} ${m.slip_no||''} ${m.remarks||''} ${m.bill_no||''} ${m.item_name||''} ${m.product_barcode||''} ${customers.find(x=>x.id===m.customer_id)?.phone||''}`.toLowerCase().includes(term)}))});
on('measurementForm','submit',async e=>{
 e.preventDefault();
 captureMeasurementRecovery(); // Save unsaved fields before making any network request.
 if(measurementSaving)return measurementSaveFeedback('Already saving. Please do not submit twice.','info');
 if(activeRecorder?.state==='recording')return measurementSaveFailure('Stop voice recording before saving the draft');
 stopBarcodeScan();
 const f=new FormData(e.target);
 // Keep old non-visible Pant / Plazo fields in a previously saved draft.
 const original=editingDraftId?measurements.find(x=>x.id===editingDraftId)?.values||{}:{};
 const values={...original};
 const leadProblem=preparationLeadTimeMessage(String(f.get('delivery_date')||''),f.get('days_required')||3);
 if(leadProblem)return measurementSaveFailure(leadProblem);
 for(const [group,items] of Object.entries(measureGroups)){
  for(const name of items){
   const key=group+' / '+name,v=String(f.get('m_'+key)||'').trim();
   if(v)values[key]=v;
   else if(group==='Lehenga / Sharara'&&['Length','Waist','Thigh'].includes(name)
     &&Object.prototype.hasOwnProperty.call(original,'Salwar / Pant / Plazo / '+name))
    values[key]=''; // Prevent cleared values reappearing from legacy records.
   else delete values[key];
  }
 }
 const photo=f.get('photo_file');
 const deviceVideo=f.get('video_file'),cameraVideo=f.get('video_camera');
 const videoSelections=[deviceVideo,cameraVideo].filter(file=>file instanceof File&&file.size>0);
 if(videoSelections.length>1)return measurementSaveFailure('Select one video: upload or record');
 const video=videoSelections[0]||null;
 if(photo instanceof File&&photo.size>15728640)return measurementSaveFailure('Photo exceeds 15 MB');
 if(recordedAudio?.size>15728640)return measurementSaveFailure('Voice note exceeds 15 MB');
 if(video?.size>41943040)return measurementSaveFailure('Video exceeds the 40 MB upload limit');
 if(video){
  const supported=['video/mp4','video/quicktime','video/webm','video/x-m4v'];
  const mime=String(video.type||'').toLowerCase().split(';')[0];
  const extension=String(video.name||'').toLowerCase().split('.').pop();
  if(!supported.includes(mime)&&!(mime===''&&['mp4','mov','webm','m4v'].includes(extension)))return measurementSaveFailure('Please choose an MP4, MOV or WebM video');
 }
 const amountText=String(f.get('final_billing_amount')||'').trim();
 if(amountText&&(!/^\d+(?:\.\d{1,2})?$/.test(amountText)||Number(amountText)<=0||Number(amountText)>9999999999.99))
   return measurementSaveFailure('Final billing amount must be positive with up to two decimals');
 const payload={
 customer_phone:f.get('customer_phone'),
 customer_id:f.get('customer_id')||null,
 customer_name:f.get('customer_name')||'',
 force_new_customer:f.get('force_new_customer')==='true',
 salesperson_name:f.get('salesperson_name')||'',
 order_type:f.get('order_type')||'new_make',
 item_name:f.get('item_name')||'',
 product_barcode:f.get('product_barcode')||'',
 design_number:f.get('design_number')||'',
 final_billing_amount:amountText||null,
 company_name:f.get('company_name')||'',
 reviewed_by:f.get('reviewed_by')||'',
 order_date:f.get('order_date')||today,
 delivery_date:f.get('delivery_date')||null,
 days_required:Number(f.get('days_required')||3),
 ready_body:f.get('ready_body')||'body',
 lehenga_style:f.get('lehenga_style')||'',
 bottom_style:f.get('bottom_style')||'',
 deliver_top:f.has('deliver_top'),
 deliver_bottom:f.has('deliver_bottom'),
 deliver_dupatta:f.has('deliver_dupatta'),
 values,remarks:f.get('remarks')||'',fitting_notes:f.get('fitting_notes')||''
 };
 const saveButton=$('saveSlipBtn');
 if(saveButton)saveButton.dataset.originalText=saveButton.textContent;
 measurementSaving=true;
 if(saveButton){saveButton.disabled=true;saveButton.textContent='Saving to GALOIR…'}
 measurementSaveFeedback('Saving your measurement securely…','info');
 try{
  const {data,error:e1}=await sb.rpc('save_measurement_draft',{p_payload:payload,p_measurement_id:editingDraftId||null});
  if(e1)throw e1;
  const warning=[];
  if(photo instanceof File&&photo.size){try{await uploadMedia(data.measurement_id,'photo',photo)}catch(x){warning.push('Photo: '+x.message)}}
  if(recordedAudio?.size){try{await uploadMedia(data.measurement_id,'voice',recordedAudio)}catch(x){warning.push('Voice: '+x.message)}}
  if(video?.size){try{await uploadMedia(data.measurement_id,'video',video)}catch(x){warning.push('Video: '+x.message)}}
  recordedAudio=null;editingDraftId=data.measurement_id;
  clearMeasurementRecovery();
  measurementSaving=false;
  try{await refresh()}
  catch(reloadError){
   console.warn('Slip was saved, but could not reload the list yet:',reloadError);
   if($('slipNoDisplay'))$('slipNoDisplay').textContent=data.slip_no;
  }
  $('slipNoBanner')?.scrollIntoView({behavior:'smooth',block:'start'});
  measurementSaveFeedback('Saved successfully as '+data.slip_no+'.','success');
  notify('Slip '+data.slip_no+' SAVED successfully.'+(warning.length?' Attachment issue: '+warning.join('; '):'')+' Complete billing before printing.');
 }catch(err){
  measurementSaving=false;captureMeasurementRecovery();
  measurementSaveFailure(err?.message||String(err));
  console.error('Measurement save failed:',err);
 }finally{
  measurementSaving=false;
  const currentButton=$('saveSlipBtn');
  if(currentButton){
   currentButton.disabled=false;
   if(currentButton===saveButton&&saveButton?.dataset.originalText)currentButton.textContent=saveButton.dataset.originalText;
  }
 }
});
on('prevMonth','click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);render()});on('nextMonth','click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);render()});document.querySelectorAll('[data-date]').forEach(el=>el.onclick=()=>{selectedDate=el.dataset.date;render()});
const bookingCustomer=$('bookingCustomer'),bookingMeasurement=$('bookingMeasurement');if(bookingCustomer&&bookingMeasurement){const update=()=>{bookingMeasurement.innerHTML='<option value="">None</option>'+measurements.filter(m=>m.customer_id===bookingCustomer.value&&m.order_type===$('bookingType')?.value&&(!m.delivery_date||m.delivery_date===$('bookingDate')?.value)).map(m=>`<option value="${m.id}">${esc(m.slip_no||new Date(m.created_at).toLocaleString())}</option>`).join('')};bookingCustomer.onchange=update;if($('bookingType'))$('bookingType').onchange=()=>{update();updateOverrideVisibility('booking')};if($('bookingDate'))$('bookingDate').onchange=()=>{update();updateOverrideVisibility('booking')};update()}
on('bookingForm','submit',async e=>{e.preventDefault();const f=new FormData(e.target),type=f.get('order_type'),date=f.get('delivery_date');try{if(!date||date<today)throw Error('Select a valid delivery date');const leadProblem=preparationLeadTimeMessage(date,f.get('days_required'));if(leadProblem)throw Error(leadProblem);const override=await getOverrideForBooking(f,type,date);const {error:bookError}=await sb.rpc('book_order_v3',{p_customer_id:f.get('customer_id'),p_measurement_id:f.get('measurement_id')||null,p_item_name:f.get('item_name'),p_delivery_date:date,p_order_type:type,p_notes:f.get('notes'),p_days_required:Number(f.get('days_required')),p_override_token:override});if(bookError)throw bookError;notify('Delivery booked');await refresh()}catch(err){error(err)}});
on('dailyDate','change',e=>{selectedDate=e.target.value;render()});document.querySelectorAll('[data-status]').forEach(el=>el.onchange=async()=>{try{const {error:x}=await sb.rpc('set_order_status',{p_order_id:el.dataset.status,p_status:el.value});if(x)throw x;notify('Status updated');await refresh()}catch(x){error(x)}});
on('waCheckSetup','click',async()=>{try{const c=await whatsappConnectionStatus();notify(c.configured?'WATI connection detected. Ensure both Utility templates are approved.':'WATI token or channel is not configured yet.');render()}catch(e){error(e)}});
on('waToggle','click',async()=>{
 if(role!=='admin')return notify('Only Admin can change WhatsApp automation.');
 try{
  const next=!waEnabled;
  if(next){
   if(!$('waTemplatesApproved')?.checked)throw Error('Confirm that the templates are approved and customer opt-in will be collected.');
   const state=await whatsappConnectionStatus();
   if(!state?.configured)throw Error('Add the WATI API token and WhatsApp sending number securely before enabling.');
  }
  const {error:e}=await sb.rpc('galoir_set_whatsapp_enabled',{p_enabled:next});
  if(e)throw e;
  notify(next?'WhatsApp automation enabled for future opted-in orders':'WhatsApp automation disabled');
  await refresh();
 }catch(e){error(e)}
});
on('capacityForm','submit',async e=>{e.preventDefault();try{const {error:x}=await sb.rpc('set_capacity',{p_capacity:Number(new FormData(e.target).get('capacity'))});if(x)throw x;notify('Capacity updated');await refresh()}catch(x){error(x)}});
on('addSalespersonForm','submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('full_name')||'').trim();if(!name)return notify('Enter salesperson name');try{const {error:x}=await sb.from('salespeople').insert({full_name:name});if(x)throw x;notify('Salesperson added');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-rename-salesperson]').forEach(el=>el.onclick=async()=>{const id=el.dataset.renameSalesperson;const field=document.querySelector(`[data-salesperson-name="${id}"]`);const name=String(field?.value||'').trim();if(!name)return notify('Enter a valid name');try{const {error:x}=await sb.from('salespeople').update({full_name:name}).eq('id',id);if(x)throw x;notify('Salesperson name updated');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-toggle-salesperson]').forEach(el=>el.onclick=async()=>{const id=el.dataset.toggleSalesperson;const current=salespeople.find(x=>x.id===id);if(!current)return;try{const {error:x}=await sb.from('salespeople').update({active:!current.active}).eq('id',id);if(x)throw x;notify(current.active?'Salesperson deactivated':'Salesperson reactivated');await refresh()}catch(x){error(x)}});
on('staffForm','submit',async e=>{e.preventDefault();try{const f=new FormData(e.target);await staffCall({action:'create',user_id:f.get('user_id'),full_name:f.get('full_name'),role:f.get('role')});notify('Staff role saved');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-save-staff]').forEach(el=>el.onclick=async()=>{const id=el.dataset.saveStaff;try{await staffCall({action:'update',id,role:document.querySelector(`[data-role="${id}"]`).value,active:document.querySelector(`[data-active="${id}"]`).checked});notify('Staff updated');await refresh()}catch(x){error(x)}})
}
async function loadUser(){const {data:{user}}=await sb.auth.getUser();if(!user){me=null;role=null;$('login').classList.remove('hidden');$('app').classList.add('hidden');return}const {data:p,error:e}=await sb.from('profiles').select('*').eq('id',user.id).single();if(e||!p?.active){await sb.auth.signOut({scope:'local'});notify('Account is not authorized. Contact your admin.');return loadUser()}me=user;role=p.role;prepareMeasurementRecoveryOnLogin();$('login').classList.add('hidden');$('app').classList.remove('hidden');try{await refresh()}catch(x){error(x)}}
// Phone lock, app switching and the mobile camera can hide the document.
 // Do not refresh an active Measurement form on unlock: replacing its HTML
 // destroys unsaved input, camera selections and any in-progress draft.
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){captureMeasurementRecovery();stopBarcodeScan();stopReadyCamera()}
  else if(me&&tab!=='measurements')refresh().catch(error);
 });
 window.addEventListener('pagehide',()=>captureMeasurementRecovery());
$('loginForm').onsubmit=async e=>{e.preventDefault();if(!sb)return notify('Configure Supabase first');const {error:x}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(x)return error(x);await loadUser()};$('logout').onclick=async()=>{clearMeasurementRecovery();await sb.auth.signOut({scope:'local'});loadUser()};if(!ready){$('setupWarning').textContent='Setup required: configure config.js with your Supabase Project URL and public key before signing in.'}else loadUser();
