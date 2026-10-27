-- GALOIR V3: master-room handoff, delivery checklist and GL slip barcode readiness.
-- No existing order status, slip numbers or customer records are rewritten.
ALTER TABLE public.orders
 ADD COLUMN IF NOT EXISTS master_room_sent_at timestamptz,
 ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Every barcode encodes the unique, already-assigned GL slip number.
-- The scanner only accepts a billed slip linked to a single order.
CREATE OR REPLACE FUNCTION public.mark_outfit_ready_by_slip(p_slip_no text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 v_slip text := upper(btrim(coalesce(p_slip_no,'')));
 v_order public.orders%rowtype;
 v_customer_name text;
BEGIN
 IF NOT public.can_do('daily') THEN
  RAISE EXCEPTION 'Not authorized to mark outfits ready' USING errcode='42501';
 END IF;
 IF v_slip !~ '^GL[0-9]{1,16}$' THEN
  RAISE EXCEPTION 'Scan a valid GALOIR slip barcode (GL followed by its number)';
 END IF;
 SELECT o.* INTO v_order FROM public.orders o
 JOIN public.measurements m ON m.id=o.measurement_id
 WHERE m.slip_no=v_slip AND m.workflow_status='billed' AND nullif(btrim(m.bill_no),'') IS NOT NULL
 FOR UPDATE OF o;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'No billed outfit booking found for slip %',v_slip;
 END IF;
 IF v_order.status='delivered' THEN
  RAISE EXCEPTION 'Outfit for % was already delivered',v_slip;
 END IF;
 IF NOT v_order.is_ready THEN
  UPDATE public.orders SET is_ready=true,ready_at=now(),updated_at=now()
    WHERE id=v_order.id;
  INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
   VALUES(auth.uid(),'outfit_scanned_ready','order',v_order.id::text);
 END IF;
 SELECT full_name INTO v_customer_name FROM public.customers WHERE id=v_order.customer_id;
 RETURN jsonb_build_object('slip_no',v_slip,'order_id',v_order.id,
   'customer_name',v_customer_name,'item_name',v_order.item_name,
   'already_ready',v_order.is_ready);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_outfit_ready_by_slip(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_outfit_ready_by_slip(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_master_room_sent(p_order_id uuid,p_sent boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_order public.orders%rowtype;
BEGIN
 IF NOT public.can_do('daily') THEN
  RAISE EXCEPTION 'Not authorized to update master-room work' USING errcode='42501';
 END IF;
 IF p_sent IS NULL THEN RAISE EXCEPTION 'Sent checkbox value is required'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Outfit booking not found'; END IF;
 IF v_order.order_type <> 'self_alter' THEN
  RAISE EXCEPTION 'Master-room handoff applies to Self Alter only';
 END IF;
 IF v_order.status='delivered' OR v_order.is_ready THEN
  RAISE EXCEPTION 'Delivered/ready outfits cannot change master-room handoff';
 END IF;
 IF (v_order.master_room_sent_at IS NOT NULL)=p_sent THEN RETURN; END IF;
 UPDATE public.orders SET master_room_sent_at=CASE WHEN p_sent THEN now() ELSE NULL END,updated_at=now()
 WHERE id=p_order_id;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),CASE WHEN p_sent THEN 'sent_to_master_room' ELSE 'master_room_handoff_reopened' END,'order',p_order_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.set_master_room_sent(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_master_room_sent(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_outfit_delivered(p_order_id uuid,p_delivered boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_order public.orders%rowtype;
BEGIN
 IF NOT public.can_do('daily') THEN
  RAISE EXCEPTION 'Not authorized to update deliveries' USING errcode='42501';
 END IF;
 IF p_delivered IS NULL THEN RAISE EXCEPTION 'Delivery checkbox value is required'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Outfit booking not found'; END IF;
 IF p_delivered THEN
  IF NOT v_order.is_ready THEN
   RAISE EXCEPTION 'Mark outfit READY first (tick Ready or scan its GL barcode)';
  END IF;
  IF v_order.status='delivered' THEN RETURN; END IF;
  UPDATE public.orders SET status='delivered', delivered_at=now(),updated_at=now()
  WHERE id=p_order_id;
 ELSE
  IF v_order.status<>'delivered' THEN RETURN; END IF;
  UPDATE public.orders SET status=CASE WHEN v_order.is_ready THEN 'ready' ELSE 'pending' END,
       delivered_at=NULL,updated_at=now()
  WHERE id=p_order_id;
 END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),CASE WHEN p_delivered THEN 'outfit_delivered' ELSE 'outfit_delivery_reopened' END,'order',p_order_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.set_outfit_delivered(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_outfit_delivered(uuid,boolean) TO authenticated;
