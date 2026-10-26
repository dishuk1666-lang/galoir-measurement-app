-- GALOIR V3 preview: paper-slip measurements, unlimited New Make and supervised over-capacity Self Alter booking.
-- Additive migration; the current V1 production website and existing customer records are unchanged.
CREATE SEQUENCE IF NOT EXISTS public.galoir_slip_seq START WITH 2001 INCREMENT BY 1;
GRANT USAGE ON SEQUENCE public.galoir_slip_seq TO authenticated;

ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS slip_no text NOT NULL DEFAULT ('GL' || nextval('public.galoir_slip_seq'::regclass)::text),
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'self_alter' CHECK (order_type IN ('new_make','self_alter')),
  ADD COLUMN IF NOT EXISTS bill_no text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS order_date date,
  ADD COLUMN IF NOT EXISTS delivery_date date,
  ADD COLUMN IF NOT EXISTS item_name text,
  ADD COLUMN IF NOT EXISTS remarks text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS days_required integer NOT NULL DEFAULT 2 CHECK (days_required BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS ready_body text NOT NULL DEFAULT 'body' CHECK (ready_body IN ('ready','body')),
  ADD COLUMN IF NOT EXISTS lehenga_style text,
  ADD COLUMN IF NOT EXISTS bottom_style text,
  ADD COLUMN IF NOT EXISTS deliver_top boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deliver_bottom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deliver_dupatta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS voice_path text;
CREATE UNIQUE INDEX IF NOT EXISTS measurements_slip_no_unique ON public.measurements(slip_no);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'self_alter' CHECK (order_type IN ('new_make','self_alter')),
  ADD COLUMN IF NOT EXISTS days_required integer NOT NULL DEFAULT 2 CHECK (days_required BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_notified_at timestamptz;

-- Reviewers issue a single-use approval only after authenticating as an Admin or Manager.
CREATE TABLE IF NOT EXISTS public.booking_override_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  delivery_date date NOT NULL,
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 minutes'),
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id),
  order_id uuid REFERENCES public.orders(id)
);
ALTER TABLE public.booking_override_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_override_grants FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_booking_override(p_delivery_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_token text;
BEGIN
  IF public.my_role() NOT IN ('admin','manager') THEN
    RAISE EXCEPTION 'Admin or Manager authorization required' USING errcode='42501';
  END IF;
  IF p_delivery_date IS NULL OR p_delivery_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Invalid delivery date';
  END IF;
  v_token := encode(extensions.gen_random_bytes(24),'hex');
  INSERT INTO public.booking_override_grants(token_hash,delivery_date,issued_by)
    VALUES(extensions.digest(v_token,'sha256'),p_delivery_date,auth.uid());
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_booking_override(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_booking_override(date) TO authenticated;

-- New Make: unlimited, no capacity consumption. Self Alter: limit 20 by default, one fresh approval per extra booking.
CREATE OR REPLACE FUNCTION public.book_order_v3(
  p_customer_id uuid,
  p_measurement_id uuid,
  p_item_name text,
  p_delivery_date date,
  p_order_type text,
  p_notes text DEFAULT '',
  p_days_required integer DEFAULT 2,
  p_override_token text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.book_order_v3(uuid,uuid,text,date,text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_order_v3(uuid,uuid,text,date,text,text,integer,text) TO authenticated;

-- One form submission creates the numbered measurement slip and its booking in one transaction.
-- A rejected full-date booking therefore cannot leave behind an unbooked measurement.
CREATE OR REPLACE FUNCTION public.create_measurement_slip_and_booking(
  p_payload jsonb, p_override_token text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_measurement_id uuid;
  v_order_id uuid;
  v_slip_no text;
  v_customer_id uuid;
  v_salesperson text;
  v_type text;
  v_date date;
  v_days integer;
  v_item text;
BEGIN
  IF NOT public.can_do('measurements') OR NOT public.can_do('bookings') THEN
    RAISE EXCEPTION 'Not authorized to create a measurement slip' USING errcode='42501';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' OR pg_catalog.octet_length(p_payload::text)>45000 THEN
    RAISE EXCEPTION 'Invalid measurement slip data';
  END IF;
  v_customer_id := NULLIF(p_payload->>'customer_id','')::uuid;
  v_salesperson := NULLIF(btrim(p_payload->>'salesperson_name'),'');
  v_type := p_payload->>'order_type';
  v_date := NULLIF(p_payload->>'delivery_date','')::date;
  v_days := coalesce(NULLIF(p_payload->>'days_required','')::integer,2);
  v_item := NULLIF(btrim(p_payload->>'item_name'),'');
  IF NOT EXISTS (
    SELECT 1 FROM public.salespeople WHERE full_name=v_salesperson AND active=true
  ) THEN RAISE EXCEPTION 'Select an active salesperson'; END IF;
  IF v_type NOT IN ('new_make','self_alter') OR v_type IS NULL THEN
    RAISE EXCEPTION 'Select New Make or Self Alter';
  END IF;
  IF v_date IS NULL OR v_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Invalid delivery date';
  END IF;
  IF v_days NOT BETWEEN 0 AND 60 THEN RAISE EXCEPTION 'Invalid preparation days'; END IF;
  IF v_item IS NULL THEN RAISE EXCEPTION 'Outfit name required'; END IF;
  IF jsonb_typeof(p_payload->'values') <> 'object' THEN
    RAISE EXCEPTION 'Measurement values must be an object';
  END IF;

  INSERT INTO public.measurements (
    customer_id,values,fitting_notes,salesperson_name,created_by,
    bill_no,company_name,reviewed_by,order_date,delivery_date,order_type,item_name,remarks,days_required,
    ready_body,lehenga_style,bottom_style,deliver_top,deliver_bottom,deliver_dupatta
  ) VALUES (
    v_customer_id,p_payload->'values',coalesce(p_payload->>'fitting_notes',''),v_salesperson,auth.uid(),
    nullif(p_payload->>'bill_no',''),nullif(p_payload->>'company_name',''),
    nullif(p_payload->>'reviewed_by',''),
    coalesce(nullif(p_payload->>'order_date','')::date,(now() AT TIME ZONE 'Asia/Kolkata')::date),
    v_date,v_type,v_item,coalesce(p_payload->>'remarks',''),v_days,
    coalesce(nullif(p_payload->>'ready_body',''),'body'),
    nullif(p_payload->>'lehenga_style',''),nullif(p_payload->>'bottom_style',''),
    coalesce((p_payload->>'deliver_top')::boolean,false),
    coalesce((p_payload->>'deliver_bottom')::boolean,false),
    coalesce((p_payload->>'deliver_dupatta')::boolean,false)
  ) RETURNING id,slip_no INTO v_measurement_id,v_slip_no;

  v_order_id := public.book_order_v3(
    v_customer_id,v_measurement_id,v_item,v_date,v_type,
    coalesce(p_payload->>'remarks',''),v_days,p_override_token
  );
  RETURN jsonb_build_object('measurement_id',v_measurement_id,'order_id',v_order_id,'slip_no',v_slip_no);
END;
$$;
REVOKE ALL ON FUNCTION public.create_measurement_slip_and_booking(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_measurement_slip_and_booking(jsonb,text) TO authenticated;

-- Adjust capacity based on Self Alter bookings only (New Make has no limit).
CREATE OR REPLACE FUNCTION public.set_capacity(p_capacity integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_do('capacity') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode='42501';
  END IF;
  IF p_capacity IS NULL OR p_capacity<1 OR p_capacity>1000 THEN
    RAISE EXCEPTION 'Invalid capacity';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(74821, 1);
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND order_type='self_alter'
    GROUP BY delivery_date HAVING count(*) > p_capacity
  ) THEN RAISE EXCEPTION 'Capacity lower than existing Self Alter bookings'; END IF;
  UPDATE public.settings SET daily_capacity=p_capacity WHERE id=1;
  INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
  VALUES(auth.uid(),'capacity_changed','settings',p_capacity::text);
END;
$$;

-- CRM ready tick and supplier follow-up tracking.
CREATE OR REPLACE FUNCTION public.set_order_ready(p_order_id uuid,p_ready boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT public.can_do('daily') THEN RAISE EXCEPTION 'Not authorized' USING errcode='42501'; END IF;
 IF p_ready IS NULL THEN RAISE EXCEPTION 'Ready flag required'; END IF;
 UPDATE public.orders SET is_ready=p_ready,ready_at=CASE WHEN p_ready THEN now() ELSE NULL END,updated_at=now()
 WHERE id=p_order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),CASE WHEN p_ready THEN 'order_marked_ready' ELSE 'order_marked_not_ready' END,'order',p_order_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.set_order_ready(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_order_ready(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_supplier_informed(p_order_id uuid,p_informed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT public.can_do('daily') THEN RAISE EXCEPTION 'Not authorized' USING errcode='42501'; END IF;
 IF p_informed IS NULL THEN RAISE EXCEPTION 'Supplier follow-up flag required'; END IF;
 UPDATE public.orders
 SET supplier_notified_at=CASE WHEN p_informed THEN now() ELSE NULL END,updated_at=now()
 WHERE id=p_order_id AND order_type='new_make';
 IF NOT FOUND THEN RAISE EXCEPTION 'New Make order not found'; END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),CASE WHEN p_informed THEN 'supplier_informed' ELSE 'supplier_followup_reopened' END,'order',p_order_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.set_supplier_informed(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_informed(uuid,boolean) TO authenticated;

-- Photos and voice notes stay in private Supabase Storage; printable slips link to signed URLs.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES('galoir-measurement-media','galoir-measurement-media',false,15728640,
 ARRAY['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-m4a','video/mp4']::text[])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY galoir_measurement_media_read ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id='galoir-measurement-media' AND public.can_do('daily'));

CREATE POLICY galoir_measurement_media_upload ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='galoir-measurement-media' AND public.can_do('measurements')
 AND name ~ '^[0-9a-f-]{36}/(photo|voice)-[0-9a-f-]{36}\.[a-z0-9]+$'
);

CREATE OR REPLACE FUNCTION public.attach_measurement_media(
 p_measurement_id uuid,p_kind text,p_path text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT public.can_do('measurements') THEN
  RAISE EXCEPTION 'Not authorized' USING errcode='42501';
 END IF;
 IF p_kind NOT IN ('photo','voice') OR p_kind IS NULL
    OR p_path !~ '^[0-9a-f-]{36}/(photo|voice)-[0-9a-f-]{36}\.[a-z0-9]+$'
    OR split_part(p_path,'/',1)<>p_measurement_id::text
    OR split_part(split_part(p_path,'/',2),'-',1)<>p_kind THEN
  RAISE EXCEPTION 'Invalid media path';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.objects
                WHERE bucket_id='galoir-measurement-media' AND name=p_path) THEN
  RAISE EXCEPTION 'Media file was not uploaded';
 END IF;
 IF p_kind='photo' THEN
  UPDATE public.measurements SET photo_path=p_path
  WHERE id=p_measurement_id AND (created_by=auth.uid() OR public.my_role()='admin');
 ELSE
  UPDATE public.measurements SET voice_path=p_path
  WHERE id=p_measurement_id AND (created_by=auth.uid() OR public.my_role()='admin');
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Measurement not found or not authorized'; END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),'measurement_'||p_kind||'_attached','measurement',p_measurement_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.attach_measurement_media(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attach_measurement_media(uuid,text,text) TO authenticated;
