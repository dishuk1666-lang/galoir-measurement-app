-- GALOIR slip history + safe reuse of deleted, unbilled draft numbers.
-- Only NEW deletions of an unbilled draft become reusable. Historic gaps are NOT
-- blindly reclaimed (some could have been printed before the history was added).
CREATE TABLE IF NOT EXISTS public.galoir_reusable_slip_numbers(
  slip_number bigint PRIMARY KEY CHECK(slip_number>=2001),
  released_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.galoir_reusable_slip_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.galoir_reusable_slip_numbers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.galoir_reusable_slip_numbers TO service_role;

CREATE TABLE IF NOT EXISTS public.galoir_slip_number_history(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slip_no text NOT NULL CHECK(slip_no ~ '^GL[0-9]+$'),
  measurement_id uuid,
  customer_id uuid,
  event_type text NOT NULL CHECK(event_type IN ('created','reused','billed','deleted')),
  actor_id uuid,
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS galoir_slip_history_number_idx ON public.galoir_slip_number_history(slip_no,happened_at DESC);
CREATE INDEX IF NOT EXISTS galoir_slip_history_recent_idx ON public.galoir_slip_number_history(happened_at DESC,id DESC);
ALTER TABLE public.galoir_slip_number_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.galoir_slip_number_history FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.galoir_slip_number_history TO service_role;

CREATE OR REPLACE FUNCTION public.allocate_galoir_slip_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE n bigint;
BEGIN
  -- Serialise all allocations AND pool releases, including overlapping staff saves.
  PERFORM pg_catalog.pg_advisory_xact_lock(79013,2001);
  SELECT slip_number INTO n
    FROM public.galoir_reusable_slip_numbers ORDER BY slip_number LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    DELETE FROM public.galoir_reusable_slip_numbers WHERE slip_number=n;
  ELSE
    n:=nextval('public.galoir_slip_seq'::regclass);
  END IF;
  RETURN 'GL'||n::text;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_galoir_slip_number() FROM PUBLIC,anon,authenticated;

-- History applies to normal, billed and imported GL slips.
CREATE OR REPLACE FUNCTION public.record_galoir_slip_number_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE event_name text;
BEGIN
 IF TG_OP='INSERT' THEN
  event_name:=CASE WHEN EXISTS(
   SELECT 1 FROM public.galoir_slip_number_history h
   WHERE h.slip_no=NEW.slip_no AND h.event_type='deleted'
  ) THEN 'reused' ELSE 'created' END;
  INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id,happened_at)
   VALUES(NEW.slip_no,NEW.id,NEW.customer_id,event_name,auth.uid(),NEW.created_at);
  IF NEW.workflow_status='billed' THEN
   INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id,happened_at)
    VALUES(NEW.slip_no,NEW.id,NEW.customer_id,'billed',auth.uid(),coalesce(NEW.billed_at,NEW.created_at));
  END IF;
 ELSIF TG_OP='UPDATE' AND OLD.workflow_status IS DISTINCT FROM 'billed' AND NEW.workflow_status='billed' THEN
  INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id,happened_at)
    VALUES(NEW.slip_no,NEW.id,NEW.customer_id,'billed',auth.uid(),coalesce(NEW.billed_at,now()));
 ELSIF TG_OP='DELETE' THEN
  IF OLD.workflow_status<>'draft' OR nullif(btrim(OLD.bill_no),'') IS NOT NULL OR
   EXISTS(SELECT 1 FROM public.orders WHERE measurement_id=OLD.id)
  THEN RAISE EXCEPTION 'Only unbilled, unbooked drafts can release a GL number';
  END IF;
  -- Deletion and number reuse eligibility are committed atomically.
  PERFORM pg_catalog.pg_advisory_xact_lock(79013,2001);
  INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id)
   VALUES(OLD.slip_no,OLD.id,OLD.customer_id,'deleted',auth.uid());
  INSERT INTO public.galoir_reusable_slip_numbers(slip_number)
   VALUES(substring(OLD.slip_no from 3)::bigint)
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN coalesce(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.record_galoir_slip_number_history() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trigger_record_galoir_slip_insert ON public.measurements;
CREATE TRIGGER trigger_record_galoir_slip_insert
 AFTER INSERT ON public.measurements FOR EACH ROW EXECUTE FUNCTION public.record_galoir_slip_number_history();
DROP TRIGGER IF EXISTS trigger_record_galoir_slip_bill ON public.measurements;
CREATE TRIGGER trigger_record_galoir_slip_bill
 AFTER UPDATE OF workflow_status ON public.measurements FOR EACH ROW EXECUTE FUNCTION public.record_galoir_slip_number_history();
DROP TRIGGER IF EXISTS trigger_record_galoir_slip_delete ON public.measurements;
CREATE TRIGGER trigger_record_galoir_slip_delete
 BEFORE DELETE ON public.measurements FOR EACH ROW EXECUTE FUNCTION public.record_galoir_slip_number_history();

-- Preserve the history of existing billed and draft slips without touching IDs.
INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id,happened_at)
SELECT m.slip_no,m.id,m.customer_id,'created',m.created_by,m.created_at
FROM public.measurements m
WHERE NOT EXISTS (SELECT 1 FROM public.galoir_slip_number_history h WHERE h.measurement_id=m.id AND h.event_type='created');
INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id,happened_at)
SELECT m.slip_no,m.id,m.customer_id,'billed',m.billed_by,coalesce(m.billed_at,m.updated_at,m.created_at)
FROM public.measurements m WHERE m.workflow_status='billed'
AND NOT EXISTS (SELECT 1 FROM public.galoir_slip_number_history h WHERE h.measurement_id=m.id AND h.event_type='billed');
-- Also show old deletion audit entries, but do not reissue historic numbers.
INSERT INTO public.galoir_slip_number_history(slip_no,measurement_id,customer_id,event_type,actor_id,happened_at)
SELECT a.target_id,NULL,NULL,'deleted',a.actor_id,a.created_at
FROM public.audit_log a
WHERE a.event='unbilled_measurement_slip_deleted' AND a.target_id ~ '^GL[0-9]+$'
AND NOT EXISTS (SELECT 1 FROM public.galoir_slip_number_history h WHERE h.slip_no=a.target_id AND h.event_type='deleted' AND h.happened_at=a.created_at);

-- Replace the old nextval default; this only changes future allocations.
ALTER TABLE public.measurements
 ALTER COLUMN slip_no SET DEFAULT public.allocate_galoir_slip_number();

CREATE OR REPLACE FUNCTION public.get_galoir_slip_history()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF auth.uid() IS NULL OR public.my_role() NOT IN ('admin','manager') THEN
  RAISE EXCEPTION 'Only Admin and Manager can review slip history' USING errcode='42501';
 END IF;
 RETURN jsonb_build_object(
  'next_number', (
    SELECT 'GL'||coalesce(
      (SELECT min(slip_number) FROM public.galoir_reusable_slip_numbers),
      (SELECT last_value+1 FROM public.galoir_slip_seq)
    )::text
  ),
  'available_count',(SELECT count(*) FROM public.galoir_reusable_slip_numbers),
  'events',coalesce((
    SELECT jsonb_agg(row_to_json(x)) FROM (
      SELECT h.slip_no,h.event_type,h.happened_at,
        c.full_name AS customer_name,
        m.bill_no,m.workflow_status,
        p.full_name AS performed_by
      FROM public.galoir_slip_number_history h
      LEFT JOIN public.customers c ON c.id=h.customer_id
      LEFT JOIN public.measurements m ON m.id=h.measurement_id
      LEFT JOIN public.profiles p ON p.id=h.actor_id
      ORDER BY h.happened_at DESC,h.id DESC
      LIMIT 500
    ) x
  ),'[]'::jsonb)
 );
END;
$$;
REVOKE ALL ON FUNCTION public.get_galoir_slip_history() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_galoir_slip_history() TO authenticated;
