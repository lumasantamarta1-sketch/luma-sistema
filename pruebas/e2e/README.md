# Prueba de punta a punta en navegador (uso local)

Recorre la aplicación en Chrome contra la base de datos local, sin tocar Supabase:
ingreso y cambio de contraseña, puntos de venta, usuarios, catálogos, productos y variantes,
recetas, saldo inicial, estampado (costo real $ 15.500), kardex, traslados y los límites del vendedor.

Piezas:
- `supabase-local.mjs`: imita la API de Supabase en `http://localhost:54321`. `/rest/v1` va a PostgREST real
  sobre la base local; `/auth/v1` es un Auth simulado con JWT HS256 (solo para pruebas).
- `postgrest.conf`: PostgREST 12 apuntando a la base `luma` local.
- `reiniciar.sh`: recrea la base con las migraciones y crea el administrador de prueba.
- `e2e.mjs`: el recorrido con puppeteer-core y el Chrome del equipo.
- `e2e-ventas.mjs`: el módulo de ventas, sobre lo que deja `e2e.mjs`: venta de mostrador con cambio y entrega
  inmediata, bloqueo por falta de existencias, cotización con cliente nuevo editada y confirmada con abono,
  entrega a crédito solo con permiso, promoción autorizada, pedido personalizado por estampar, devolución con
  reembolso, comprobante interno y lo que la vendedora no puede ver.
- `ayudas.mjs`: funciones compartidas por los recorridos (ingresar, llenar, elegir, esperar texto…).
- `e2e-dinero.mjs`: gastos (pagado, por pagar, anulado, fijos y categorías) y caja (traslado, retiro sin fondos,
  cierre con diferencia justificada, cuentas y métodos de pago).
- `e2e-compras.mjs`: proveedores y compras (confirmar, recepción parcial con flete repartido en el costo, pago,
  devolución al proveedor, anulación) y la recepción sin costos del encargado de inventario.
- `e2e-informes.mjs`: panel de inicio, informes de ventas, resultado e inventario, exportaciones CSV y permisos.
- `correr-todo.sh`: levanta la base, el simulador y la app (si no están) y corre todos los recorridos en orden.

Requisitos: PostgreSQL 16+, PostgREST 12, Node 22, Chrome, y `npm i pg puppeteer-core` en esta carpeta.
La aplicación se compila con `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` y se sirve en el puerto 3100.
Las rutas de la base local están fijadas para el equipo de trabajo; ajústalas si cambian.
