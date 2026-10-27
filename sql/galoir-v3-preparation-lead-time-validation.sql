-- Preparation lead-time validation for both draft measurement slips and finalized delivery bookings.
-- Keep dates stored exactly as selected; reject impossible lead times without modifying existing records.
CREATE OR REPLACE FUNCTION public.save_measurement_draft(p_payload jsonb, p_measurement_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 v_required_days integer;
 v_delivery date;
 v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
 if not public.can_do('measurements') then
   raise exception 'Not authorized to save a measurement draft' using errcode='42501';
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>45000 then
   raise exception 'Invalid or oversized slip data';
 end if;
 -- Drafts may omit delivery date, but cannot save a date sooner than preparation requires.
 v_required_days:=coalesce(nullif(p_payload->>'days_required','')::integer,3);
 IF v_required_days NOT BETWEEN 0 AND 60 THEN
   raise exception 'Preparation days must be between 0 and 60';
 END IF;
 v_delivery:=nullif(p_payload->>'delivery_date','')::date;
 IF v_delivery IS NOT NULL AND v_delivery-v_today < v_required_days THEN
   raise exception 'Preparation requires % days but the selected delivery is only % days away. Choose % or later, or reduce preparation days.',
     v_required_days,v_delivery-v_today,to_char(v_today+v_required_days,'DD Mon YYYY');
 END IF;
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
    product_barcode,design_number,final_billing_amount,workflow_status)
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
    nullif(btrim(p_payload->>'design_number'),''),
    nullif(btrim(p_payload->>'final_billing_amount'),'')::numeric,
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
    design_number=nullif(btrim(p_payload->>'design_number'),''),
    final_billing_amount=nullif(btrim(p_payload->>'final_billing_amount'),'')::numeric,
    updated_at=now()
   where id=v_id
   returning slip_no into v_slip;
 end if;
 insert into public.audit_log(actor_id,event,target_type,target_id)
 values(auth.uid(),case when p_measurement_id is null then 'slip_draft_created' else 'slip_draft_updated' end,'measurement',v_id::text);
 return jsonb_build_object('measurement_id',v_id,'slip_no',v_slip,
                           'customer_id',v_customer,'workflow_status','draft');
end;
$function$;

CREATE OR REPLACE FUNCTION public.book_order_v3(p_customer_id uuid, p_measurement_id uuid, p_item_name text, p_delivery_date date, p_order_type text, p_notes text DEFAULT ''::text, p_days_required integer DEFAULT 2, p_override_token text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order_id uuid;
  v_capacity integer;
  v_booked integer;
  v_override_id uuid;
BEGIN
  IF NOT public.can_do('bookings') THEN
    RAISE EXCEPTION 'Not authorized to book deliveries' USING errcode='42501';
  END IF;
  IF p_order_type NOT IN ('new_make','self_alter') OR p_order_type IS NULL THEN
    RAISE EXCEPTION 'Select New Make or Self Alter';
  END IF;
  IF p_delivery_date IS NULL OR p_delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Invalid delivery date';
  END IF;
  IF NULLIF(btrim(p_item_name),'') IS NULL OR char_length(p_item_name)>200 THEN
    RAISE EXCEPTION 'Enter a valid outfit name';
  END IF;
  IF p_days_required IS NULL OR p_days_required NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'Preparation days must be between 0 and 60';
  END IF;
  -- Capacity availability does not override preparation lead time.
  IF p_delivery_date-(now() AT TIME ZONE 'Asia/Kolkata')::date < p_days_required THEN
    RAISE EXCEPTION 'Preparation requires % days but the selected delivery is only % days away. Choose % or later, or reduce preparation days.',
      p_days_required,p_delivery_date-(now() AT TIME ZONE 'Asia/Kolkata')::date,
      to_char((now() AT TIME ZONE 'Asia/Kolkata')::date+p_days_required,'DD Mon YYYY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
  IF p_measurement_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.measurements
      WHERE id=p_measurement_id AND customer_id=p_customer_id
        AND (delivery_date IS NULL OR delivery_date=p_delivery_date)
        AND order_type=p_order_type
  ) THEN RAISE EXCEPTION 'Measurement, customer, date or order type mismatch'; END IF;

  -- Same lock used by capacity-setting RPC, preventing racing bookings.
  PERFORM pg_catalog.pg_advisory_xact_lock(74821, 1);
  IF p_order_type='self_alter' THEN
    SELECT daily_capacity INTO v_capacity FROM public.settings WHERE id=1;
    IF v_capacity IS NULL THEN RAISE EXCEPTION 'Capacity not configured'; END IF;
    SELECT count(*) INTO v_booked FROM public.orders
      WHERE delivery_date=p_delivery_date AND order_type='self_alter';
    IF v_booked >= v_capacity THEN
      IF NULLIF(btrim(p_override_token),'') IS NULL THEN
        RAISE EXCEPTION 'Self Alter date full: Admin or Manager password approval required';
      END IF;
      SELECT id INTO v_override_id FROM public.booking_override_grants
      WHERE token_hash=extensions.digest(p_override_token,'sha256')
        AND delivery_date=p_delivery_date AND expires_at>now() AND used_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Approval expired, already used or for a different delivery date';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.orders(
    customer_id,measurement_id,item_name,delivery_date,order_type,notes,days_required,created_by
  ) VALUES (
    p_customer_id,p_measurement_id,btrim(p_item_name),p_delivery_date,p_order_type,
    coalesce(p_notes,''),p_days_required,auth.uid()
  ) RETURNING id INTO v_order_id;

  IF v_override_id IS NOT NULL THEN
    UPDATE public.booking_override_grants
    SET used_at=now(), used_by=auth.uid(), order_id=v_order_id
    WHERE id=v_override_id;
  END IF;
  INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
  VALUES (auth.uid(), CASE WHEN v_override_id IS NULL THEN 'order_created' ELSE 'order_capacity_override' END,
          'order',v_order_id::text);
  RETURN v_order_id;
END;
$function$;

-- Older booking RPC has no preparation input: disable it to prevent bypassing this rule.
REVOKE EXECUTE ON FUNCTION public.book_order(uuid,uuid,text,date,text) FROM PUBLIC,anon,authenticated;
