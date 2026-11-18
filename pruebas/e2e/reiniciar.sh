#!/usr/bin/env bash
# Deja la base local limpia (migraciones + administrador de prueba) y recarga PostgREST
set -euo pipefail
cd /home/claude/luma-sistema && ./scripts/probar_local.sh >/dev/null
psql -h /home/claude/pg -p 54329 -U postgres -d luma -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter table auth.users add column if not exists banned_until timestamptz;
create table if not exists auth.pruebas_claves (id uuid primary key, clave text not null);
grant anon, authenticated, service_role to authenticator;
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@luma.local', '{"nombre": "Luis (prueba)"}');
select app.promover_administrador('admin@luma.local');
SQL
pkill -f "postgrest postgrest.conf" || true
while pgrep -f "postgrest postgrest.conf" >/dev/null; do sleep 0.3; done
cd /home/claude/herramientas && (setsid nohup ./postgrest postgrest.conf > /tmp/postgrest.log 2>&1 &)
until curl -s -o /dev/null http://127.0.0.1:3001/; do sleep 0.3; done
