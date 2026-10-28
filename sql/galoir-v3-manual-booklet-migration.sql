-- GALOIR Manual Booklet Migration (Admin/Manager only).
-- Creates an already-billed digital GL slip and order for a historical POS bill.
-- It intentionally bypasses new-booking date/capacity restrictions and NEVER calls
-- the normal billing function or sends retrospective order-confirmation WhatsApps.
ALTER TABLE public.measurements
 ADD COLUMN IF NOT EXISTS imported_from_manual boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS manual_booklet_name text,
 ADD COLUMN IF NOT EXISTS manual_slip_no text,
 ADD COLUMN IF NOT EXISTS manual_booklet_photo_path text,
 ADD COLUMN IF NOT EXISTS needs_measurement_entry boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS manual_imported_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS galoir_manual_booklet_slip_unique
 ON public.measurements(lower(btrim(manual_booklet_name)),lower(btrim(manual_slip_no)))
 WHERE imported_from_manual;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='galoir_manual_import_reference_required') THEN
  ALTER TABLE public.measurements
   ADD CONSTRAINT galoir_manual_import_reference_required CHECK(
    NOT imported_from_manual OR
    (manual_booklet_name IS NOT NULL AND length(btrim(manual_booklet_name)) BETWEEN 1 AND 100
     AND manual_slip_no IS NOT NULL AND length(btrim(manual_slip_no)) BETWEEN 1 AND 80
     AND bill_no IS NOT NULL AND length(btrim(bill_no)) BETWEEN 1 AND 100
     AND workflow_status='billed')
   );
 END IF;
END $$;

-- Original booklet photo is stored separately from an outfit design reference image.
-- Authorised Admin/Managers may upload to imported slips even when a different
-- Admin/Manager entered the original booking.
CREATE POLICY galoir_manual_booklet_photo_upload
 ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (
   bucket_id='galoir-measurement-media'
   AND public.my_role() IN ('admin','manager')
   AND name ~ '^[0-9a-f-]{36}/manual-[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$'
   AND EXISTS(
    SELECT 1 FROM public.measurements m
    WHERE m.id=split_part(name,'/',1)::uuid AND m.imported_from_manual
   )
 );

CREATE OR REPLACE FUNCTION public.import_manual_booklet_order(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_book text;
 v_manual text;
 v_bill text;
 v_name text;
 v_phone text;
 v_norm text;
 v_customer uuid;
 v_num_matches integer;
 v_type text;
 v_order_date date;
 v_delivery date;
 v_today date:=(now() at time zone 'Asia/Kolkata')::date;
 v_days integer;
 v_status text;
 v_db_status text;
 v_total numeric;
 v_paid numeric;
 v_whatsapp boolean;
 v_pending boolean;
 v_values jsonb;
 v_remarks text;
 v_fitting text;
 v_salesperson text;
 v_measurement uuid;
 v_gl text;
 v_order uuid;
BEGIN
 IF v_actor IS NULL OR public.my_role() NOT IN('admin','manager') THEN
  RAISE EXCEPTION 'Only Admin or Manager can import manual booklet orders' USING errcode='42501';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>50000 THEN
  RAISE EXCEPTION 'Invalid or oversized import data';
 END IF;
 v_book:=nullif(btrim(p_payload->>'manual_booklet_name'),'');
 v_manual:=nullif(btrim(p_payload->>'manual_slip_no'),'');
 v_bill:=nullif(btrim(p_payload->>'bill_no'),'');
 v_name:=nullif(btrim(p_payload->>'customer_name'),'');
 v_phone:=nullif(btrim(p_payload->>'customer_phone'),'');
 IF v_book IS NULL OR length(v_book)>100 THEN RAISE EXCEPTION 'Enter a booklet name (up to 100 characters)';END IF;
 IF v_manual IS NULL OR length(v_manual)>80 THEN RAISE EXCEPTION 'Enter the original manual slip number';END IF;
 IF v_bill IS NULL OR length(v_bill)>100 THEN RAISE EXCEPTION 'Enter the original POS bill number (not a new bill)';END IF;
 IF v_phone IS NULL THEN RAISE EXCEPTION 'Enter the customer phone number';END IF;
 v_norm:=regexp_replace(v_phone,'[^0-9]','','g');
 IF length(v_norm)=12 AND left(v_norm,2)='91' THEN v_norm:=right(v_norm,10);END IF;
 IF length(v_norm)<7 OR length(v_norm)>15 THEN RAISE EXCEPTION 'Enter a valid customer phone number';END IF;
 v_type:=coalesce(nullif(btrim(p_payload->>'order_type'),''),'self_alter');
 IF v_type NOT IN('new_make','self_alter') THEN RAISE EXCEPTION 'Invalid order type';END IF;
 v_status:=coalesce(nullif(btrim(p_payload->>'current_status'),''),'pending');
 IF v_status NOT IN('pending','sent_master','stitching','alteration','trial','ready','delivered') THEN
   RAISE EXCEPTION 'Invalid imported order status';
 END IF;
 IF v_status='sent_master' AND v_type<>'self_alter' THEN
   RAISE EXCEPTION 'Sent to master room is only for Self Alter';
 END IF;
 v_order_date:=coalesce(nullif(p_payload->>'order_date','')::date,v_today);
 v_delivery:=nullif(p_payload->>'delivery_date','')::date;
 IF v_delivery IS NULL THEN RAISE EXCEPTION 'Original promised delivery date is required';END IF;
 IF v_order_date>v_today THEN RAISE EXCEPTION 'Original order date cannot be in the future';END IF;
 IF v_delivery<v_order_date THEN RAISE EXCEPTION 'Delivery date cannot be before original order date';END IF;
 v_days:=coalesce(nullif(p_payload->>'days_required','')::integer,3);
 IF v_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'Preparation days must be between 0 and 60';END IF;
 v_values:=coalesce(p_payload->'values','{}'::jsonb);
 IF jsonb_typeof(v_values)<>'object' OR octet_length(v_values::text)>35000 THEN
   RAISE EXCEPTION 'Invalid measurement data';
 END IF;
 v_remarks:=coalesce(p_payload->>'remarks','');
 v_fitting:=coalesce(p_payload->>'fitting_notes','');
 IF length(v_remarks)>6000 OR length(v_fitting)>6000 THEN
  RAISE EXCEPTION 'Remarks or fitting notes are too long';
 END IF;
 v_salesperson:=nullif(btrim(p_payload->>'salesperson_name'),'');
 IF length(coalesce(v_salesperson,''))>120 THEN RAISE EXCEPTION 'Salesperson name is too long';END IF;
 IF nullif(p_payload->>'final_billing_amount','') IS NOT NULL THEN
   v_total:=(p_payload->>'final_billing_amount')::numeric;
   IF v_total<=0 OR v_total>9999999999.99 OR v_total<>round(v_total,2) THEN
    RAISE EXCEPTION 'Original total must be positive with up to 2 decimal places';
   END IF;
 END IF;
 IF nullif(p_payload->>'paid_amount','') IS NOT NULL THEN
   v_paid:=(p_payload->>'paid_amount')::numeric;
   IF v_total IS NULL OR v_paid<0 OR v_paid>v_total OR v_paid<>round(v_paid,2) THEN
    RAISE EXCEPTION 'Paid amount requires a total and cannot exceed it';
   END IF;
 END IF;
 v_whatsapp:=coalesce(nullif(p_payload->>'whatsapp_opt_in','')::boolean,false);
 v_pending:=coalesce(nullif(p_payload->>'needs_measurement_entry','')::boolean,true);
 IF NOT v_pending AND v_values='{}'::jsonb THEN
  RAISE EXCEPTION 'Enter measurements or mark Measurements to enter later';
 END IF;
 -- Avoid accidentally generating two customers with a matching mobile number.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_norm));
 SELECT count(*) INTO v_num_matches FROM public.customers c WHERE
 (case when length(regexp_replace(c.phone,'[^0-9]','','g'))=12
      AND left(regexp_replace(c.phone,'[^0-9]','','g'),2)='91'
      then right(regexp_replace(c.phone,'[^0-9]','','g'),10)
      else regexp_replace(c.phone,'[^0-9]','','g') end)=v_norm;
 IF v_num_matches>1 THEN
   RAISE EXCEPTION 'Multiple customers share this phone. Resolve duplicate customer records first';
 ELSIF v_num_matches=1 THEN
   SELECT c.id INTO v_customer FROM public.customers c WHERE
   (case when length(regexp_replace(c.phone,'[^0-9]','','g'))=12
      AND left(regexp_replace(c.phone,'[^0-9]','','g'),2)='91'
      then right(regexp_replace(c.phone,'[^0-9]','','g'),10)
      else regexp_replace(c.phone,'[^0-9]','','g') end)=v_norm
   LIMIT 1;
 ELSE
   IF v_name IS NULL OR length(v_name)>120 THEN RAISE EXCEPTION 'Customer name is required for a new customer';END IF;
   INSERT INTO public.customers(full_name,phone,notes,created_by)
    VALUES(v_name,v_phone,'',v_actor) RETURNING id INTO v_customer;
 END IF;

 v_db_status:=CASE WHEN v_status='sent_master' THEN 'pending' ELSE v_status END;
 INSERT INTO public.measurements(
   customer_id,values,fitting_notes,created_by,salesperson_name,order_date,
   delivery_date,order_type,item_name,remarks,days_required,ready_body,
   workflow_status,bill_no,billed_by,final_billing_amount,paid_amount,
   whatsapp_opt_in,whatsapp_opt_in_at,whatsapp_opted_in_at,
   imported_from_manual,manual_booklet_name,manual_slip_no,needs_measurement_entry,manual_imported_at
 ) VALUES (
   v_customer,v_values,v_fitting,v_actor,v_salesperson,v_order_date,v_delivery,
   v_type,CASE WHEN v_type='new_make' THEN 'New Make Outfit' ELSE 'Self Alter Outfit' END,
   v_remarks,v_days,'body','billed',v_bill,NULL,v_total,v_paid,
   v_whatsapp,CASE WHEN v_whatsapp THEN now() ELSE NULL END,
   CASE WHEN v_whatsapp THEN now() ELSE NULL END,
   true,v_book,v_manual,v_pending,now()
 ) RETURNING id,slip_no INTO v_measurement,v_gl;

 -- Existing previously promised deliveries must appear in the real workload.
 -- This is a migration, NOT a new booking: ignore today's full calendar and
 -- preparation lead-time checks, and do not invoke the POS billing RPC.
 INSERT INTO public.orders(
   customer_id,measurement_id,item_name,delivery_date,order_type,notes,
   days_required,created_by,status,is_ready,master_room_sent_at
 ) VALUES (
   v_customer,v_measurement,
   CASE WHEN v_type='new_make' THEN 'New Make Outfit' ELSE 'Self Alter Outfit' END,
   v_delivery,v_type,v_remarks,v_days,v_actor,v_db_status,
   v_status IN('ready','delivered'),
   CASE WHEN v_status='sent_master' THEN now() ELSE NULL END
 ) RETURNING id INTO v_order;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
  VALUES(v_actor,'manual_booklet_order_imported','measurement',v_measurement::text);
 RETURN jsonb_build_object('measurement_id',v_measurement,'slip_no',v_gl,
   'order_id',v_order,'customer_id',v_customer,'manual_slip_no',v_manual,'manual_booklet_name',v_book);
END;
$$;
REVOKE ALL ON FUNCTION public.import_manual_booklet_order(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_manual_booklet_order(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_imported_booklet_photo(p_measurement_id uuid,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF auth.uid() IS NULL OR public.my_role() NOT IN('admin','manager') THEN
  RAISE EXCEPTION 'Only Admin/Manager may attach imported booklet photos' USING errcode='42501';END IF;
 IF p_measurement_id IS NULL OR p_path IS NULL OR
   p_path !~ ('^'||p_measurement_id::text||'/manual-[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$') THEN
  RAISE EXCEPTION 'Invalid private booklet photo path';END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='galoir-measurement-media' AND name=p_path) THEN
  RAISE EXCEPTION 'Booklet photo upload not found';END IF;
 UPDATE public.measurements SET manual_booklet_photo_path=p_path,updated_at=now()
 WHERE id=p_measurement_id AND imported_from_manual;
 IF NOT FOUND THEN RAISE EXCEPTION 'Imported measurement slip not found';END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),'manual_booklet_photo_attached','measurement',p_measurement_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.update_imported_booklet_photo(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_imported_booklet_photo(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_imported_measurements(
 p_measurement_id uuid,p_values jsonb,p_fitting_notes text,p_remarks text,
 p_needs_measurement_entry boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_slip text;
BEGIN
 IF auth.uid() IS NULL OR public.my_role() NOT IN('admin','manager') THEN
  RAISE EXCEPTION 'Only Admin/Manager may enter imported measurements' USING errcode='42501';END IF;
 IF p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR
   octet_length(p_values::text)>35000 THEN RAISE EXCEPTION 'Invalid measurement fields';END IF;
 IF coalesce(p_needs_measurement_entry,true)=false AND p_values='{}'::jsonb THEN
  RAISE EXCEPTION 'Enter measurements before marking transcription complete';END IF;
 IF length(coalesce(p_remarks,''))>6000 OR length(coalesce(p_fitting_notes,''))>6000 THEN
  RAISE EXCEPTION 'Remarks too long';END IF;
 UPDATE public.measurements
  SET values=coalesce(values,'{}'::jsonb)||p_values,
      fitting_notes=coalesce(p_fitting_notes,fitting_notes),
      remarks=coalesce(p_remarks,remarks),
      needs_measurement_entry=coalesce(p_needs_measurement_entry,true),
      updated_at=now()
 WHERE id=p_measurement_id AND imported_from_manual
 RETURNING slip_no INTO v_slip;
 IF NOT FOUND THEN RAISE EXCEPTION 'Imported slip not found';END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),'manual_booklet_measurements_updated','measurement',p_measurement_id::text);
 RETURN jsonb_build_object('measurement_id',p_measurement_id,
   'slip_no',v_slip,'needs_measurement_entry',p_needs_measurement_entry);
END;
$$;
REVOKE ALL ON FUNCTION public.update_imported_measurements(uuid,jsonb,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_imported_measurements(uuid,jsonb,text,text,boolean) TO authenticated;
