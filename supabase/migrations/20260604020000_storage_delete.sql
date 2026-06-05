drop policy if exists "members can delete report assets" on storage.objects;
create policy "members can delete report assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report-assets'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
);
