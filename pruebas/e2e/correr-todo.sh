#!/usr/bin/env bash
# Levanta lo necesario, deja la base limpia y corre el recorrido base y el de ventas
set -uo pipefail
cd /home/claude/herramientas
su pgrun -c "export PATH=/usr/lib/postgresql/16/bin:\$PATH; cd /home/claude/pg; pg_ctl -D data -o '-p 54329 -k /home/claude/pg' -l log.txt status" >/dev/null 2>&1 \
  || su pgrun -c "export PATH=/usr/lib/postgresql/16/bin:\$PATH; cd /home/claude/pg; pg_ctl -D data -o '-p 54329 -k /home/claude/pg' -l log.txt -w start" >/dev/null
./reiniciar.sh >/dev/null 2>&1
pgrep -f "node supabase-local.mjs" >/dev/null || (setsid nohup node supabase-local.mjs > /tmp/mock.log 2>&1 &)
if ! curl -s -o /dev/null http://localhost:3100/ingresar; then
  (cd /home/claude/luma-sistema && NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local \
    SUPABASE_SECRET_KEY=sb_secret_local NEXT_PUBLIC_SITE_URL= PORT=3100 setsid nohup npx next start -p 3100 > /tmp/next.log 2>&1 &)
fi
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3100/ingresar && curl -s -o /dev/null http://localhost:54321/ && break; sleep 1; done
timeout 400 node e2e.mjs > /tmp/e2e-base.log 2>&1 || { tail -30 /tmp/e2e-base.log; exit 1; }
tail -2 /tmp/e2e-base.log
timeout 500 node e2e-ventas.mjs > /tmp/e2e-ventas.log 2>&1 || { tail -30 /tmp/e2e-ventas.log; exit 1; }
grep -E "^ok|FALLÓ|Errores|Sin errores" /tmp/e2e-ventas.log
for extra in e2e-dinero.mjs e2e-compras.mjs e2e-informes.mjs; do
  [[ -e "$extra" ]] || continue
  timeout 500 node "$extra" > "/tmp/${extra%.mjs}.log" 2>&1 || { tail -40 "/tmp/${extra%.mjs}.log"; exit 1; }
  grep -E "^ok|FALLÓ|Errores|Sin errores|consola|pageerror" "/tmp/${extra%.mjs}.log"
done
