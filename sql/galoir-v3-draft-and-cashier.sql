-- GALOIR V3: searchable phone, partial draft slips, barcode, and cashier final billing.
-- Retains GL number generation, New Make / Self Alter rules and existing measurements.
alter table public.measurements
  add column if not exists workflow_status text not null default 'billed'
    check (workflow_status in ('draft','billed')),
  add column if not exists product_barcode text,
  add column if not exists billed_at timestamptz,
  add column if not exists billed_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists customers_phone_digits_idx
  on public.customers ((regexp_replace(phone,'[^0-9]','','g')));
create index if not exists measurements_draft_queue_idx
  on public.measurements (workflow_status,created_at desc);

create or replace function public.save_measurement_draft(
 p_payload jsonb, p_measurement_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_id uuid;
 v_slip text;
 v_customer uuid;
 v_phone text;
 v_normalized text;
 v_customer_phone text;
 v_name text;
 v_values jsonb;
 v_salesperson text;
 v_count integer;
begin
 if not public.can_do('measurements') then
   raise exception 'Not authorized to save a measurement draft' using errcode='42501';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>45000 then
   raise exception 'Invalid or oversized slip data';
 end if;
 v_phone:=btrim(coalesce(p_payload->>'customer_phone',''));
 v_normalized:=regexp_replace(v_phone,'[^0-9]','','g');
 if length(v_normalized)=12 and left(v_normalized,2)='91' then
   v_normalized:=right(v_normalized,10);
 end if;
 if length(v_normalized)<7 or length(v_normalized)>15 then
   raise exception 'Enter a valid customer phone number';
 end if;
 v_values:=coalesce(p_payload->'values','{}'::jsonb);
 if jsonb_typeof(v_values)<>'object' then
   raise exception 'Measurement entries must be an object';
 end if;
 v_customer:=nullif(p_payload->>'customer_id','')::uuid;
 v_name:=nullif(btrim(coalesce(p_payload->>'customer_name','')),'');
 v_salesperson:=nullif(btrim(coalesce(p_payload->>'salesperson_name','')),'');
 if v_salesperson is not null and not exists (
   select 1 from public.salespeople where full_name=v_salesperson and active
 ) then raise exception 'Select an active salesperson'; end if;
 if v_customer is not null then
   select phone into v_customer_phone from public.customers where id=v_customer;
   if not found then raise exception 'Selected customer was not found'; end if;
   v_customer_phone:=regexp_replace(v_customer_phone,'[^0-9]','','g');
   if length(v_customer_phone)=12 and left(v_customer_phone,2)='91' then
     v_customer_phone:=right(v_customer_phone,10);
   end if;
   if v_normalized<>v_customer_phone then
     raise exception 'Phone number does not match the selected customer';
   end if;
 else
   -- An existing customer can be reused when the phone has exactly one match.
   select count(*) into v_count from public.customers c
    where (case
       when length(regexp_replace(c.phone,'[^0-9]','','g'))=12
        and left(regexp_replace(c.phone,'[^0-9]','','g'),2)='91'
       then right(regexp_replace(c.phone,'[^0-9]','','g'),10)
       else regexp_replace(c.phone,'[^0-9]','','g') end)=v_normalized;
   if v_count=1 and coalesce((p_payload->>'force_new_customer')::boolean,false)=false then
     select id into v_customer from public.customers c
     where (case
       when length(regexp_replace(c.phone,'[^0-9]','','g'))=12
        and left(regexp_replace(c.phone,'[^0-9]','','g'),2)='91'
       then right(regexp_replace(c.phone,'[^0-9]','','g'),10)
       else regexp_replace(c.phone,'[^0-9]','','g') end)=v_normalized
     limit 1;
   elsif v_count>1 and coalesce((p_payload->>'force_new_customer')::boolean,false)=false then
     raise exception 'Multiple customers share this phone; select the customer first';
   else
     if v_name is null or length(v_name)>120 then
       raise exception 'Enter customer name to add a new customer';
     end if;
     insert into public.customers(full_name,phone,notes,created_by)
     values(v_name,v_phone,'',auth.uid()) returning id into v_customer;
   end if;
 end if;
 if p_measurement_id is null then
   insert into public.measurements(
    customer_id,values,fitting_notes,salesperson_name,created_by,
    bill_no,company_name,reviewed_by,order_date,delivery_date,
    order_type,item_name,remarks,days_required,ready_body,lehenga_style,
    bottom_style,deliver_top,deliver_bottom,deliver_dupatta,
    product_barcode,workflow_status)
   values(
    v_customer,v_values,coalesce(p_payload->>'fitting_notes',''),v_salesperson,auth.uid(),
    null,nullif(p_payload->>'company_name',''),nullif(p_payload->>'reviewed_by',''),
    coalesce(nullif(p_payload->>'order_date','')::date,(now() at time zone 'Asia/Kolkata')::date),
    nullif(p_payload->>'delivery_date','')::date,
    coalesce(nullif(p_payload->>'order_type',''),'new_make'),
    nullif(p_payload->>'item_name',''),
    coalesce(p_payload->>'remarks',''),
    coalesce(nullif(p_payload->>'days_required','')::integer,3),
    coalesce(nullif(p_payload->>'ready_body',''),'body'),
    nullif(p_payload->>'lehenga_style',''),
    nullif(p_payload->>'bottom_style',''),
    coalesce((p_payload->>'deliver_top')::boolean,false),
    coalesce((p_payload->>'deliver_bottom')::boolean,false),
    coalesce((p_payload->>'deliver_dupatta')::boolean,false),
    nullif(p_payload->>'product_barcode',''),
    'draft')
   returning id,slip_no into v_id,v_slip;
 else
   select id into v_id from public.measurements
   where id=p_measurement_id and workflow_status='draft'
     and (created_by=auth.uid() or public.my_role()='admin')
   for update;
   if not found then raise exception 'Draft not found, billed or not authorized'; end if;
   update public.measurements set
    customer_id=v_customer,values=v_values,
    fitting_notes=coalesce(p_payload->>'fitting_notes',''),
    salesperson_name=v_salesperson,
    company_name=nullif(p_payload->>'company_name',''),
    reviewed_by=nullif(p_payload->>'reviewed_by',''),
    order_date=coalesce(nullif(p_payload->>'order_date','')::date,(now() at time zone 'Asia/Kolkata')::date),
    delivery_date=nullif(p_payload->>'delivery_date','')::date,
    order_type=coalesce(nullif(p_payload->>'order_type',''),'new_make'),
    item_name=nullif(p_payload->>'item_name',''),
    remarks=coalesce(p_payload->>'remarks',''),
    days_required=coalesce(nullif(p_payload->>'days_required','')::integer,3),
    ready_body=coalesce(nullif(p_payload->>'ready_body',''),'body'),
    lehenga_style=nullif(p_payload->>'lehenga_style',''),
    bottom_style=nullif(p_payload->>'bottom_style',''),
    deliver_top=coalesce((p_payload->>'deliver_top')::boolean,false),
    deliver_bottom=coalesce((p_payload->>'deliver_bottom')::boolean,false),
    deliver_dupatta=coalesce((p_payload->>'deliver_dupatta')::boolean,false),
    product_barcode=nullif(p_payload->>'product_barcode',''),
    updated_at=now()
   where id=v_id
   returning slip_no into v_slip;
 end if;
 insert into public.audit_log(actor_id,event,target_type,target_id)
 values(auth.uid(),case when p_measurement_id is null then 'slip_draft_created' else 'slip_draft_updated' end,'measurement',v_id::text);
 return jsonb_build_object('measurement_id',v_id,'slip_no',v_slip,
                           'customer_id',v_customer,'workflow_status','draft');
end;
$$;
revoke all on function public.save_measurement_draft(jsonb,uuid) from public,anon;
grant execute on function public.save_measurement_draft(jsonb,uuid) to authenticated;

-- Cashier Desk: require a real bill number before printing and commit booking atomically.
-- An incomplete draft never reserves delivery capacity. The booking is made at final billing.
create or replace function public.finalize_slip_billing(
 p_measurement_id uuid,p_bill_no text,
 p_item_name text,p_delivery_date date,
 p_product_barcode text default null,
 p_override_token text default null
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 v_slip public.measurements%rowtype;
 v_order_id uuid;
 v_bill text:=nullif(btrim(p_bill_no),'');
 v_item text:=nullif(btrim(p_item_name),'');
begin
 if not public.can_do('measurements') or not public.can_do('bookings') then
  raise exception 'Not authorized to complete billing' using errcode='42501';
 end if;
 if v_bill is null or length(v_bill)>100 then
   raise exception 'Cashier must enter a valid bill number';
 end if;
 if v_item is null or length(v_item)>200 then
   raise exception 'Outfit or article name required';
 end if;
 if p_delivery_date is null or p_delivery_date<(now() at time zone 'Asia/Kolkata')::date then
   raise exception 'Select a valid delivery date';
 end if;
 if p_product_barcode is not null and length(p_product_barcode)>120 then
   raise exception 'Product barcode is too long';
 end if;
 select * into v_slip from public.measurements
 where id=p_measurement_id and workflow_status='draft' for update;
 if not found then
   raise exception 'Draft not found or already billed';
 end if;
 if exists (select 1 from public.orders where measurement_id=p_measurement_id) then
   raise exception 'This slip already has a booking';
 end if;
 update public.measurements
 set bill_no=v_bill,
     item_name=v_item,
     delivery_date=p_delivery_date,
     product_barcode=coalesce(nullif(btrim(p_product_barcode),''),product_barcode),
     updated_at=now()
 where id=p_measurement_id;
 v_order_id:=public.book_order_v3(v_slip.customer_id,p_measurement_id,v_item,
                       p_delivery_date,v_slip.order_type,
                       coalesce(v_slip.remarks,''),v_slip.days_required,p_override_token);
 update public.measurements
 set workflow_status='billed',billed_at=now(),billed_by=auth.uid(),
     updated_at=now()
 where id=p_measurement_id;
 insert into public.audit_log(actor_id,event,target_type,target_id)
 values(auth.uid(),'slip_billed','measurement',p_measurement_id::text);
 return jsonb_build_object('slip_no',v_slip.slip_no,'measurement_id',p_measurement_id,
                          'order_id',v_order_id,'workflow_status','billed');
end;
$$;
revoke all on function public.finalize_slip_billing(uuid,text,text,date,text,text) from public,anon;
grant execute on function public.finalize_slip_billing(uuid,text,text,date,text,text) to authenticated;

-- Old combined save endpoint bypasses the cashier stage; disable for ordinary clients.
revoke execute on function public.create_measurement_slip_and_booking(jsonb,text) from authenticated;
