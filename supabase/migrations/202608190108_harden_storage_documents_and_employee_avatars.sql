-- Close generic authenticated access to the private documents bucket until a
-- tenant-aware document workflow exists.
drop policy if exists authenticated_documents_access on storage.objects;
revoke all on table storage.objects from anon;

-- Employee avatars are public display assets, but one authenticated account
-- must not be able to overwrite an object uploaded by another account.
drop policy if exists "Authenticated users update employee avatars" on storage.objects;
create policy "Owners update employee avatars"
on storage.objects for update to authenticated
using (bucket_id = 'employee-avatars' and owner_id = auth.uid()::text)
with check (bucket_id = 'employee-avatars' and owner_id = auth.uid()::text);

-- Bound avatar uploads to image payloads and a reasonable size.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']::text[]
where id = 'employee-avatars';

-- Private operational-photo buckets should reject arbitrary executable/binary payloads.
update storage.buckets
set file_size_limit = coalesce(file_size_limit, 10485760),
    allowed_mime_types = coalesce(allowed_mime_types, array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[])
where id in ('property-photos','work-photos','task-photos','before-after');
