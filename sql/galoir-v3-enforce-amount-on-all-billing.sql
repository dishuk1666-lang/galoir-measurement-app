-- Require the final billing amount on every new completed slip.
-- The updated app calls finalize_slip_billing_v3; earlier completion RPCs bypassed the amount requirement.
REVOKE EXECUTE ON FUNCTION public.finalize_slip_billing(uuid,text,text,date,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_slip_billing_v2(uuid,text,text,date,text,text,text) FROM PUBLIC,anon,authenticated;
-- Keep v3 accessible only to authenticated users; it performs role checks and amount validation.
REVOKE EXECUTE ON FUNCTION public.finalize_slip_billing_v3(uuid,text,text,date,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_slip_billing_v3(uuid,text,text,date,numeric,text,text,text) TO authenticated;
