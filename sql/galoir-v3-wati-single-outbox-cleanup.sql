-- Consolidate WATI integration on GALOIR's existing outbox + admin controls.
-- Remove duplicate outbox and triggers created by the experimental dispatcher.
-- Preserve the active galoir_whatsapp_outbox, paid_amount, WhatsApp opt-in,
-- final billing v4, and ready/status synchronization.
DO $$
BEGIN
 IF (SELECT count(*) FROM public.wati_notification_outbox) <> 0 THEN
  RAISE EXCEPTION 'Cannot remove duplicate WATI outbox because it contains notification records';
 END IF;
END $$;
DROP TRIGGER IF EXISTS trigger_queue_wati_billed ON public.measurements;
DROP TRIGGER IF EXISTS trigger_queue_wati_ready ON public.orders;
DROP FUNCTION IF EXISTS public.queue_wati_billed_order();
DROP FUNCTION IF EXISTS public.queue_wati_outfit_ready();
DROP FUNCTION IF EXISTS public.finalize_slip_billing_with_payment(uuid,text,text,date,numeric,numeric,boolean,text,text,text);
DROP TABLE IF EXISTS public.wati_notification_outbox;
-- Keep sync_galoir_tailor_ready so Ready status flips the CRM Ready flag.
