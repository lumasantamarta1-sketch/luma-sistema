-- =====================================================================
-- LUMA · 16 · Archivos: depósito privado "adjuntos" para fotos, facturas y soportes.
-- Ruta de cada archivo: <documento_tipo>/<documento_id>/<nombre>. Se ven y se suben con
-- el permiso del documento al que pertenecen; no se reemplazan ni se borran.
-- Solo aplica en Supabase (en la base local de pruebas no existe el esquema storage).
-- =====================================================================

create function app.uuid_o_nulo(p_texto text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p_texto::uuid;
exception when others then
  return null;
end $$;
revoke execute on function app.uuid_o_nulo(text) from public, anon;
grant execute on function app.uuid_o_nulo(text) to authenticated;

do $do$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'Sin esquema storage: se omite la configuración de archivos.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('adjuntos', 'adjuntos', false, 10485760,
          array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy adjuntos_leer on storage.objects for select to authenticated
    using (bucket_id = 'adjuntos'
           and app.puede_ver_documento(split_part(name, '/', 1), app.uuid_o_nulo(split_part(name, '/', 2))))
  $p$;
  execute $p$
    create policy adjuntos_subir on storage.objects for insert to authenticated
    with check (bucket_id = 'adjuntos'
                and app.puede_adjuntar(split_part(name, '/', 1), app.uuid_o_nulo(split_part(name, '/', 2))))
  $p$;
end
$do$;
