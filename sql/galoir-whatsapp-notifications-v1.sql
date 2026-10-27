-- WhatsApp integration (inactive by default; no SMS or WhatsApp is sent by this migration).
-- Only opted-in, newly billed outfits create notifications after the admin enables the service.
ALTER TABLE public.measurements
 ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2),
 ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.measurements ADD CONSTRAINT galoir_valid_paid_amount CHECK
 (paid_amount IS NULL OR (paid_amount>=0 AND final_billing_amount IS NOT NULL AND paid_amount<=final_billing_amount));

CREATE TABLE IF NOT EXISTS public.galoir_whatsapp_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
 order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
 event_type text NOT NULL CHECK (event_type IN ('order_confirmed','ready_for_collection')),
 phone_e164 text NOT NULL,
 template_data jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','submitted','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 submitted_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 provider_message_id text,
 last_error text,
 CONSTRAINT galoir_whatsapp_once_per_outfit UNIQUE (measurement_id,event_type)
);
CREATE INDEX IF NOT EXISTS galoir_whatsapp_outbox_pending_idx
 ON public.galoir_whatsapp_outbox(created_at) WHERE status='pending';
ALTER TABLE public.galoir_whatsapp_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.galoir_whatsapp_outbox FROM anon;
GRANT SELECT ON public.galoir_whatsapp_outbox TO authenticated;
CREATE POLICY galoir_whatsapp_staff_read ON public.galoir_whatsapp_outbox
 FOR SELECT TO authenticated USING (public.can_do('daily'));
-- Authenticated staff can read delivery records but cannot insert/update/delete queued messages.
REVOKE INSERT,UPDATE,DELETE ON public.galoir_whatsapp_outbox FROM authenticated;
 
CREATE OR REPLACE FUNCTION public.galoir_enqueue_order_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE
 v_customer public.customers%rowtype;
 v_order uuid;
 v_phone text;
BEGIN
 IF NEW.workflow_status <> 'billed' OR OLD.workflow_status = 'billed'
  OR NOT NEW.whatsapp_opt_in OR NEW.whatsapp_opt_in_at IS NULL
  OR NEW.paid_amount IS NULL OR NEW.final_billing_amount IS NULL
  OR NOT EXISTS(SELECT 1 FROM public.settings WHERE id=1 AND whatsapp_enabled)
 THEN RETURN NEW; END IF;
 SELECT * INTO v_customer FROM public.customers WHERE id=NEW.customer_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT id INTO v_order FROM public.orders WHERE measurement_id=NEW.id LIMIT 1;
 v_phone:=regexp_replace(v_customer.phone,'[^0-9]','','g');
 IF length(v_phone)=10 AND v_phone ~ '^[6-9]' THEN v_phone:='91'||v_phone; END IF;
 INSERT INTO public.galoir_whatsapp_outbox
 (measurement_id,order_id,event_type,phone_e164,template_data)
 VALUES(NEW.id,v_order,'order_confirmed',v_phone,
 jsonb_build_object(
 'customer_name',v_customer.full_name,'slip_no',NEW.slip_no,
 'bill_no',NEW.bill_no,'total_amount',NEW.final_billing_amount,
 'paid_amount',NEW.paid_amount,
 'balance_amount',NEW.final_billing_amount-NEW.paid_amount,
 'delivery_date',to_char(NEW.delivery_date,'DD Mon YYYY')))
 ON CONFLICT(measurement_id,event_type) DO NOTHING;
 RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION public.galoir_enqueue_order_confirmation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER galoir_wa_bill_event AFTER UPDATE OF workflow_status ON public.measurements
 FOR EACH ROW EXECUTE FUNCTION public.galoir_enqueue_order_confirmation();
 
CREATE OR REPLACE FUNCTION public.galoir_enqueue_ready_collection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE
 v_measurement public.measurements%rowtype;
 v_customer public.customers%rowtype;
 v_phone text;
BEGIN
 IF ((OLD.is_ready OR OLD.status='ready') OR NOT (NEW.is_ready OR NEW.status='ready'))
   OR NEW.status='delivered' OR NEW.measurement_id IS NULL
   OR NOT EXISTS(SELECT 1 FROM public.settings WHERE id=1 AND whatsapp_enabled)
 THEN RETURN NEW; END IF;
 SELECT * INTO v_measurement FROM public.measurements WHERE id=NEW.measurement_id
 AND workflow_status='billed' AND whatsapp_opt_in AND whatsapp_opt_in_at IS NOT NULL;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO v_customer FROM public.customers WHERE id=NEW.customer_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 v_phone:=regexp_replace(v_customer.phone,'[^0-9]','','g');
 IF length(v_phone)=10 AND v_phone ~ '^[6-9]' THEN v_phone:='91'||v_phone; END IF;
 INSERT INTO public.galoir_whatsapp_outbox
 (measurement_id,order_id,event_type,phone_e164,template_data)
 VALUES(v_measurement.id,NEW.id,'ready_for_collection',v_phone,
 jsonb_build_object(
 'customer_name',v_customer.full_name,'slip_no',v_measurement.slip_no,
 'bill_no',v_measurement.bill_no,
 'delivery_date',to_char(NEW.delivery_date,'DD Mon YYYY')))
 ON CONFLICT(measurement_id,event_type) DO NOTHING;
 RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION public.galoir_enqueue_ready_collection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER galoir_wa_ready_event AFTER UPDATE OF is_ready,status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.galoir_enqueue_ready_collection();
 
CREATE OR REPLACE FUNCTION public.galoir_set_whatsapp_enabled(p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF public.my_role()<>'admin' THEN
  RAISE EXCEPTION 'Only Admin can enable WhatsApp messaging' USING errcode='42501';
 END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'Enabled state required'; END IF;
 UPDATE public.settings SET whatsapp_enabled=p_enabled WHERE id=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings row missing'; END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),CASE WHEN p_enabled THEN 'whatsapp_notifications_enabled' ELSE 'whatsapp_notifications_disabled' END,'settings','1');
 RETURN p_enabled;
END;
$f$;
REVOKE ALL ON FUNCTION public.galoir_set_whatsapp_enabled(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.galoir_set_whatsapp_enabled(boolean) TO authenticated;

-- Preserve v3 for cached older app clients; the new billing UI calls v4.
CREATE OR REPLACE FUNCTION public.finalize_slip_billing_v4(p_measurement_id uuid, p_bill_no text, p_item_name text, p_delivery_date date, p_final_billing_amount numeric, p_paid_amount numeric, p_whatsapp_opt_in boolean DEFAULT false, p_product_barcode text DEFAULT NULL::text, p_override_token text DEFAULT NULL::text, p_design_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_slip public.measurements%rowtype;
 v_order_id uuid;
 v_bill text:=nullif(btrim(p_bill_no),'');
 v_item text:=nullif(btrim(p_item_name),'');
begin
 if not public.can_do('measurements') or not public.can_do('bookings') then
  raise exception 'Not authorized to complete billing' using errcode='42501';
 end if;
 if p_final_billing_amount IS NULL OR p_final_billing_amount<=0
    OR p_final_billing_amount>9999999999.99
    OR p_final_billing_amount <> round(p_final_billing_amount,2) THEN
   raise exception 'A valid final billing amount in rupees is required';
 end if;
 if p_paid_amount IS NULL OR p_paid_amount<0 OR p_paid_amount>p_final_billing_amount
    OR p_paid_amount<>round(p_paid_amount,2) THEN
   raise exception 'Paid amount must be between zero and the final billing amount, with up to two decimals';
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
 if p_design_number is not null and length(btrim(p_design_number))>100 then
   raise exception 'Design number is too long';
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
     design_number=coalesce(nullif(btrim(p_design_number),''),design_number),
     final_billing_amount=p_final_billing_amount,
     paid_amount=p_paid_amount,
     whatsapp_opt_in=coalesce(p_whatsapp_opt_in,false),
     whatsapp_opt_in_at=CASE WHEN coalesce(p_whatsapp_opt_in,false) THEN now() ELSE NULL END,
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
$function$;
REVOKE ALL ON FUNCTION public.finalize_slip_billing_v4(uuid,text,text,date,numeric,numeric,boolean,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_slip_billing_v4(uuid,text,text,date,numeric,numeric,boolean,text,text,text) TO authenticated;
