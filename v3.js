
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.GALOIR_CONFIG||{};const ready=cfg.supabaseUrl?.startsWith('https://')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.startsWith('REPLACE_');
const sb=ready?createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateStr=d=>{let y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
let today=dateStr(new Date());let me=null,role=null,tab='dashboard',customers=[],measurements=[],orders=[],profiles=[],salespeople=[],capacity=20,lastCreated=null,lastBilledSlipId=null,editingDraftId=null,recordedAudio=null,activeRecorder=null,recordingStream=null,lastReadyScanResult=null,month=new Date(),selectedDate=today;
const allowed={admin:['dashboard','scanner','alerts','customers','measurements','cashier','calendar','daily','tailoring','settings','salespeople','staff','reports'],manager:['dashboard','scanner','alerts','customers','measurements','cashier','calendar','daily','tailoring','settings','reports'],sales:['dashboard','scanner','alerts','customers','measurements','cashier','calendar','daily'],tailoring:['dashboard','scanner','alerts','customers','measurements','daily','tailoring']};
const titles={dashboard:'Dashboard',scanner:'Scan Ready Outfit',alerts:'Reminders',customers:'Customers',measurements:'Measurements',cashier:'Billing Desk',calendar:'Delivery Calendar',daily:'Daily Deliveries',tailoring:'Tailoring Board',settings:'Capacity Settings',salespeople:'Salespeople',staff:'Staff Management',reports:'Reports'};
const can=a=>({admin:['customers','measurements','bookings','daily','tailoring','capacity','reports','staff'],manager:['customers','measurements','bookings','daily','tailoring','capacity','reports'],sales:['customers','measurements','bookings','daily'],tailoring:['daily','tailoring']}[role]||[]).includes(a);
function notify(s){$('notice').textContent=s;$('notice').classList.remove('hidden');setTimeout(()=>$('notice').classList.add('hidden'),4500)}
function error(e){notify('Error: '+(e?.message||e));console.error(e)}
async function query(table,fields='*'){const pageSize=500;let offset=0;const rows=[];while(true){const {data,error:e}=await sb.from(table).select(fields).range(offset,offset+pageSize-1);if(e)throw e;rows.push(...(data||[]));if(!data||data.length<pageSize)break;offset+=pageSize}return rows}
async function refresh(){today=dateStr(new Date());const [a,b,c,d,e]=await Promise.all([query('customers'),query('measurements'),query('orders'),query('settings'),query('salespeople')]);customers=a;measurements=b;orders=c;salespeople=e;capacity=d[0]?.daily_capacity||20;if(role==='admin')profiles=await query('profiles');render()}
function customerName(id){return customers.find(x=>x.id===id)?.full_name||'Customer'}
function countDate(d){return orders.filter(x=>x.delivery_date===d&&x.order_type!=='new_make').length}
function newCount(d){return orders.filter(x=>x.delivery_date===d&&x.order_type==='new_make').length}
function daysUntil(d){return Math.round((Date.parse(d+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000)}
function activeOrders(){return orders.filter(o=>o.status!=='delivered'&&!o.is_ready)}
function supplierAlerts(){return activeOrders().filter(o=>o.order_type==='new_make'&&!o.supplier_notified_at&&daysUntil(o.delivery_date)<=2)}
function alterationAlerts(){return activeOrders().filter(o=>o.order_type!=='new_make'&&daysUntil(o.delivery_date)<=Number(o.days_required??2))}
function outputDate(d){return d?new Date(d+'T12:00:00').toLocaleDateString('en-IN'):'—'}
function render(){if(!role)return;const menu=allowed[role]||[];if(!menu.includes(tab))tab=menu[0]||'daily';$('heading').textContent=titles[tab];$('who').textContent=`${esc(me.email)} · ${role}`;$('nav').innerHTML=menu.map(x=>`<button data-tab="${x}" class="${tab===x?'active':''}">${titles[x]}</button>`).join('');$('nav').querySelectorAll('button').forEach(b=>b.onclick=async()=>{stopBarcodeScan();stopReadyCamera();tab=b.dataset.tab;try{await refresh()}catch(x){error(x)}});const f={dashboard:dashboardView,scanner:readyScannerView,alerts:alertsView,customers:customersView,measurements:measurementsView,cashier:cashierView,calendar:calendarView,daily:dailyView,tailoring:tailoringView,settings:settingsView,salespeople:salespeopleView,staff:staffView,reports:reportsView};$('view').innerHTML=f[tab]();bind()}
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
function deliveriesToday(){return orders.filter(o=>o.delivery_date===today).sort((a,b)=>Number(a.status==='delivered')-Number(b.status==='delivered'))}
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
 `<small class="worklist-date">Delivery ${esc(outputDate(o.delivery_date))} · ${o.is_ready?'Outfit ready':'Outfit not ready'}</small>`;
 return `<article class="worklist-row ${checked?'worklist-checked':''}">
 <div class="worklist-entry">
  <strong>${esc(c?.full_name||customerName(o.customer_id))}</strong>
  <span>${esc(c?.phone||'')} · <b>${esc(m?.slip_no||'No GL slip')}</b></span>
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
function dashboardView(){
 const due=deliveriesToday(),master=masterRoomToday();
 const delivered=due.filter(o=>o.status==='delivered').length;
 const sent=master.filter(o=>o.master_room_sent_at).length;
 const overdueDelivery=orders.filter(o=>o.delivery_date<today&&o.status!=='delivered').length;
 return `<div class="dashboard-summary">
  <div class="card"><div class="muted">Deliver today</div><div class="stat">${due.length-delivered}<small> remaining / ${due.length} total</small></div></div>
  <div class="card"><div class="muted">Send to master room</div><div class="stat">${master.length-sent}<small> pending / ${master.length} today</small></div></div>
  <div class="card"><div class="muted">Overdue deliveries</div><div class="stat">${overdueDelivery}</div></div>
  <div class="card"><div class="muted">Outfits ready</div><div class="stat">${orders.filter(o=>o.is_ready&&o.status!=='delivered').length}</div></div>
 </div>
 <div class="dashboard-two-columns">
  <section class="panel dashboard-worklist"><div class="dashboard-list-heading"><h3>🚚 Deliver Today</h3><span>${delivered} of ${due.length} delivered</span></div>
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
function customerOptions(){return customers.map(c=>`<option value="${c.id}">${esc(c.full_name)} — ${esc(c.phone)}</option>`).join('')}
function customersView(){return `${can("customers") ? `<div class="panel"><h3>Add customer</h3><form id="customerForm"><div class="fields"><div><label>Full name</label><input name="full_name" required maxlength="120"></div><div><label>Phone</label><input name="phone" required maxlength="30"></div><div class="span"><label>Notes</label><textarea name="notes" rows="2"></textarea></div></div><button class="btn">Save Customer</button></form></div>` : ""}<div class="panel"><h3>Customer profiles</h3><input id="searchCustomers"><div id="customerRows">${customerTable(customers)}</div></div>`}
function customerTable(rows){return `<table><tr><th>Name</th><th>Phone</th><th>Measurements</th></tr>${rows.map(c=>`<tr><td>${esc(c.full_name)}</td><td>${esc(c.phone)}</td><td>${measurements.filter(m=>m.customer_id===c.id).length}</td></tr>`).join('')}</table>`}
const measureGroups={"Top / Ready / Body":["Length","Upper Chest","Chest","Waist/Tummy","Hip","Shoulder","Armhole","Sleeves","Front Neck","Back Neck","Ghera","Back Darts","Dart Point","Chak/Slit"],"Lehenga / Sharara":["Length","Waist","Hip/Knee","Flair"],"Salwar / Pant / Plazo":["Length","Poncha","Waist","Hip","Thigh","Calf","Ankle"]};
function measurementGroupDisplayName(group){return group==='Lehenga / Sharara'?'Lehenga / Sharara / Saree':group}
function measurementInputs(group,items){const current=measurements.find(m=>m.id===editingDraftId);return `<div class="panel span"><h3>${esc(measurementGroupDisplayName(group))} — numbers or tailor instructions</h3><div class="fields">${items.map(x=>`<div><label>${esc(x)}</label><input type="text" maxlength="120" name="m_${esc(group+' / '+x)}" value="${initialField(current,group,x)}"></div>`).join('')}</div></div>`}
function makeOptions(){return `<option value="new_make">New Make — no daily limit</option><option value="self_alter">Self Alter — daily limit applies</option>`}
function overrideFields(prefix){return `<div class="panel hidden override-box" id="${prefix}Override"><h3>Self Alter date full — supervisor password required</h3><p class="muted">An Admin or Manager must enter their own login email and password to approve this one extra booking. This approval expires after 3 minutes and cannot be reused.</p><div class="fields"><div><label>Supervisor email</label><input type="email" name="reviewer_email" autocomplete="off"></div><div><label>Supervisor password</label><input type="password" name="reviewer_password" autocomplete="off"></div></div></div>`}
function phoneDigits(v){let d=String(v||'').replace(/\D/g,'');return d.length===12&&d.startsWith('91')?d.slice(2):d}
function phoneMatches(v){const q=phoneDigits(v);return q.length>=7?customers.filter(c=>phoneDigits(c.phone)===q):[]}
function lastMeasurement(customerId){return measurements.filter(m=>m.customer_id===customerId).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]||null}
function initialField(draft,group,name){return esc(draft?.values?.[group+' / '+name]??'')}
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
  <div><label>Customer phone number *</label><input id="slipPhone" type="tel" name="customer_phone" value="${esc(c?.phone||'')}" autocomplete="tel" required maxlength="30"></div>
  <div><label>Customer found</label><div id="phoneLookupStatus" class="muted">Type phone number to search</div><button id="forceNewCustomer" type="button" class="btn alt">Add new customer</button><input type="hidden" name="force_new_customer" id="forceNewCustomerValue" value="false"></div>
  <div class="span hidden" id="existingCustomerBox"><label>Select customer</label><select name="customer_id" id="slipCustomerSelect"></select></div>
  <div class="span" id="newCustomerBox"><label>New customer name</label><input id="slipNewCustomerName" name="customer_name" maxlength="120" value="${esc(c?.full_name||'')}"></div>
  <div><label>Salesperson</label><select name="salesperson_name"><option value="">Select (optional for draft)</option>${salespeople.filter(s=>s.active).map(s=>`<option value="${esc(s.full_name)}" ${selected('salesperson_name',s.full_name)}>${esc(s.full_name)}</option>`).join('')}</select>${!ready?'<p class="muted">Admin can add salespeople later</p>':''}</div>
  <div><label>New Make / Self Alter</label><select name="order_type" id="slipType"><option value="new_make" ${!d||selected('order_type','new_make')?'selected':''}>New Make — unlimited</option><option value="self_alter" ${selected('order_type','self_alter')}>Self Alter — capacity controlled</option></select></div>
  <div><label>Outfit / Article (optional for draft)</label><input name="item_name" maxlength="200" value="${field('item_name')}"></div>
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
 <div class="actions"><button class="btn" id="saveSlipBtn">Save Draft${d?' '+esc(d.slip_no):' — Reserve GL Slip No.'}</button>${d?'<button type="button" class="btn alt" id="cancelDraftEdit">New slip instead</button>':''}</div>
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
  return `<tr><td><strong>${esc(m.slip_no||'—')}</strong><br><span class="pill">${isBilled?'Billed':'Draft'}</span></td><td>${esc(c?.full_name||'Customer')}<br><span class="muted">${esc(c?.phone||'')}</span></td><td>${esc(m.item_name||'Not entered')}<br><span class="muted">Design: ${esc(m.design_number||'—')}</span><br><span class="muted">Barcode: ${esc(m.product_barcode||'—')}</span></td><td>${esc(m.salesperson_name||'—')}</td><td>${esc(outputDate(m.delivery_date))}</td><td>${esc(m.bill_no||'Pending billing')}</td><td>${m.final_billing_amount==null?'—':'₹'+esc(Number(m.final_billing_amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td><td><div class="actions">${isBilled?`<button type="button" class="btn alt" data-print="${esc(m.id)}">Print</button>`:`${can('measurements')?`<button type="button" class="btn alt" data-edit-draft="${esc(m.id)}">Continue draft</button><button type="button" class="btn" data-open-cashier="${esc(m.id)}">Bill</button>`:''}`}
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
 <button type="button" class="btn" data-print="${esc(justBilled.id)}">Print Tailor Slip Now</button>
 </div>`:''}<div class="panel"><h3>Cashier Billing Desk · ${drafts.length} draft slip${drafts.length===1?'':'s'} waiting</h3><p class="muted">Sales can save half-filled slips. The cashier must enter the final billing amount, bill number and remaining delivery details before confirming. The amount is kept for internal records and never appears on the tailor printout. Only billed slips can be printed. This desk works with the common Sales login or Admin login.</p>${drafts.length?drafts.map(m=>{
  const c=customers.find(x=>x.id===m.customer_id),full=m.order_type==='self_alter'&&m.delivery_date&&countDate(m.delivery_date)>=capacity;
  return `<div class="panel"><h3>Slip ${esc(m.slip_no)} — Ready for Billing</h3>
  <div class="fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px;margin-bottom:18px;padding:14px;background:#f4f2ee;border-radius:10px">
   <div><label>Customer Name</label><strong>${esc(c?.full_name||'Unknown customer')}</strong></div>
   <div><label>Phone Number</label><strong>${esc(c?.phone||'—')}</strong></div>
   <div><label>Order Type</label><strong>${m.order_type==='new_make'?'New Make':'Self Alter'}</strong></div>
   <div><label>Design Number</label><strong>${esc(m.design_number||'Not entered')}</strong></div>
  </div>
  <form class="cashierForm" data-slip-id="${esc(m.id)}">
  <p class="muted">Enter the bill number and final amount, then confirm. The Print Tailor Slip button appears immediately afterward.</p>
  <div class="fields">
  <div><label>Bill number *</label><input name="bill_no" maxlength="100" required></div>
  <div><label>Final Billing Amount (₹) *</label><input name="final_billing_amount" type="number" min="0.01" max="9999999999.99" step="0.01" inputmode="decimal" value="${esc(m.final_billing_amount??'')}" required></div>
  <div><label>Outfit / Article *</label><input name="item_name" maxlength="200" value="${esc(m.item_name||'')}" required></div>
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
 }).join(''):'<p>No drafts waiting for billing.</p>'}</div><div class="panel"><h3>Billed Slips · Ready to print</h3>${billed.length?`<table><tr><th>Slip</th><th>Customer / Phone</th><th>Order Type</th><th>Bill No.</th><th>Design No.</th><th>Barcode</th><th>Final Amount (₹)</th><th>Print</th></tr>${billed.map(m=>{const c=customers.find(x=>x.id===m.customer_id);return `<tr><td>${esc(m.slip_no)}</td><td>${esc(c?.full_name||'—')}<br><span class="muted">${esc(c?.phone||'—')}</span></td><td>${m.order_type==='new_make'?'New Make':'Self Alter'}</td><td>${esc(m.bill_no)}</td><td>${esc(m.design_number||'—')}</td><td>${esc(m.product_barcode||'—')}</td><td>${m.final_billing_amount==null?'—':'₹'+esc(Number(m.final_billing_amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td><td><button class="btn" type="button" data-print="${esc(m.id)}">Print Tailor Slip</button></td></tr>`}).join('')}</table>`:'<p class="muted">No billed slips yet.</p>'}</div>`;
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
function settingsView(){return `<div class="panel"><h3>Self Alter daily capacity</h3><p>Current limit: <strong>${capacity} Self Alter outfits per day</strong>. New Make is unlimited. Over-capacity Self Alter bookings require a new Admin/Manager password approval per booking.</p><form id="capacityForm"><label>Self Alter daily limit</label><input name="capacity" type="number" min="1" max="1000" value="${capacity}" required style="max-width:220px"><p><button class="btn">Save capacity</button></p></form></div>`}
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
   const approval=await getOverrideForBooking(f,m.order_type,day);
   const {data,error:billError}=await sb.rpc('finalize_slip_billing_v3',{
    p_measurement_id:id,
    p_bill_no:bill,
    p_item_name:item,
    p_delivery_date:day,
    p_product_barcode:f.get('product_barcode')||null,
    p_design_number:f.get('design_number')||null,
    p_final_billing_amount:finalAmount,
    p_override_token:approval
   });
   if(billError)throw billError;
   lastBilledSlipId=data.measurement_id;
   editingDraftId=null;
   await refresh();
   $('billingSuccess')?.scrollIntoView({behavior:'smooth',block:'start'});
   notify(data.slip_no+' billed successfully — Print Tailor Slip is ready at the top.');
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
    let photoURL='';
    if(m.photo_path){
      const {data}=await sb.storage.from('galoir-measurement-media').createSignedUrl(m.photo_path,300);
      photoURL=data?.signedUrl||'';
    }
    const displayValue=v=>{
      if(v===null||v===undefined)return '';
      const value=String(v).trim();
      return value===''||value==='0'||value==='0.0'||value==='0.00'?'':value;
    };
    const deliver=[m.deliver_top?'Top':null,m.deliver_bottom?'Bottom':null,m.deliver_dupatta?'Dupatta':null].filter(Boolean).join(', ');
    const details=[
      ['Customer',customer?.full_name],['Phone',customer?.phone],['Bill No.',m.bill_no],
      ['Product Barcode',m.product_barcode],['Design Number',m.design_number],
      ['Order Date',outputDate(m.order_date)],['Order Type',m.order_type==='new_make'?'New Make':'Self Alter'],
      ['Outfit',m.item_name],['Company',m.company_name],
      ['Reviewed By',m.reviewed_by],['Size Basis',m.ready_body],
      ['Preparation Days',m.days_required],['CRM Ready',order?.is_ready?'Yes':'No'],['Deliver',deliver]
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
            <strong class="measure-value">${esc(displayValue(m.values?.[title+' / '+name]))}</strong>
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
      #printPage{width:194mm;height:279mm;overflow:hidden;background:#fff;margin:0 auto 22px;box-shadow:0 2px 18px #0002}
      #printSheet{width:194mm;min-height:279mm;height:auto;display:flex;flex-direction:column;gap:6px;padding:0 1mm;
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
      .remarks-area{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:118px;flex-shrink:0}
      .remark-panel{display:flex;flex-direction:column;min-width:0}
      .remark-panel h3{font-size:15px;margin:0 0 5px;font-weight:800}
      .remark-box{flex:1;border:1px solid #aaa;padding:8px;min-height:86px;
        white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;font-weight:650;line-height:1.35}
      .media-line{display:flex;align-items:center;gap:10px;font-size:11px;flex-shrink:0}
      .reference-photo{width:auto;max-width:110px;max-height:72px;object-fit:contain}
      .print-footer{padding-top:4px;border-top:1px solid #bbb;font-size:10px;color:#444;flex-shrink:0}
      /* Compact only when the measured content would otherwise overflow A4. */
      #printSheet.compact-print{gap:3px}
      .compact-print .detail{min-height:24px;padding:3px 2px}
      .compact-print .priority-cell{padding:5px 7px}
      .compact-print .measure-grid{grid-auto-rows:minmax(25px,1fr)}
      .compact-print .measure-cell{min-height:25px;padding:2px 7px}
      .compact-print .measure-section h3{padding:5px 9px}
      .compact-print .remarks-area{min-height:96px}
      .compact-print .remark-box{min-height:68px;padding:6px}
      #printSheet.omit-print-photo .media-line{display:none!important}
      @page{size:A4 portrait;margin:8mm}
      @media print{
        html,body{width:194mm;margin:0!important;padding:0!important;background:#fff!important}
        .print-toolbar{display:none!important}
        #printPage{width:194mm;height:279mm;margin:0;box-shadow:none;overflow:hidden}
        #printSheet{width:194mm;min-height:279mm;height:auto}
        body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      }
    </style></head><body>
    <div class="print-toolbar"><button type="button" id="printNow">Print A4 Tailor Slip</button></div>
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
      <div class="remarks-area">
        <div class="remark-panel"><h3>REMARKS</h3><div class="remark-box">${esc(displayValue(m.remarks))}</div></div>
        <div class="remark-panel"><h3>FITTING INSTRUCTIONS</h3><div class="remark-box">${esc(displayValue(m.fitting_notes))}</div></div>
      </div>
      ${photoURL?`<div class="media-line"><strong>REFERENCE PHOTO</strong>
        <img class="reference-photo" id="refPhoto" src="${esc(photoURL)}" alt="Outfit reference"></div>`:''}
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
      sheet.classList.remove('compact-print','omit-print-photo');
      const usableHeightPx=page?.clientHeight||279/25.4*96;
      const fits=()=>sheet.scrollHeight<=usableHeightPx-4;
      if(!fits())sheet.classList.add('compact-print');
      // A photo is optional on paper. Always keep measurements and remarks legible.
      if(!fits()&&m.photo_path)sheet.classList.add('omit-print-photo');
      const naturalHeight=sheet.scrollHeight;
      const scale=Math.min(1,(usableHeightPx-4)/Math.max(naturalHeight,1));
      sheet.style.transform='scale('+scale+')';
    }
    win.document.getElementById('printNow').onclick=()=>{fitPage();win.focus();win.print()};
    win.addEventListener('beforeprint',fitPage);
    win.document.getElementById('refPhoto')?.addEventListener('load',fitPage);
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
 select.innerHTML=matches.map(c=>`<option value="${esc(c.id)}">${esc(c.full_name)} · ${esc(c.phone)}</option>`).join('');
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
 Object.entries(m.values||{}).forEach(([key,val])=>{const el=form.elements.namedItem('m_'+key);if(el)el.value=String(val??'')});
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
function bind(){const on=(id,event,fn)=>{const el=$(id);if(el)el.addEventListener(event,fn)};bindSharedActions();bindColoredCalendars();bindPreparationWarnings();on('openAlerts','click',()=>{tab='alerts';render()});on('openReadyScanner','click',()=>{stopBarcodeScan();tab='scanner';render()});on('readyScannerForm','submit',async e=>{e.preventDefault();try{await markReadyByScannedCode($('readySlipInput')?.value)}catch(err){error(err);if($('readyScanStatus'))$('readyScanStatus').textContent='Scan error: '+(err.message||err)}});on('startReadyCamera','click',startReadyCamera);on('stopReadyCamera','click',stopReadyCamera);on('slipType','change',()=>updateOverrideVisibility('slip'));on('slipDate','change',()=>updateOverrideVisibility('slip'));on('bookingType','change',()=>updateOverrideVisibility('booking'));on('bookingDate','change',()=>updateOverrideVisibility('booking'));on('recordVoice','click',startRecording);
on('slipPhone','input',()=>{if($('forceNewCustomerValue'))$('forceNewCustomerValue').value='false';updatePhoneLookup()});
on('slipPhone','blur',()=>{const matches=phoneMatches($('slipPhone')?.value);if(matches.length===1&&!editingDraftId&&$('forceNewCustomerValue')?.value!=='true')refillLastMeasurements(matches[0].id)});
on('slipCustomerSelect','change',e=>refillLastMeasurements(e.target.value));
on('forceNewCustomer','click',()=>{const input=$('forceNewCustomerValue');if(!input)return;input.value=input.value==='true'?'false':'true';updatePhoneLookup()});
on('startBarcodeScan','click',startBarcodeScan);
on('stopBarcodeScan','click',stopBarcodeScan);
on('cancelDraftEdit','click',()=>{editingDraftId=null;recordedAudio=null;render()});
updatePhoneLookup();on('stopVoice','click',()=>{if(activeRecorder?.state==='recording')activeRecorder.stop()});updateOverrideVisibility('slip');updateOverrideVisibility('booking');
on('customerForm','submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{const {error:x}=await sb.from('customers').insert({full_name:f.get('full_name'),phone:f.get('phone'),notes:f.get('notes'),created_by:me.id});if(x)throw x;notify('Customer saved');await refresh()}catch(x){error(x)}});
on('searchCustomers','input',e=>{$('customerRows').innerHTML=customerTable(customers.filter(c=>(c.full_name+' '+c.phone).toLowerCase().includes(e.target.value.toLowerCase())))});
on('searchMeasurements','input',e=>{const term=e.target.value.toLowerCase().trim();$('measurementRows').innerHTML=measurementTable(measurements.filter(m=>{const c=customers.find(x=>x.id===m.customer_id);return `${c?.full_name||''} ${c?.phone||''} ${m.fitting_notes||''} ${m.salesperson_name||''} ${m.slip_no||''} ${m.remarks||''} ${m.bill_no||''} ${m.item_name||''} ${m.product_barcode||''} ${customers.find(x=>x.id===m.customer_id)?.phone||''}`.toLowerCase().includes(term)}))});
on('measurementForm','submit',async e=>{
 e.preventDefault();
 if(activeRecorder?.state==='recording')return notify('Stop voice recording before saving the draft');
 stopBarcodeScan();
 const f=new FormData(e.target),values={};
 const leadProblem=preparationLeadTimeMessage(String(f.get('delivery_date')||''),f.get('days_required')||3);
 if(leadProblem)return notify(leadProblem);
 for(const [group,items] of Object.entries(measureGroups)){for(const name of items){const key=group+' / '+name,v=String(f.get('m_'+key)||'').trim();if(v)values[key]=v}}
 const photo=f.get('photo_file');
 const deviceVideo=f.get('video_file'),cameraVideo=f.get('video_camera');
 const videoSelections=[deviceVideo,cameraVideo].filter(file=>file instanceof File&&file.size>0);
 if(videoSelections.length>1)return notify('Select one video: upload or record');
 const video=videoSelections[0]||null;
 if(photo instanceof File&&photo.size>15728640)return notify('Photo exceeds 15 MB');
 if(recordedAudio?.size>15728640)return notify('Voice note exceeds 15 MB');
 if(video?.size>41943040)return notify('Video exceeds the 40 MB upload limit');
 if(video){
  const supported=['video/mp4','video/quicktime','video/webm','video/x-m4v'];
  const mime=String(video.type||'').toLowerCase().split(';')[0];
  const extension=String(video.name||'').toLowerCase().split('.').pop();
  if(!supported.includes(mime)&&!(mime===''&&['mp4','mov','webm','m4v'].includes(extension)))return notify('Please choose an MP4, MOV or WebM video');
 }
 const amountText=String(f.get('final_billing_amount')||'').trim();
 if(amountText&&(!/^\d+(?:\.\d{1,2})?$/.test(amountText)||Number(amountText)<=0||Number(amountText)>9999999999.99))
   return notify('Final billing amount must be a positive amount in rupees with up to two decimals');
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
 const saveButton=$('saveSlipBtn');if(saveButton)saveButton.disabled=true;
 try{
  const {data,error:e1}=await sb.rpc('save_measurement_draft',{p_payload:payload,p_measurement_id:editingDraftId||null});
  if(e1)throw e1;
  const warning=[];
  if(photo instanceof File&&photo.size){try{await uploadMedia(data.measurement_id,'photo',photo)}catch(x){warning.push('Photo: '+x.message)}}
  if(recordedAudio?.size){try{await uploadMedia(data.measurement_id,'voice',recordedAudio)}catch(x){warning.push('Voice: '+x.message)}}
  if(video?.size){try{await uploadMedia(data.measurement_id,'video',video)}catch(x){warning.push('Video: '+x.message)}}
  recordedAudio=null;editingDraftId=data.measurement_id;
  await refresh();
  $('slipNoBanner')?.scrollIntoView({behavior:'smooth',block:'start'});
  notify('Slip '+data.slip_no+' saved. The GL number is displayed above.'+(warning.length?' Attachment issue: '+warning.join('; '):'')+' Complete billing before printing.');
 }catch(err){error(err)}finally{if($('saveSlipBtn'))$('saveSlipBtn').disabled=false}
});
on('prevMonth','click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);render()});on('nextMonth','click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);render()});document.querySelectorAll('[data-date]').forEach(el=>el.onclick=()=>{selectedDate=el.dataset.date;render()});
const bookingCustomer=$('bookingCustomer'),bookingMeasurement=$('bookingMeasurement');if(bookingCustomer&&bookingMeasurement){const update=()=>{bookingMeasurement.innerHTML='<option value="">None</option>'+measurements.filter(m=>m.customer_id===bookingCustomer.value&&m.order_type===$('bookingType')?.value&&(!m.delivery_date||m.delivery_date===$('bookingDate')?.value)).map(m=>`<option value="${m.id}">${esc(m.slip_no||new Date(m.created_at).toLocaleString())}</option>`).join('')};bookingCustomer.onchange=update;if($('bookingType'))$('bookingType').onchange=()=>{update();updateOverrideVisibility('booking')};if($('bookingDate'))$('bookingDate').onchange=()=>{update();updateOverrideVisibility('booking')};update()}
on('bookingForm','submit',async e=>{e.preventDefault();const f=new FormData(e.target),type=f.get('order_type'),date=f.get('delivery_date');try{if(!date||date<today)throw Error('Select a valid delivery date');const leadProblem=preparationLeadTimeMessage(date,f.get('days_required'));if(leadProblem)throw Error(leadProblem);const override=await getOverrideForBooking(f,type,date);const {error:bookError}=await sb.rpc('book_order_v3',{p_customer_id:f.get('customer_id'),p_measurement_id:f.get('measurement_id')||null,p_item_name:f.get('item_name'),p_delivery_date:date,p_order_type:type,p_notes:f.get('notes'),p_days_required:Number(f.get('days_required')),p_override_token:override});if(bookError)throw bookError;notify('Delivery booked');await refresh()}catch(err){error(err)}});
on('dailyDate','change',e=>{selectedDate=e.target.value;render()});document.querySelectorAll('[data-status]').forEach(el=>el.onchange=async()=>{try{const {error:x}=await sb.rpc('set_order_status',{p_order_id:el.dataset.status,p_status:el.value});if(x)throw x;notify('Status updated');await refresh()}catch(x){error(x)}});
on('capacityForm','submit',async e=>{e.preventDefault();try{const {error:x}=await sb.rpc('set_capacity',{p_capacity:Number(new FormData(e.target).get('capacity'))});if(x)throw x;notify('Capacity updated');await refresh()}catch(x){error(x)}});
on('addSalespersonForm','submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('full_name')||'').trim();if(!name)return notify('Enter salesperson name');try{const {error:x}=await sb.from('salespeople').insert({full_name:name});if(x)throw x;notify('Salesperson added');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-rename-salesperson]').forEach(el=>el.onclick=async()=>{const id=el.dataset.renameSalesperson;const field=document.querySelector(`[data-salesperson-name="${id}"]`);const name=String(field?.value||'').trim();if(!name)return notify('Enter a valid name');try{const {error:x}=await sb.from('salespeople').update({full_name:name}).eq('id',id);if(x)throw x;notify('Salesperson name updated');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-toggle-salesperson]').forEach(el=>el.onclick=async()=>{const id=el.dataset.toggleSalesperson;const current=salespeople.find(x=>x.id===id);if(!current)return;try{const {error:x}=await sb.from('salespeople').update({active:!current.active}).eq('id',id);if(x)throw x;notify(current.active?'Salesperson deactivated':'Salesperson reactivated');await refresh()}catch(x){error(x)}});
on('staffForm','submit',async e=>{e.preventDefault();try{const f=new FormData(e.target);await staffCall({action:'create',user_id:f.get('user_id'),full_name:f.get('full_name'),role:f.get('role')});notify('Staff role saved');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-save-staff]').forEach(el=>el.onclick=async()=>{const id=el.dataset.saveStaff;try{await staffCall({action:'update',id,role:document.querySelector(`[data-role="${id}"]`).value,active:document.querySelector(`[data-active="${id}"]`).checked});notify('Staff updated');await refresh()}catch(x){error(x)}})
}
async function loadUser(){const {data:{user}}=await sb.auth.getUser();if(!user){me=null;role=null;$('login').classList.remove('hidden');$('app').classList.add('hidden');return}const {data:p,error:e}=await sb.from('profiles').select('*').eq('id',user.id).single();if(e||!p?.active){await sb.auth.signOut({scope:'local'});notify('Account is not authorized. Contact your admin.');return loadUser()}me=user;role=p.role;$('login').classList.add('hidden');$('app').classList.remove('hidden');try{await refresh()}catch(x){error(x)}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopBarcodeScan();stopReadyCamera()}else if(me)refresh().catch(error)});
$('loginForm').onsubmit=async e=>{e.preventDefault();if(!sb)return notify('Configure Supabase first');const {error:x}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(x)return error(x);await loadUser()};$('logout').onclick=async()=>{await sb.auth.signOut({scope:'local'});loadUser()};if(!ready){$('setupWarning').textContent='Setup required: configure config.js with your Supabase Project URL and public key before signing in.'}else loadUser();
