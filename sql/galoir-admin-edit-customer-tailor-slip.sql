-- GALOIR Admin corrections: customer profiles and saved tailor slips.
-- Unchanged: GL slip identifiers, linked customer, billing/payment amounts,
-- order type, readiness status, WhatsApp consent and notification outbox.
-- Admin-only RPCs use optimistic locking to prevent overwriting another editor.

CREATE TABLE IF NOT EXISTS public.galoir_admin_edit_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 target_kind text NOT NULL CHECK (target_kind IN ('customer','tailor_slip')),
 target_id uuid NOT NULL,
 slip_no text,
 previous_data jsonb NOT NULL,
 current_data jsonb NOT NULL,
 edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS galoir_admin_edit_history_target_idx
 ON public.galoir_admin_edit_history(target_kind,target_id,edited_at DESC);
ALTER TABLE public.galoir_admin_edit_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.galoir_admin_edit_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.galoir_admin_edit_history TO authenticated;
DROP POLICY IF EXISTS galoir_admin_edit_history_read ON public.galoir_admin_edit_history;
CREATE POLICY galoir_admin_edit_history_read ON public.galoir_admin_edit_history
 FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL AND public.my_role()='admin');

CREATE OR REPLACE FUNCTION public.admin_edit_galoir_customer(
 p_customer_id uuid,
 p_full_name text,
 p_phone text,
 p_notes text,
 p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_old public.customers%rowtype;
 v_new public.customers%rowtype;
 v_phone_digits text;
 v_normalized text;
 v_count integer;
BEGIN
 IF auth.uid() IS NULL OR public.my_role()<>'admin' THEN
  RAISE EXCEPTION 'Only Admin can edit customer records' USING errcode='42501';
 END IF;
 IF p_customer_id IS NULL OR p_expected_updated_at IS NULL THEN
  RAISE EXCEPTION 'Select a customer and reload their latest details';
 END IF;
 IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 1 AND 120
    OR length(coalesce(p_notes,''))>4000 THEN
  RAISE EXCEPTION 'Customer name must be 1–120 characters and notes under 4000';
 END IF;
 v_phone_digits:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 IF length(v_phone_digits)=12 AND left(v_phone_digits,2)='91' THEN
   v_normalized:=right(v_phone_digits,10);
 ELSE v_normalized:=v_phone_digits;END IF;
 IF length(v_normalized) NOT BETWEEN 7 AND 15 THEN
  RAISE EXCEPTION 'Enter a valid full customer phone number';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_normalized));
 SELECT * INTO v_old FROM public.customers WHERE id=p_customer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer record not found';END IF;
 IF v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'This customer was changed by another session. Refresh and reopen before saving.';
 END IF;
 SELECT count(*) INTO v_count FROM public.customers c
 WHERE c.id<>p_customer_id
 AND (
   CASE WHEN length(regexp_replace(c.phone,'[^0-9]','','g'))=12
                  AND left(regexp_replace(c.phone,'[^0-9]','','g'),2)='91'
        THEN right(regexp_replace(c.phone,'[^0-9]','','g'),10)
        ELSE regexp_replace(c.phone,'[^0-9]','','g')
   END
 )=v_normalized;
 IF v_count>0 THEN
  RAISE EXCEPTION 'Another customer already uses this phone number. Resolve the duplicate before changing it.';
 END IF;
 UPDATE public.customers SET full_name=btrim(p_full_name),
  phone=btrim(p_phone),notes=coalesce(p_notes,''),updated_at=clock_timestamp()
 WHERE id=p_customer_id RETURNING * INTO v_new;
 INSERT INTO public.galoir_admin_edit_history(actor_id,target_kind,target_id,previous_data,current_data)
 VALUES(auth.uid(),'customer',p_customer_id,
  jsonb_build_object('name',v_old.full_name,'phone',v_old.phone,'notes',v_old.notes),
  jsonb_build_object('name',v_new.full_name,'phone',v_new.phone,'notes',v_new.notes));
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),'admin_customer_updated','customer',p_customer_id::text);
 RETURN jsonb_build_object('customer_id',p_customer_id,'updated_at',v_new.updated_at,'full_name',v_new.full_name);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_edit_galoir_customer(uuid,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_galoir_customer(uuid,text,text,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_edit_galoir_tailor_slip(
 p_measurement_id uuid,
 p_payload jsonb,
 p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_old public.measurements%rowtype;
 v_new public.measurements%rowtype;
 v_order_date date;
 v_delivery date;
 v_days integer;
 v_values jsonb;
 v_remarks text;
 v_fitting text;
 v_salesperson text;
 v_company text;
 v_reviewer text;
 v_design text;
 v_barcode text;
 v_ready_body text;
 v_photo text;
 v_photopath text;
 v_before jsonb;
 v_after jsonb;
 v_expected_keys text[]:=ARRAY[
  'values','remarks','fitting_notes','salesperson_name','company_name',
  'reviewed_by','order_date','delivery_date','days_required','design_number',
  'product_barcode','ready_body','deliver_top','deliver_bottom','deliver_dupatta',
  'photo_path'
 ];
BEGIN
 IF auth.uid() IS NULL OR public.my_role()<>'admin' THEN
  RAISE EXCEPTION 'Only Admin can edit tailor slips' USING errcode='42501';
 END IF;
 IF p_measurement_id IS NULL OR p_expected_updated_at IS NULL OR p_payload IS NULL
  OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>50000 THEN
  RAISE EXCEPTION 'Invalid edit payload or missing latest slip version';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k
           WHERE NOT k=ANY(v_expected_keys)) THEN
  RAISE EXCEPTION 'One or more slip fields cannot be edited here';
 END IF;
 SELECT * INTO v_old FROM public.measurements
 WHERE id=p_measurement_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tailor slip no longer exists';END IF;
 IF v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'This slip was changed by another session. Refresh and reopen before saving.';
 END IF;
 v_values:=coalesce(p_payload->'values','{}'::jsonb);
 IF jsonb_typeof(v_values)<>'object' OR octet_length(v_values::text)>35000 THEN
  RAISE EXCEPTION 'Invalid measurements: fields must be a small object';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(v_values) x
  WHERE jsonb_typeof(x.value) NOT IN ('string','number','null')
     OR length(x.key)>250 OR length(x.value::text)>300) THEN
  RAISE EXCEPTION 'Measurement entries must be text or numbers, maximum 120 characters';
 END IF;
 v_remarks:=coalesce(p_payload->>'remarks','');
 v_fitting:=coalesce(p_payload->>'fitting_notes','');
 v_salesperson:=nullif(btrim(p_payload->>'salesperson_name'),'');
 v_company:=nullif(btrim(p_payload->>'company_name'),'');
 v_reviewer:=nullif(btrim(p_payload->>'reviewed_by'),'');
 v_design:=nullif(btrim(p_payload->>'design_number'),'');
 v_barcode:=nullif(btrim(p_payload->>'product_barcode'),'');
 v_ready_body:=coalesce(nullif(p_payload->>'ready_body',''),v_old.ready_body);
 IF length(v_remarks)>6000 OR length(v_fitting)>6000
   OR length(coalesce(v_salesperson,''))>120 OR length(coalesce(v_company,''))>120
   OR length(coalesce(v_reviewer,''))>120
   OR length(coalesce(v_design,''))>100 OR length(coalesce(v_barcode,''))>120
   OR v_ready_body NOT IN('ready','body') THEN
  RAISE EXCEPTION 'One or more slip details are too long or invalid';
 END IF;
 v_order_date:=nullif(p_payload->>'order_date','')::date;
 v_delivery:=nullif(p_payload->>'delivery_date','')::date;
 v_days:=nullif(p_payload->>'days_required','')::integer;
 IF v_days IS NULL OR v_days NOT BETWEEN 0 AND 60 THEN
  RAISE EXCEPTION 'Preparation days must be between 0 and 60';
 END IF;
 IF v_old.workflow_status='billed' AND v_delivery IS NULL THEN
  RAISE EXCEPTION 'A billed slip must retain a delivery date';
 END IF;
 IF v_order_date IS NOT NULL AND v_delivery IS NOT NULL AND v_delivery<v_order_date THEN
  RAISE EXCEPTION 'Delivery cannot be before the order date';
 END IF;
 -- The uploaded object must belong to this slip, be in the private bucket,
 -- and be an image uploaded through the authenticated admin Storage policy.
 v_photo:=nullif(p_payload->>'photo_path','');
 IF p_payload ? 'photo_path' AND v_photo IS NOT NULL THEN
  IF v_photo !~ ('^'||p_measurement_id::text||'/photo-[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$') THEN
   RAISE EXCEPTION 'Invalid reference photo path';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects
      WHERE bucket_id='galoir-measurement-media' AND name=v_photo) THEN
   RAISE EXCEPTION 'Reference photo upload was not found';
  END IF;
 END IF;
 v_photopath:=CASE WHEN p_payload ? 'photo_path' THEN v_photo ELSE v_old.photo_path END;
 v_before:=jsonb_build_object(
  'values',v_old.values,'remarks',v_old.remarks,'fitting_notes',v_old.fitting_notes,
  'delivery_date',v_old.delivery_date,'order_date',v_old.order_date,
  'days_required',v_old.days_required,'salesperson_name',v_old.salesperson_name,
  'company_name',v_old.company_name,'reviewed_by',v_old.reviewed_by,
  'design_number',v_old.design_number,'product_barcode',v_old.product_barcode,
  'ready_body',v_old.ready_body,'deliver_top',v_old.deliver_top,
  'deliver_bottom',v_old.deliver_bottom,'deliver_dupatta',v_old.deliver_dupatta,
  'photo_path',v_old.photo_path
 );
 UPDATE public.measurements SET
  values=coalesce(values,'{}'::jsonb)||v_values,
  remarks=v_remarks,fitting_notes=v_fitting,
  delivery_date=v_delivery,order_date=v_order_date,days_required=v_days,
  salesperson_name=v_salesperson,company_name=v_company,reviewed_by=v_reviewer,
  design_number=v_design,product_barcode=v_barcode,
  ready_body=v_ready_body,
  deliver_top=coalesce((p_payload->>'deliver_top')::boolean,false),
  deliver_bottom=coalesce((p_payload->>'deliver_bottom')::boolean,false),
  deliver_dupatta=coalesce((p_payload->>'deliver_dupatta')::boolean,false),
  photo_path=v_photopath,updated_at=clock_timestamp()
 WHERE id=p_measurement_id
 RETURNING * INTO v_new;
 -- Only sync the existing order's schedule. Never rebook, re-bill, change
 -- a Ready/Delivered state, or trigger a retrospective WhatsApp message.
 UPDATE public.orders SET delivery_date=v_delivery,days_required=v_days,
  updated_at=clock_timestamp()
 WHERE measurement_id=p_measurement_id;
 v_after:=jsonb_build_object(
  'values',v_new.values,'remarks',v_new.remarks,'fitting_notes',v_new.fitting_notes,
  'delivery_date',v_new.delivery_date,'order_date',v_new.order_date,
  'days_required',v_new.days_required,'salesperson_name',v_new.salesperson_name,
  'company_name',v_new.company_name,'reviewed_by',v_new.reviewed_by,
  'design_number',v_new.design_number,'product_barcode',v_new.product_barcode,
  'ready_body',v_new.ready_body,'deliver_top',v_new.deliver_top,
  'deliver_bottom',v_new.deliver_bottom,'deliver_dupatta',v_new.deliver_dupatta,
  'photo_path',v_new.photo_path
 );
 INSERT INTO public.galoir_admin_edit_history(actor_id,target_kind,target_id,slip_no,previous_data,current_data)
 VALUES(auth.uid(),'tailor_slip',p_measurement_id,v_new.slip_no,v_before,v_after);
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),'admin_tailor_slip_updated','measurement',p_measurement_id::text);
 RETURN jsonb_build_object('measurement_id',p_measurement_id,'slip_no',v_new.slip_no,
 'updated_at',v_new.updated_at,'delivery_date',v_new.delivery_date);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_edit_galoir_tailor_slip(uuid,jsonb,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_galoir_tailor_slip(uuid,jsonb,timestamptz) TO authenticated;
