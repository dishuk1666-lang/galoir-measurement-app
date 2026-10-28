-- Allow measurement-authorized staff (including the shared Sales login)
-- to continue any UNBILLED draft displayed by the application.
-- Existing workflow_status='draft' remains mandatory; billed slips cannot be edited.
-- The original save_measurement_draft permission check at function entry is preserved.
DO $$
DECLARE fn text;
        old_where text := 'and (created_by=auth.uid() or public.my_role()=''admin'')';
        new_where text := 'and public.can_do(''measurements'')';
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO fn
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='save_measurement_draft'
   AND pg_get_function_identity_arguments(p.oid)='p_payload jsonb, p_measurement_id uuid';
 IF fn IS NULL THEN RAISE EXCEPTION 'Expected draft function signature not found'; END IF;
 IF position(old_where in fn)=0 THEN
  IF position(new_where in fn)>0 THEN RETURN; END IF;
  RAISE EXCEPTION 'Draft authorization logic has changed; review before applying';
 END IF;
 fn:=replace(fn,old_where,new_where);
 EXECUTE fn;
END $$;
-- No new permissions granted: still callable only by a user who passes can_do('measurements').
