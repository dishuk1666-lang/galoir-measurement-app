-- GALOIR V3 measurement slip: secure reference video attachments.
-- Existing photo/voice uploads remain supported; records are not modified.
ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS video_path text;

-- 40 MiB accommodates short fitting videos. The bucket remains private.
UPDATE storage.buckets
SET file_size_limit=41943040,
    allowed_mime_types=ARRAY[
      'image/jpeg','image/png','image/webp','image/heic','image/heif',
      'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-m4a',
      'video/mp4','video/quicktime','video/webm','video/x-m4v'
    ]::text[]
WHERE id='galoir-measurement-media';

-- Upload must go into a GL slip owned by the signed-in staff account, or be uploaded by Admin.
ALTER POLICY galoir_measurement_media_upload ON storage.objects
WITH CHECK (
  bucket_id='galoir-measurement-media'
  AND public.can_do('measurements')
  AND name ~ '^[0-9a-f-]{36}/(photo|voice|video)-[0-9a-f-]{36}\.[a-z0-9]+$'
  AND EXISTS (
    SELECT 1 FROM public.measurements m
    WHERE m.id=split_part(name,'/',1)::uuid
      AND (m.created_by=auth.uid() OR public.my_role()='admin')
  )
);

-- Attach the uploaded video to the slip (same ownership and audit rules as photos/voice).
CREATE OR REPLACE FUNCTION public.attach_measurement_media(
  p_measurement_id uuid,p_kind text,p_path text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT public.can_do('measurements') THEN
   RAISE EXCEPTION 'Not authorized' USING errcode='42501';
 END IF;
 IF p_kind NOT IN ('photo','voice','video') OR p_kind IS NULL
    OR p_path !~ '^[0-9a-f-]{36}/(photo|voice|video)-[0-9a-f-]{36}\.[a-z0-9]+$'
    OR split_part(p_path,'/',1)<>p_measurement_id::text
    OR split_part(split_part(p_path,'/',2),'-',1)<>p_kind THEN
   RAISE EXCEPTION 'Invalid media path';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM storage.objects
   WHERE bucket_id='galoir-measurement-media' AND name=p_path
 ) THEN
   RAISE EXCEPTION 'Media file was not uploaded';
 END IF;
 IF p_kind='photo' THEN
   UPDATE public.measurements SET photo_path=p_path
   WHERE id=p_measurement_id AND (created_by=auth.uid() OR public.my_role()='admin');
 ELSIF p_kind='voice' THEN
   UPDATE public.measurements SET voice_path=p_path
   WHERE id=p_measurement_id AND (created_by=auth.uid() OR public.my_role()='admin');
 ELSE
   UPDATE public.measurements SET video_path=p_path
   WHERE id=p_measurement_id AND (created_by=auth.uid() OR public.my_role()='admin');
 END IF;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Measurement not found or not authorized';
 END IF;
 INSERT INTO public.audit_log(actor_id,event,target_type,target_id)
 VALUES(auth.uid(),'measurement_'||p_kind||'_attached','measurement',p_measurement_id::text);
END;
$$;
REVOKE ALL ON FUNCTION public.attach_measurement_media(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attach_measurement_media(uuid,text,text) TO authenticated;
