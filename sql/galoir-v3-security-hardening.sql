-- GALOIR V3 hardening: only authenticated, role-checked RPC may create numbered measurement slips.
-- No direct client INSERT can assign or bypass GL slip numbers.
REVOKE INSERT ON public.measurements FROM authenticated;
REVOKE USAGE ON SEQUENCE public.galoir_slip_seq FROM authenticated;
ALTER TABLE public.measurements
  ADD CONSTRAINT measurements_slip_no_format
  CHECK (slip_no ~ '^GL[0-9]+$');

-- iPhone camera/gallery can produce HEIC or HEIF; continue keeping the bucket PRIVATE.
UPDATE storage.buckets SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp','image/heic','image/heif',
  'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-m4a','video/mp4'
]::text[]
WHERE id = 'galoir-measurement-media';
