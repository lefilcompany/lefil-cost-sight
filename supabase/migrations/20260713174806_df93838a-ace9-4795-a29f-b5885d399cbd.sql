CREATE POLICY "authenticated read platform-images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'platform-images');

CREATE POLICY "authenticated upload platform-images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'platform-images');

CREATE POLICY "authenticated update platform-images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'platform-images');

CREATE POLICY "authenticated delete platform-images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'platform-images');