
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg=window.GALOIR_CONFIG||{};const ready=cfg.supabaseUrl?.startsWith('https://')&&cfg.supabaseAnonKey&&!cfg.supabaseAnonKey.startsWith('REPLACE_');
const sb=ready?createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateStr=d=>{let y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
let today=dateStr(new Date());let me=null,role=null,tab='dashboard',customers=[],measurements=[],orders=[],profiles=[],salespeople=[],capacity=20,lastCreated=null,editingDraftId=null,recordedAudio=null,activeRecorder=null,recordingStream=null,month=new Date(),selectedDate=today;
const allowed={admin:['dashboard','alerts','customers','measurements','cashier','calendar','daily','tailoring','settings','salespeople','staff','reports'],manager:['dashboard','alerts','customers','measurements','cashier','calendar','daily','tailoring','settings','reports'],sales:['dashboard','alerts','customers','measurements','cashier','calendar','daily'],tailoring:['dashboard','alerts','customers','measurements','daily','tailoring']};
const titles={dashboard:'Dashboard',alerts:'Reminders',customers:'Customers',measurements:'Measurements',cashier:'Billing Desk',calendar:'Delivery Calendar',daily:'Daily Deliveries',tailoring:'Tailoring Board',settings:'Capacity Settings',salespeople:'Salespeople',staff:'Staff Management',reports:'Reports'};
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
function render(){if(!role)return;const menu=allowed[role]||[];if(!menu.includes(tab))tab=menu[0]||'daily';$('heading').textContent=titles[tab];$('who').textContent=`${esc(me.email)} · ${role}`;$('nav').innerHTML=menu.map(x=>`<button data-tab="${x}" class="${tab===x?'active':''}">${titles[x]}</button>`).join('');$('nav').querySelectorAll('button').forEach(b=>b.onclick=async()=>{tab=b.dataset.tab;try{await refresh()}catch(x){error(x)}});const f={dashboard:dashboardView,alerts:alertsView,customers:customersView,measurements:measurementsView,cashier:cashierView,calendar:calendarView,daily:dailyView,tailoring:tailoringView,settings:settingsView,salespeople:salespeopleView,staff:staffView,reports:reportsView};$('view').innerHTML=f[tab]();bind()}
function dashboardView(){const due=orders.filter(o=>o.delivery_date===today),pending=orders.filter(o=>o.status!=='delivered');return `<div class="grid">${[['Customers',customers.length],['Today’s deliveries',due.length],['Pending outfits',pending.length],['Self Alter slots today',Math.max(0,capacity-countDate(today))]].map(x=>`<div class="card"><div class="muted">${x[0]}</div><div class="stat">${x[1]}</div></div>`).join('')}</div><div class="panel"><h3>Action reminders</h3><p><strong>${alterationAlerts().length}</strong> alterations to prepare · <strong>${supplierAlerts().length}</strong> New Make supplier follow-ups</p><button class="btn alt" id="openAlerts">Open Reminders</button></div><div class="panel"><h3>Today's delivery schedule</h3>${ordersTable(due)}</div><div class="panel"><h3>Pending tailoring work</h3>${ordersTable(pending.slice(0,20))}</div>`}
function ordersTable(rows){return `<table><thead><tr><th>Customer / Slip</th><th>Outfit / Type</th><th>Delivery</th><th>Status</th><th>CRM Ready</th><th>Supplier Follow-up</th></tr></thead><tbody>${rows.length?rows.map(o=>{const slip=measurements.find(m=>m.id===o.measurement_id)?.slip_no||'—';return `<tr><td>${esc(customerName(o.customer_id))}<br><strong>${esc(slip)}</strong></td><td>${esc(o.item_name)}<br><span class="muted">${o.order_type==='new_make'?'New Make':'Self Alter'}</span></td><td>${esc(outputDate(o.delivery_date))}</td><td><span class="pill">${esc(o.status)}</span></td><td><label><input type="checkbox" data-ready-id="${esc(o.id)}" ${o.is_ready?'checked':''} style="width:auto"> Ready</label></td><td>${o.order_type==='new_make'?`<button type="button" class="btn alt" data-supplier-id="${esc(o.id)}">${o.supplier_notified_at?'✓ Supplier informed':'Mark supplier informed'}</button>`:'—'}</td></tr>`}).join(''):'<tr><td colspan="6">No records</td></tr>'}</tbody></table>`}
function alertsView(){return `<div class="panel"><h3>New Make · Contact supplier 2 days before delivery</h3><p class="muted">These reminders appear from 2 days before delivery until marked Supplier Informed or Ready.</p>${ordersTable(supplierAlerts())}</div><div class="panel"><h3>Self Alter · Put on alteration / prepare</h3><p class="muted">Reminders begin the selected number of preparation days before delivery.</p>${ordersTable(alterationAlerts())}</div>`}
function customerOptions(){return customers.map(c=>`<option value="${c.id}">${esc(c.full_name)} — ${esc(c.phone)}</option>`).join('')}
function customersView(){return `${can("customers") ? `<div class="panel"><h3>Add customer</h3><form id="customerForm"><div class="fields"><div><label>Full name</label><input name="full_name" required maxlength="120"></div><div><label>Phone</label><input name="phone" required maxlength="30"></div><div class="span"><label>Notes</label><textarea name="notes" rows="2"></textarea></div></div><button class="btn">Save Customer</button></form></div>` : ""}<div class="panel"><h3>Customer profiles</h3><input id="searchCustomers" placeholder="Search by name or phone"><div id="customerRows">${customerTable(customers)}</div></div>`}
function customerTable(rows){return `<table><tr><th>Name</th><th>Phone</th><th>Measurements</th></tr>${rows.map(c=>`<tr><td>${esc(c.full_name)}</td><td>${esc(c.phone)}</td><td>${measurements.filter(m=>m.customer_id===c.id).length}</td></tr>`).join('')}</table>`}
const measureGroups={"Top / Ready / Body":["Length","Chest","Upper Chest","Waist/Tummy","Hip","Shoulder","Armhole","Sleeves","Front Neck","Back Neck","Ghera","Back Darts","Dart Point","Chak/Slit"],"Lehenga / Sharara":["Length","Waist","Hip/Knee","Flair"],"Salwar / Pant / Plazo":["Length","Poncha","Waist","Hip","Thigh","Calf","Ankle"]};
function measurementInputs(group,items){const current=measurements.find(m=>m.id===editingDraftId);return `<div class="panel span"><h3>${esc(group)} — numbers or tailor instructions</h3><div class="fields">${items.map(x=>`<div><label>${esc(x)}</label><input type="text" maxlength="120" name="m_${esc(group+' / '+x)}" value="${initialField(current,group,x)}" placeholder="e.g. 33.5 or ½ inch loose"></div>`).join('')}</div></div>`}
function makeOptions(){return `<option value="new_make">New Make — no daily limit</option><option value="self_alter">Self Alter — daily limit applies</option>`}
function overrideFields(prefix){return `<div class="panel hidden override-box" id="${prefix}Override"><h3>Self Alter date full — supervisor password required</h3><p class="muted">An Admin or Manager must enter their own login email and password to approve this one extra booking. This approval expires after 3 minutes and cannot be reused.</p><div class="fields"><div><label>Supervisor email</label><input type="email" name="reviewer_email" autocomplete="off"></div><div><label>Supervisor password</label><input type="password" name="reviewer_password" autocomplete="off"></div></div></div>`}
function phoneDigits(v){let d=String(v||'').replace(/\D/g,'');return d.length===12&&d.startsWith('91')?d.slice(2):d}
function phoneMatches(v){const q=phoneDigits(v);return q.length>=7?customers.filter(c=>phoneDigits(c.phone)===q):[]}
function lastMeasurement(customerId){return measurements.filter(m=>m.customer_id===customerId).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]||null}
function initialField(draft,group,name){return esc(draft?.values?.[group+' / '+name]??'')}
function customerNamePhone(draft){return customers.find(c=>c.id===draft?.customer_id)||null}
function measurementsView(){
 const d=measurements.find(m=>m.id===editingDraftId&&m.workflow_status==='draft')||null;
 const c=customerNamePhone(d);
 const field=(key)=>esc(d?.[key]??'');
 const selected=(key,val)=>d?.[key]===val?'selected':'';
 const checked=(key)=>d?.[key]?'checked':'';
 const ready=salespeople.some(s=>s.active);
 return `${can('measurements')?`<div class="panel">
 <h3>${d?'Continue draft '+esc(d.slip_no):'New GALOIR Measurement Slip'}</h3>
 <p class="muted">Find by phone to reuse customer details and last measurements, or add a new customer. Save at any point. <strong>Drafts do not reserve a delivery slot</strong> until the cashier enters a bill number and confirms booking.</p>
 <form id="measurementForm"><div class="fields">
  <div><label>Customer phone number *</label><input id="slipPhone" type="tel" name="customer_phone" value="${esc(c?.phone||'')}" placeholder="Enter phone to look up customer" autocomplete="tel" required maxlength="30"></div>
  <div><label>Customer found</label><div id="phoneLookupStatus" class="muted">Type phone number to search</div><button id="forceNewCustomer" type="button" class="btn alt">Add new customer</button><input type="hidden" name="force_new_customer" id="forceNewCustomerValue" value="false"></div>
  <div class="span hidden" id="existingCustomerBox"><label>Select customer</label><select name="customer_id" id="slipCustomerSelect"></select></div>
  <div class="span" id="newCustomerBox"><label>New customer name</label><input id="slipNewCustomerName" name="customer_name" maxlength="120" value="${esc(c?.full_name||'')}" placeholder="Customer full name"></div>
  <div><label>Salesperson</label><select name="salesperson_name"><option value="">Select (optional for draft)</option>${salespeople.filter(s=>s.active).map(s=>`<option value="${esc(s.full_name)}" ${selected('salesperson_name',s.full_name)}>${esc(s.full_name)}</option>`).join('')}</select>${!ready?'<p class="muted">Admin can add salespeople later</p>':''}</div>
  <div><label>New Make / Self Alter</label><select name="order_type" id="slipType"><option value="new_make" ${!d||selected('order_type','new_make')?'selected':''}>New Make — unlimited</option><option value="self_alter" ${selected('order_type','self_alter')}>Self Alter — capacity controlled</option></select></div>
  <div><label>Outfit / Article (optional for draft)</label><input name="item_name" maxlength="200" value="${field('item_name')}" placeholder="e.g. Silk suit"></div>
  <div><label>Product barcode</label><input id="slipBarcode" type="text" name="product_barcode" maxlength="120" value="${field('product_barcode')}" placeholder="Scan or type product barcode"><div class="actions"><button class="btn alt" type="button" id="startBarcodeScan">Scan with camera</button><button class="btn alt hidden" type="button" id="stopBarcodeScan">Stop</button></div><video id="barcodeVideo" autoplay playsinline muted class="hidden" style="width:100%;max-height:220px;object-fit:cover;border-radius:9px"></video><p id="barcodeScanStatus" class="muted">Supports handheld barcode scanners and camera where available.</p></div>
  <div><label>Company name</label><input name="company_name" value="${field('company_name')}" maxlength="120"></div>
  <div><label>Reviewed by</label><input name="reviewed_by" value="${field('reviewed_by')}" maxlength="120"></div>
  <div><label>Order date</label><input type="date" name="order_date" value="${d?.order_date||today}"></div>
  <div><label>Delivery date (optional for draft)</label><input type="date" name="delivery_date" id="slipDate" min="${today}" value="${d?.delivery_date||''}"></div>
  <div><label>Preparation days</label><input name="days_required" type="number" min="0" max="60" value="${d?.days_required??3}"></div>
  <div><label>Measurements based on</label><select name="ready_body"><option value="body" ${!d||selected('ready_body','body')?'selected':''}>Body</option><option value="ready" ${selected('ready_body','ready')}>Ready</option></select></div>
  <div><label>Lehenga / Sharara</label><select name="lehenga_style"><option value="">Not applicable</option><option value="lehenga" ${selected('lehenga_style','lehenga')}>Lehenga</option><option value="sharara" ${selected('lehenga_style','sharara')}>Sharara</option></select></div>
  <div><label>Bottom type</label><select name="bottom_style"><option value="">Not applicable</option><option value="salwar" ${selected('bottom_style','salwar')}>Salwar</option><option value="pant" ${selected('bottom_style','pant')}>Pant</option><option value="plazo" ${selected('bottom_style','plazo')}>Plazo</option></select></div>
  <div class="span"><label>Items to deliver</label><div class="actions"><label><input type="checkbox" name="deliver_top" style="width:auto" ${checked('deliver_top')}> Top</label><label><input type="checkbox" name="deliver_bottom" style="width:auto" ${checked('deliver_bottom')}> Bottom</label><label><input type="checkbox" name="deliver_dupatta" style="width:auto" ${checked('deliver_dupatta')}> Dupatta</label></div></div>
  ${Object.entries(measureGroups).map(([name,items])=>measurementInputs(name,items)).join('')}
  <div class="span"><label>Remarks / Alteration details</label><textarea name="remarks" rows="4" placeholder="½ inch loose, marking hai, colour details, etc.">${field('remarks')}</textarea></div>
  <div class="span"><label>Fitting instructions</label><textarea name="fitting_notes" rows="2">${field('fitting_notes')}</textarea></div>
  <div><label>Take photo / upload image</label><input type="file" name="photo_file" accept="image/*" capture="environment"><p class="muted">Optional private image, up to 15 MB</p></div>
  <div><label>Voice remarks</label><div class="actions"><button type="button" class="btn alt" id="recordVoice">● Record</button><button type="button" class="btn alt" id="stopVoice" disabled>Stop</button></div><p id="voiceStatus" class="muted">No new voice note recorded</p></div>
 </div>
 <div class="actions"><button class="btn" id="saveSlipBtn">Save Draft${d?' '+esc(d.slip_no):' — Reserve GL Slip No.'}</button>${d?'<button type="button" class="btn alt" id="cancelDraftEdit">New slip instead</button>':''}</div>
 <p class="muted">Bill number and delivery confirmation are entered in Billing Desk. Printing is enabled after billing.</p>
 </form></div>`:''}
 <div class="panel"><h3>Measurement History</h3><input id="searchMeasurements" placeholder="Search GL slip, phone, customer, salesperson or barcode"><div id="measurementRows">${measurementTable(measurements)}</div></div>`;
}
function measurementTable(rows){
 const list=rows.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,200);
 return `<p class="muted">${list.length} slips shown${rows.length>200?' (search to find older records)':''}</p><table><tr><th>Slip / Stage</th><th>Customer / Phone</th><th>Outfit / Barcode</th><th>Salesperson</th><th>Delivery</th><th>Bill</th><th>Actions</th></tr>${list.map(m=>{
  const c=customers.find(x=>x.id===m.customer_id);
  const isBilled=m.workflow_status==='billed'&&Boolean(m.bill_no);
  return `<tr><td><strong>${esc(m.slip_no||'—')}</strong><br><span class="pill">${isBilled?'Billed':'Draft'}</span></td><td>${esc(c?.full_name||'Customer')}<br><span class="muted">${esc(c?.phone||'')}</span></td><td>${esc(m.item_name||'Not entered')}<br><span class="muted">${esc(m.product_barcode||'No barcode')}</span></td><td>${esc(m.salesperson_name||'—')}</td><td>${esc(outputDate(m.delivery_date))}</td><td>${esc(m.bill_no||'Pending billing')}</td><td><div class="actions">${isBilled?`<button type="button" class="btn alt" data-print="${esc(m.id)}">Print</button>`:`${can('measurements')?`<button type="button" class="btn alt" data-edit-draft="${esc(m.id)}">Continue draft</button><button type="button" class="btn" data-open-cashier="${esc(m.id)}">Bill</button>`:''}`}
  ${m.photo_path?`<button type="button" class="btn alt" data-media="${esc(m.id)}" data-kind="photo">Photo</button>`:''}${m.voice_path?`<button type="button" class="btn alt" data-media="${esc(m.id)}" data-kind="voice">Voice</button>`:''}</div><details><summary>Measurements</summary><pre>${esc(JSON.stringify(m.values,null,2))}</pre><p class="muted">${esc(m.remarks||'')}</p></details></td></tr>`;
 }).join('')}</table>`;
}
function cashierView(){
 const drafts=measurements.filter(m=>m.workflow_status==='draft').sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const billed=measurements.filter(m=>m.workflow_status==='billed'&&m.bill_no).sort((a,b)=>b.billed_at?.localeCompare(a.billed_at||'')||0).slice(0,60);
 return `<div class="panel"><h3>Cashier Billing Desk · ${drafts.length} draft slip${drafts.length===1?'':'s'} waiting</h3><p class="muted">Sales can save half-filled slips. Cashier enters bill number, completes missing outfit/delivery details and confirms the booking. Only billed slips can be printed. This desk works with the common Sales login or Admin login.</p>${drafts.length?drafts.map(m=>{
  const c=customers.find(x=>x.id===m.customer_id),full=m.order_type==='self_alter'&&m.delivery_date&&countDate(m.delivery_date)>=capacity;
  return `<div class="panel"><div class="top"><h3>${esc(m.slip_no)} · ${esc(c?.full_name||'Customer')} · ${esc(c?.phone||'')}</h3><span class="pill">${m.order_type==='new_make'?'New Make':'Self Alter'}</span></div>
  <form class="cashierForm" data-slip-id="${esc(m.id)}"><div class="fields">
  <div><label>Bill number *</label><input name="bill_no" maxlength="100" required placeholder="Enter bill no. after payment"></div>
  <div><label>Outfit / Article *</label><input name="item_name" maxlength="200" value="${esc(m.item_name||'')}" required></div>
  <div><label>Delivery date *</label><input class="cashierDate" name="delivery_date" type="date" min="${today}" value="${esc(m.delivery_date||'')}" required></div>
  <div><label>Product barcode</label><input name="product_barcode" maxlength="120" value="${esc(m.product_barcode||'')}" placeholder="Scan or type product barcode"></div>
  </div><p class="muted">Self Alter slots: ${m.delivery_date?countDate(m.delivery_date):'—'}/${capacity}. New Make is unlimited. Dates are booked on this confirmation.</p>
  <div class="panel cashierOverride ${full?'':'hidden'}"><h3>Full-date authorization</h3><p class="muted">Enter the Admin or Manager email and password for one extra Self Alter booking.</p><div class="fields"><div><label>Supervisor email</label><input name="reviewer_email" type="email" autocomplete="off"></div><div><label>Supervisor password</label><input name="reviewer_password" type="password" autocomplete="off"></div></div></div>
  <button type="submit" class="btn">Confirm Billing & Book Delivery</button><button type="button" class="btn alt" data-edit-draft="${esc(m.id)}">Complete measurements first</button>
  </form></div>`;
 }).join(''):'<p>No drafts waiting for billing.</p>'}</div><div class="panel"><h3>Billed Slips · Ready to print</h3>${billed.length?`<table><tr><th>Slip</th><th>Customer</th><th>Bill No.</th><th>Barcode</th><th>Print</th></tr>${billed.map(m=>`<tr><td>${esc(m.slip_no)}</td><td>${esc(customerName(m.customer_id))}</td><td>${esc(m.bill_no)}</td><td>${esc(m.product_barcode||'—')}</td><td><button class="btn" type="button" data-print="${esc(m.id)}">Print Tailor Slip</button></td></tr>`).join('')}</table>`:'<p class="muted">No billed slips yet.</p>'}</div>`;
}
function calendarView(){const year=month.getFullYear(),mo=month.getMonth(),first=new Date(year,mo,1).getDay(),days=new Date(year,mo+1,0).getDate();let cells=Array(first).fill('<div></div>');for(let n=1;n<=days;n++){const d=dateStr(new Date(year,mo,n)),cnt=countDate(d);cells.push(`<button class="day ${cnt>=capacity?'full':''} ${selectedDate===d?'selected':''}" data-date="${d}"><strong>${n}</strong><small>${Math.max(0,capacity-cnt)} / ${capacity} Alter slots</small><small>${newCount(d)} New Make</small></button>`)}return `<div class="panel"><div class="top"><h3>${month.toLocaleString('en-IN',{month:'long',year:'numeric'})}</h3><div class="actions"><button class="btn alt" id="prevMonth">Previous</button><button class="btn alt" id="nextMonth">Next</button></div></div><div class="calendar">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x=>`<div class="muted right">${x}</div>`).join('')}${cells.join('')}</div></div><div class="panel"><h3>Book delivery — ${esc(selectedDate)}</h3><p class="muted">${countDate(selectedDate)} of ${capacity} Self Alter slots used · ${newCount(selectedDate)} New Make bookings (unlimited).</p>${can('bookings')?`<form id="bookingForm"><div class="fields">
<div><label>Customer</label><select name="customer_id" id="bookingCustomer" required>${customerOptions()}</select></div>
<div><label>Outfit</label><input name="item_name" required maxlength="200"></div>
<div><label>Order type</label><select name="order_type" id="bookingType">${makeOptions()}</select></div>
<div><label>Delivery date</label><input type="date" name="delivery_date" id="bookingDate" min="${today}" value="${selectedDate}" required></div>
<div><label>Measurement slip (optional)</label><select name="measurement_id" id="bookingMeasurement"><option value="">None</option></select></div>
<div><label>Preparation days</label><input name="days_required" type="number" min="0" max="60" value="3" required></div>
<div class="span"><label>Booking notes</label><textarea name="notes"></textarea></div>
</div>${overrideFields('booking')}<button class="btn" ${!customers.length||selectedDate<today?'disabled':''}>Book delivery</button></form>`:'<p>Read-only calendar.</p>'}</div><div class="panel"><h3>Scheduled outfits</h3>${ordersTable(orders.filter(o=>o.delivery_date===selectedDate))}</div>`}
function dailyView(){return `<div class="panel"><h3>Daily delivery list</h3><div class="actions"><label>Choose date <input id="dailyDate" type="date" value="${selectedDate}"></label></div>${ordersTable(orders.filter(o=>o.delivery_date===selectedDate))}</div><div class="panel"><h3>Overdue and pending work</h3>${ordersTable(orders.filter(o=>o.delivery_date<today&&o.status!=='delivered'))}</div>`}
function tailoringView(){const statuses=['pending','stitching','trial','alteration','ready','delivered'];return `<div class="panel"><h3>Update tailoring progress</h3><table><tr><th>Customer</th><th>Outfit</th><th>Due</th><th>Status</th></tr>${orders.filter(o=>o.status!=='delivered').map(o=>`<tr><td>${esc(customerName(o.customer_id))}</td><td>${esc(o.item_name)}</td><td>${esc(o.delivery_date)}</td><td><select data-status="${o.id}">${statuses.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</table></div>`}
function settingsView(){return `<div class="panel"><h3>Self Alter daily capacity</h3><p>Current limit: <strong>${capacity} Self Alter outfits per day</strong>. New Make is unlimited. Over-capacity Self Alter bookings require a new Admin/Manager password approval per booking.</p><form id="capacityForm"><label>Self Alter daily limit</label><input name="capacity" type="number" min="1" max="1000" value="${capacity}" required style="max-width:220px"><p><button class="btn">Save capacity</button></p></form></div>`}
function salespersonOptions(){return salespeople.filter(s=>s.active).slice().sort((a,b)=>a.full_name.localeCompare(b.full_name)).map(s=>`<option value="${esc(s.full_name)}">${esc(s.full_name)}</option>`).join('')}
function salespeopleView(){const rows=salespeople.slice().sort((a,b)=>a.full_name.localeCompare(b.full_name));return `<div class="panel"><h3>Salespeople</h3><p class="muted">Salespeople do not need separate logins. Staff can use the common Sales account and select their own name when taking measurements.</p><form id="addSalespersonForm"><div class="fields"><div><label>Add salesperson name</label><input name="full_name" maxlength="100" required placeholder="Enter employee name"></div></div><button class="btn">Add Salesperson</button></form></div><div class="panel"><h3>Manage salesperson names</h3><table><tr><th>Name</th><th>Active</th><th>Actions</th></tr>${rows.map(s=>`<tr><td><input data-salesperson-name="${esc(s.id)}" value="${esc(s.full_name)}" maxlength="100" aria-label="Salesperson name"></td><td>${s.active?'Active':'Inactive'}</td><td><button type="button" class="btn alt" data-rename-salesperson="${esc(s.id)}">Rename</button> <button type="button" class="btn alt" data-toggle-salesperson="${esc(s.id)}">${s.active?'Deactivate':'Reactivate'}</button></td></tr>`).join('')||'<tr><td colspan="3">No salespeople yet. Add the first name above.</td></tr>'}</table><p class="muted">Deactivating a salesperson hides their name from new forms; past measurement records retain their original name.</p></div>`}
function staffView(){return `<div class="panel"><h3>Manage existing Supabase users</h3><p class="muted">For one common Sales login, create a Supabase Authentication user, then copy its User UID and assign the Sales role here. Manage employees' individual names separately under Salespeople.</p><form id="staffForm"><div class="fields"><div><label>Full name</label><input name="full_name" required></div><div><label>Supabase Auth User UID</label><input name="user_id" required placeholder="UID from Authentication → Users"></div><div><label>Role</label><select name="role"><option value="sales">Sales</option><option value="tailoring">Tailoring</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div></div><button class="btn">Save Staff Role</button></form></div><div class="panel"><h3>Staff access</h3><table><tr><th>Name / Email</th><th>Role</th><th>Active</th><th>Action</th></tr>${profiles.map(p=>`<tr><td>${esc(p.full_name)}<br><span class="muted">${esc(p.email)}</span></td><td><select data-role="${p.id}">${['sales','tailoring','manager','admin'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join('')}</select></td><td><input type="checkbox" data-active="${p.id}" ${p.active?'checked':''} style="width:auto"></td><td><button class="btn alt" data-save-staff="${p.id}">Save</button></td></tr>`).join('')}</table></div>`}
function reportsView(){return `<div class="grid">${[['Total customers',customers.length],['Total orders',orders.length],['Delivered',orders.filter(o=>o.status==='delivered').length],['Open',orders.filter(o=>o.status!=='delivered').length]].map(x=>`<div class="card"><div class="muted">${x[0]}</div><div class="stat">${x[1]}</div></div>`).join('')}</div>`}
async function staffCall(payload){const p=payload.action==='update'?profiles.find(x=>x.id===payload.id):null;const {error:e}=await sb.rpc('admin_set_staff',{p_user_id:payload.action==='update'?payload.id:payload.user_id,p_role:payload.role,p_full_name:p?p.full_name:payload.full_name,p_active:payload.action==='update'?payload.active:true});if(e)throw e;return {ok:true}}
function bindSharedActions(){document.querySelectorAll('[data-ready-id]').forEach(el=>el.onchange=async()=>{const checked=el.checked;try{const {error:e}=await sb.rpc('set_order_ready',{p_order_id:el.dataset.readyId,p_ready:checked});if(e)throw e;notify(checked?'Outfit marked READY':'Outfit marked NOT READY');await refresh()}catch(x){el.checked=!checked;error(x)}});document.querySelectorAll('[data-supplier-id]').forEach(el=>el.onclick=async()=>{const o=orders.find(x=>x.id===el.dataset.supplierId);try{const {error:e}=await sb.rpc('set_supplier_informed',{p_order_id:el.dataset.supplierId,p_informed:!o?.supplier_notified_at});if(e)throw e;notify(o?.supplier_notified_at?'Supplier follow-up reopened':'Supplier informed');await refresh()}catch(x){error(x)}});document.querySelectorAll('[data-print]').forEach(el=>el.onclick=()=>{const m=measurements.find(x=>x.id===el.dataset.print);if(m)printSlip(m).catch(error)});document.querySelectorAll('[data-media]').forEach(el=>el.onclick=()=>{const m=measurements.find(x=>x.id===el.dataset.media);if(m)openPrivateMedia(m,el.dataset.kind)});}
function updateOverrideVisibility(prefix){const type=$(prefix==='slip'?'slipType':'bookingType')?.value,date=$(prefix==='slip'?'slipDate':'bookingDate')?.value,panel=$(prefix+'Override');if(panel)panel.classList.toggle('hidden',!(type==='self_alter'&&date&&countDate(date)>=capacity))}
async function getOverrideForBooking(formData,type,date){if(type!=='self_alter'||countDate(date)<capacity)return null;const email=String(formData.get('reviewer_email')||'').trim(),password=String(formData.get('reviewer_password')||'');if(!email||!password)throw Error('Self Alter date is full — Admin/Manager login email and password required');const reviewer=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'galoir-one-time-supervisor'}});try{const {error:e}=await reviewer.auth.signInWithPassword({email,password});if(e)throw Error('Supervisor password incorrect or account unavailable');const {data,error:issueError}=await reviewer.rpc('issue_booking_override',{p_delivery_date:date});if(issueError)throw Error('Only an active Admin or Manager can authorize: '+issueError.message);return data}finally{try{await reviewer.auth.signOut({scope:'local'})}catch(_){}}}
async function uploadMedia(id,kind,file){const mime=String(file.type||'').split(';')[0].toLowerCase();const supported={photo:{'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'},voice:{'audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav','audio/x-m4a':'m4a','video/mp4':'mp4'}};const ext=supported[kind]?.[mime];if(!ext)throw Error('Unsupported '+kind+' format '+mime);if(file.size>15728640)throw Error('Maximum file size is 15 MB');const path=id+'/'+kind+'-'+crypto.randomUUID()+'.'+ext;const {error:upError}=await sb.storage.from('galoir-measurement-media').upload(path,file,{contentType:mime,upsert:false});if(upError)throw upError;const {error:attachError}=await sb.rpc('attach_measurement_media',{p_measurement_id:id,p_kind:kind,p_path:path});if(attachError)throw attachError;return path}
async function openPrivateMedia(m,kind){const path=kind==='photo'?m.photo_path:m.voice_path;if(!path)return notify('No attachment found');const win=window.open('about:blank','_blank');try{const {data,error:e}=await sb.storage.from('galoir-measurement-media').createSignedUrl(path,300);if(e)throw e;if(win)win.location.href=data.signedUrl;else notify('Enable pop-ups to open media')}catch(err){if(win)win.close();error(err)}}
async function printSlip(m){if(m.workflow_status!=='billed'||!m.bill_no)return notify('Complete billing before printing this slip');const win=window.open('','_blank');if(!win)return notify('Please allow pop-ups to print the slip');try{const c=customers.find(x=>x.id===m.customer_id),o=orders.find(x=>x.measurement_id===m.id);let photoURL='';if(m.photo_path){const {data}=await sb.storage.from('galoir-measurement-media').createSignedUrl(m.photo_path,300);photoURL=data?.signedUrl||''}const block=(title,items)=>`<section><h3>${esc(title)} (inches)</h3><div class="print-grid">${items.map(name=>`<div><span>${esc(name)}</span><strong>${esc(m.values?.[title+' / '+name]??'—')}</strong></div>`).join('')}</div></section>`;const fields=[['Customer',c?.full_name],['Contact',c?.phone],['Bill No.',m.bill_no],['Product Barcode',m.product_barcode],['Company',m.company_name],['Order Date',outputDate(m.order_date)],['Delivery Date',outputDate(m.delivery_date)],['Type',m.order_type==='new_make'?'New Make':'Self Alter'],['Outfit',m.item_name],['Salesperson',m.salesperson_name],['Reviewed By',m.reviewed_by],['READY / BODY',m.ready_body],['Lehenga / Sharara',m.lehenga_style],['Bottom style',m.bottom_style],['Preparation days',m.days_required],['CRM Ready',o?.is_ready?'Yes':'No'],['Top / Bottom / Dupatta',[m.deliver_top?'Top':null,m.deliver_bottom?'Bottom':null,m.deliver_dupatta?'Dupatta':null].filter(Boolean).join(', ')||'—']];const doc=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.slip_no||'GALOIR Slip')}</title><style>body{font:12px Arial,sans-serif;color:#171717;max-width:740px;margin:15px auto}h1{font-size:32px;margin:0}h2{font-size:18px;margin:3px 0 10px}h3{background:#eee;padding:7px;margin:12px 0 6px}.print-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.print-grid>div{border-bottom:1px dotted #aaa;padding:7px;display:flex;justify-content:space-between;gap:12px}.print-grid span{color:#555}.remark{white-space:pre-wrap;border:1px solid #bbb;min-height:42px;padding:9px}.photo{max-height:150px;max-width:200px;object-fit:contain}.title{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:10px}footer{margin-top:16px;color:#555;font-size:10px}@page{size:A4;margin:12mm}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print slip</button><div class="title"><div><h1>GALOIR</h1><div>J-79, Rajouri Garden Main Market, New Delhi-110027</div></div><div style="text-align:right"><h2>TAILOR ORDER SLIP</h2><strong style="font-size:20px">${esc(m.slip_no||'—')}</strong></div></div><div class="print-grid">${fields.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v??'—')}</strong></div>`).join('')}</div>${Object.entries(measureGroups).map(([title,items])=>block(title,items)).join('')}<h3>Remarks</h3><div class="remark">${esc(m.remarks||'—')}</div><h3>Fitting instructions</h3><div class="remark">${esc(m.fitting_notes||'—')}</div>${photoURL?`<h3>Reference photo</h3><img class="photo" src="${esc(photoURL)}">`:''}<footer>Voice note ${m.voice_path?'attached digitally':'not attached'} · GALOIR Measurement Studio</footer></body></html>`;win.document.open();win.document.write(doc);win.document.close();win.focus()}catch(err){win.close();error(err)}}
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
   barcodeControls=await reader.decodeFromVideoDevice(undefined,video,(result)=>{if(session!==barcodeSession)return;if(result){target.value=String(result.getText()).slice(0,120);stopBarcodeScan();if(msg)msg.textContent='Barcode scanned successfully'}});
   if(msg&&session===barcodeSession)msg.textContent='Point the camera at the barcode';
  }
 }catch(err){stopBarcodeScan();if(msg)msg.textContent='Camera scanner unavailable: '+(err?.message||err)+'. You can enter or scan the barcode manually.'}
}
function bind(){const on=(id,event,fn)=>{const el=$(id);if(el)el.addEventListener(event,fn)};bindSharedActions();on('openAlerts','click',()=>{tab='alerts';render()});on('slipType','change',()=>updateOverrideVisibility('slip'));on('slipDate','change',()=>updateOverrideVisibility('slip'));on('bookingType','change',()=>updateOverrideVisibility('booking'));on('bookingDate','change',()=>updateOverrideVisibility('booking'));on('recordVoice','click',startRecording);
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
 for(const [group,items] of Object.entries(measureGroups)){for(const name of items){const key=group+' / '+name,v=String(f.get('m_'+key)||'').trim();if(v)values[key]=v}}
 const photo=f.get('photo_file');
 if(photo instanceof File&&photo.size>15728640)return notify('Photo exceeds 15 MB');
 if(recordedAudio?.size>15728640)return notify('Voice note exceeds 15 MB');
 const payload={
 customer_phone:f.get('customer_phone'),
 customer_id:f.get('customer_id')||null,
 customer_name:f.get('customer_name')||'',
 force_new_customer:f.get('force_new_customer')==='true',
 salesperson_name:f.get('salesperson_name')||'',
 order_type:f.get('order_type')||'new_make',
 item_name:f.get('item_name')||'',
 product_barcode:f.get('product_barcode')||'',
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
  recordedAudio=null;editingDraftId=null;
  notify('Draft '+data.slip_no+' saved'+(warning.length?'; attachment issue: '+warning.join('; '):'')+'. Complete billing before printing.');
  await refresh();
 }catch(err){error(err)}finally{if($('saveSlipBtn'))$('saveSlipBtn').disabled=false}
});
on('prevMonth','click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);render()});on('nextMonth','click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);render()});document.querySelectorAll('[data-date]').forEach(el=>el.onclick=()=>{selectedDate=el.dataset.date;render()});
const bookingCustomer=$('bookingCustomer'),bookingMeasurement=$('bookingMeasurement');if(bookingCustomer&&bookingMeasurement){const update=()=>{bookingMeasurement.innerHTML='<option value="">None</option>'+measurements.filter(m=>m.customer_id===bookingCustomer.value&&m.order_type===$('bookingType')?.value&&(!m.delivery_date||m.delivery_date===$('bookingDate')?.value)).map(m=>`<option value="${m.id}">${esc(m.slip_no||new Date(m.created_at).toLocaleString())}</option>`).join('')};bookingCustomer.onchange=update;if($('bookingType'))$('bookingType').onchange=()=>{update();updateOverrideVisibility('booking')};if($('bookingDate'))$('bookingDate').onchange=()=>{update();updateOverrideVisibility('booking')};update()}
on('bookingForm','submit',async e=>{e.preventDefault();const f=new FormData(e.target),type=f.get('order_type'),date=f.get('delivery_date');try{const override=await getOverrideForBooking(f,type,date);const {error:bookError}=await sb.rpc('book_order_v3',{p_customer_id:f.get('customer_id'),p_measurement_id:f.get('measurement_id')||null,p_item_name:f.get('item_name'),p_delivery_date:date,p_order_type:type,p_notes:f.get('notes'),p_days_required:Number(f.get('days_required')),p_override_token:override});if(bookError)throw bookError;notify('Delivery booked');await refresh()}catch(err){error(err)}});
on('dailyDate','change',e=>{selectedDate=e.target.value;render()});document.querySelectorAll('[data-status]').forEach(el=>el.onchange=async()=>{try{const {error:x}=await sb.rpc('set_order_status',{p_order_id:el.dataset.status,p_status:el.value});if(x)throw x;notify('Status updated');await refresh()}catch(x){error(x)}});
on('capacityForm','submit',async e=>{e.preventDefault();try{const {error:x}=await sb.rpc('set_capacity',{p_capacity:Number(new FormData(e.target).get('capacity'))});if(x)throw x;notify('Capacity updated');await refresh()}catch(x){error(x)}});
on('addSalespersonForm','submit',async e=>{e.preventDefault();const name=String(new FormData(e.target).get('full_name')||'').trim();if(!name)return notify('Enter salesperson name');try{const {error:x}=await sb.from('salespeople').insert({full_name:name});if(x)throw x;notify('Salesperson added');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-rename-salesperson]').forEach(el=>el.onclick=async()=>{const id=el.dataset.renameSalesperson;const field=document.querySelector(`[data-salesperson-name="${id}"]`);const name=String(field?.value||'').trim();if(!name)return notify('Enter a valid name');try{const {error:x}=await sb.from('salespeople').update({full_name:name}).eq('id',id);if(x)throw x;notify('Salesperson name updated');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-toggle-salesperson]').forEach(el=>el.onclick=async()=>{const id=el.dataset.toggleSalesperson;const current=salespeople.find(x=>x.id===id);if(!current)return;try{const {error:x}=await sb.from('salespeople').update({active:!current.active}).eq('id',id);if(x)throw x;notify(current.active?'Salesperson deactivated':'Salesperson reactivated');await refresh()}catch(x){error(x)}});
on('staffForm','submit',async e=>{e.preventDefault();try{const f=new FormData(e.target);await staffCall({action:'create',user_id:f.get('user_id'),full_name:f.get('full_name'),role:f.get('role')});notify('Staff role saved');await refresh()}catch(x){error(x)}});
document.querySelectorAll('[data-save-staff]').forEach(el=>el.onclick=async()=>{const id=el.dataset.saveStaff;try{await staffCall({action:'update',id,role:document.querySelector(`[data-role="${id}"]`).value,active:document.querySelector(`[data-active="${id}"]`).checked});notify('Staff updated');await refresh()}catch(x){error(x)}})
}
async function loadUser(){const {data:{user}}=await sb.auth.getUser();if(!user){me=null;role=null;$('login').classList.remove('hidden');$('app').classList.add('hidden');return}const {data:p,error:e}=await sb.from('profiles').select('*').eq('id',user.id).single();if(e||!p?.active){await sb.auth.signOut({scope:'local'});notify('Account is not authorized. Contact your admin.');return loadUser()}me=user;role=p.role;$('login').classList.add('hidden');$('app').classList.remove('hidden');try{await refresh()}catch(x){error(x)}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&me)refresh().catch(error)});
$('loginForm').onsubmit=async e=>{e.preventDefault();if(!sb)return notify('Configure Supabase first');const {error:x}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(x)return error(x);await loadUser()};$('logout').onclick=async()=>{await sb.auth.signOut({scope:'local'});loadUser()};if(!ready){$('setupWarning').textContent='Setup required: configure config.js with your Supabase Project URL and public key before signing in.'}else loadUser();
