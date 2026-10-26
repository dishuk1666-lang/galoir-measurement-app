-- Only active Admins can permanently delete a draft slip that has never been billed or booked.
-- The app removes any private Storage files first. The RPC rejects deletion if files remain.
CREATE OR REPLACE FUNCTION public.admin_delete_unbilled_slip(p_measurement_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_id uuid;
  v_slip_no text;
  v_status text;
  v_bill_no text;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an active Admin may delete an unbilled slip'
      USING errcode='42501';
  END IF;
  IF p_measurement_id IS NULL THEN
    RAISE EXCEPTION 'A measurement slip ID is required';
  END IF;

  SELECT id, slip_no, workflow_status, bill_no
    INTO v_id, v_slip_no, v_status, v_bill_no
  FROM public.measurements WHERE id=p_measurement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Measurement slip not found';
  END IF;
  IF v_status <> 'draft' OR NULLIF(btrim(v_bill_no),'') IS NOT NULL THEN
    RAISE EXCEPTION 'Billed slips cannot be deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE measurement_id=v_id) THEN
    RAISE EXCEPTION 'A slip linked to a delivery booking cannot be deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id='galoir-measurement-media'
      AND name LIKE v_id::text || '/%'
  ) THEN
    RAISE EXCEPTION 'Remove the slip attachments from private storage before deleting';
  END IF;

  DELETE FROM public.measurements WHERE id=v_id;
  INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
  VALUES(auth.uid(),'unbilled_measurement_slip_deleted','measurement',v_slip_no);
  RETURN v_slip_no;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_unbilled_slip(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_unbilled_slip(uuid)
  TO authenticated;

-- Delete permission for the Supabase Storage API only, for unbilled/unbooked draft folders.
CREATE POLICY galoir_measurement_media_admin_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id='galoir-measurement-media'
  AND public.my_role()='admin'
  AND EXISTS (
    SELECT 1 FROM public.measurements m
    WHERE m.id::text=split_part(name,'/',1)
      AND m.workflow_status='draft'
      AND NULLIF(btrim(m.bill_no),'') IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.measurement_id=m.id)
  )
);
