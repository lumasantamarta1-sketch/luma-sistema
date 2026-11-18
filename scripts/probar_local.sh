#!/usr/bin/env bash
# Recrea la base local, aplica las migraciones en orden y, si se pide, corre las pruebas.
# Uso: scripts/probar_local.sh [pruebas]
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql -h /home/claude/pg -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "drop database if exists luma with (force);" -c "create database luma;"
for r in anon authenticated service_role; do
  "${PSQL[@]}" -d postgres -c "do \$\$ begin if exists (select 1 from pg_roles where rolname = '$r') then execute 'drop owned by $r cascade'; end if; end \$\$;" >/dev/null 2>&1 || true
done
"${PSQL[@]}" -d luma -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end \$\$;"
sed -e '/^create role /d' "$RAIZ/supabase/local/00_supabase_stub.sql" | "${PSQL[@]}" -d luma
for f in "$RAIZ"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -d luma -f "$f"
done
if [[ "${1:-}" == "pruebas" ]]; then
  for t in "$RAIZ"/supabase/tests/*.sql; do
    echo "→ prueba $(basename "$t")"
    "${PSQL[@]}" -d luma -t -f "$t" 2>&1 | sed -n -e 's/^.*NOTICE:  /   /p' -e '/ERROR/p' -e '/FALLÓ/p'
  done
  for t in "$RAIZ"/supabase/tests/*.sh; do
    [[ -e "$t" ]] || continue
    echo "→ prueba $(basename "$t")"
    bash "$t"
  done
fi
echo "OK"
