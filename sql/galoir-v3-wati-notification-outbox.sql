-- GALOIR / WATI: invoice deposits, WhatsApp consent and transaction-only outbox.
-- Safety: no customer messages are sent from SQL; no credentials are stored in the database.
-- Existing billed slips retain NULL paid_amount and opt-out status, and are never backfilled/sent.
ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opted_in_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='measurements_paid_amount_valid') THEN
    ALTER TABLE public.measurements ADD CONSTRAINT measurements_paid_amount_valid
      CHECK (paid_amount IS NULL OR (paid_amount >= 0 AND final_billing_amount IS NOT NULL AND paid_amount <= final_billing_amount));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.wati_notification_outbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('order_confirmed','ready_for_collection')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','accepted','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  locked_at timestamptz,
  accepted_at timestamptz,
  wati_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wati_one_event_per_slip UNIQUE (measurement_id,event_type)
);
CREATE INDEX IF NOT EXISTS wati_outbox_pending_idx ON public.wati_notification_outbox(status,created_at);
ALTER TABLE public.wati_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wati_notification_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.wati_notification_outbox TO service_role;
-- Only the service role, in the secured Supabase Edge Function, can inspect or dispatch queued notifications.

CREATE OR REPLACE FUNCTION public.queue_wati_billed_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_order_id uuid;
BEGIN
 IF NEW.workflow_status='billed' AND NEW.whatsapp_opt_in AND NEW.paid_amount IS NOT NULL
    AND nullif(btrim(NEW.bill_no),'') IS NOT NULL
    AND (OLD.workflow_status IS DISTINCT FROM 'billed' OR OLD.whatsapp_opt_in IS DISTINCT FROM TRUE) THEN
   SELECT id INTO v_order_id FROM public.orders WHERE measurement_id=NEW.id LIMIT 1;
   IF v_order_id IS NOT NULL THEN
     INSERT INTO public.wati_notification_outbox(measurement_id,order_id,event_type)
     VALUES(NEW.id,v_order_id,'order_confirmed') ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_wati_billed_order() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trigger_queue_wati_billed ON public.measurements;
CREATE TRIGGER trigger_queue_wati_billed
 AFTER UPDATE OF workflow_status,whatsapp_opt_in ON public.measurements
 FOR EACH ROW EXECUTE FUNCTION public.queue_wati_billed_order();

CREATE OR REPLACE FUNCTION public.queue_wati_outfit_ready()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_measurement public.measurements%rowtype;
BEGIN
 IF NEW.is_ready AND OLD.is_ready IS DISTINCT FROM TRUE AND NEW.status <> 'delivered'
    AND NEW.measurement_id IS NOT NULL THEN
   SELECT * INTO v_measurement FROM public.measurements
     WHERE id=NEW.measurement_id AND workflow_status='billed' AND whatsapp_opt_in
       AND paid_amount IS NOT NULL AND nullif(btrim(bill_no),'') IS NOT NULL;
   IF FOUND THEN
     INSERT INTO public.wati_notification_outbox(measurement_id,order_id,event_type)
     VALUES(NEW.measurement_id,NEW.id,'ready_for_collection') ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_wati_outfit_ready() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trigger_queue_wati_ready ON public.orders;
CREATE TRIGGER trigger_queue_wati_ready
 AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.queue_wati_outfit_ready();

-- Bring tailoring's "ready" state into sync with the CRM Ready flag; the
-- AFTER UPDATE outbox trigger sees the final NEW.is_ready value.
CREATE OR REPLACE FUNCTION public.sync_galoir_tailor_ready()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$
BEGIN
 IF NEW.status='ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
   NEW.is_ready:=true;
   NEW.ready_at:=coalesce(NEW.ready_at,now());
 ELSIF OLD.status='ready' AND NEW.status IN ('alteration','trial','stitching','pending') THEN
   NEW.is_ready:=false;
   NEW.ready_at:=NULL;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_sync_galoir_tailor_ready ON public.orders;
CREATE TRIGGER trigger_sync_galoir_tailor_ready
 BEFORE UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.sync_galoir_tailor_ready();

-- New billing RPC is additive. It calls the existing capacity/amount-protected
-- billing RPC and then stores payment + consent in the SAME database transaction.
-- The existing RPC remains usable by old clients but does not enqueue messages.
CREATE OR REPLACE FUNCTION public.finalize_slip_billing_with_payment(
 p_measurement_id uuid,
 p_bill_no text,
 p_item_name text,
 p_delivery_date date,
 p_final_billing_amount numeric,
 p_paid_amount numeric,
 p_whatsapp_opt_in boolean,
 p_product_barcode text DEFAULT NULL,
 p_override_token text DEFAULT NULL,
 p_design_number text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.can_do('measurements') OR NOT public.can_do('bookings') THEN
  RAISE EXCEPTION 'Not authorized to finalize billing' USING errcode='42501';
 END IF;
 IF p_paid_amount IS NULL OR p_paid_amount<0 OR p_paid_amount>p_final_billing_amount
    OR p_paid_amount <> round(p_paid_amount,2) THEN
  RAISE EXCEPTION 'Paid amount must be between ₹0 and total billing amount, with up to two decimals';
 END IF;
 IF p_whatsapp_opt_in IS NULL THEN RAISE EXCEPTION 'WhatsApp consent choice is required'; END IF;

 v_result:=public.finalize_slip_billing_v3(
   p_measurement_id,p_bill_no,p_item_name,p_delivery_date,p_final_billing_amount,
   p_product_barcode,p_override_token,p_design_number
 );
 UPDATE public.measurements
 SET paid_amount=p_paid_amount,
     whatsapp_opt_in=p_whatsapp_opt_in,
     whatsapp_opted_in_at=CASE WHEN p_whatsapp_opt_in THEN now() ELSE NULL END,
     updated_at=now()
 WHERE id=p_measurement_id AND workflow_status='billed';
 IF NOT FOUND THEN RAISE EXCEPTION 'Could not save payment details'; END IF;
 RETURN v_result || jsonb_build_object('paid_amount',p_paid_amount,
  'balance_amount',p_final_billing_amount-p_paid_amount,
  'whatsapp_opt_in',p_whatsapp_opt_in);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_slip_billing_with_payment(uuid,text,text,date,numeric,numeric,boolean,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_slip_billing_with_payment(uuid,text,text,date,numeric,numeric,boolean,text,text,text) TO authenticated;
