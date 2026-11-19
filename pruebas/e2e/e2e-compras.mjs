// Proveedores y compras de punta a punta. Corre después de e2e-dinero.mjs, sobre la misma base:
// Tienda Centro tiene 10 camisetas base M blancas; la Cuenta bancaria tiene $ 100.000.
import { iniciar } from "./ayudas.mjs";

const t = await iniciar("e2e-compras");
const { p, ok, foto, texto, falla, ir, esperarTexto, llenar, elegir, clic, casilla, clicHacia, ingresar } = t;
const agregar = async (sku) => {
  await llenar('input[aria-label="Buscar producto para comprar"]', sku);
  const hecho = await p.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => e.innerText.includes(s) && e.closest(".grid")); if (b) b.click(); return Boolean(b);
  }, sku);
  if (!hecho) await falla(`no apareció ${sku} en el buscador`);
};
const fijar = async (etiqueta, valor) => llenar(`input[aria-label="${etiqueta}"]`, valor);
const existencias = async (sku) => { await ir(`/inventario?q=${sku}`); return texto(); };
const BASE = "BASE-CR-CR-M-BLA";

await ingresar("admin@luma.local", "nueva-clave-456");

// 1. Proveedor
await ir("/proveedores");
await llenar("#nuevo-nombre", "Textiles del Caribe");
await llenar("#nuevo-nit", "900123456");
await llenar("#nuevo-telefono", "3015550000");
await clic("Registrar proveedor"); await esperarTexto("Proveedor «Textiles del Caribe» registrado");
ok("proveedor registrado");

// 2. Compra confirmada: 10 camisetas base y 20 transfer, con flete
await ir("/compras/nueva");
await elegir('select[aria-label="Proveedor"]', "Textiles del Caribe");
await elegir('select[aria-label="Punto de llegada"]', "Tienda Centro");
await agregar(BASE);
await fijar(`Cantidad de ${BASE}`, 10); await fijar(`Costo unitario de ${BASE}`, 12000);
await agregar("TRANSFER");
await fijar("Cantidad de TRANSFER", 20); await fijar("Costo unitario de TRANSFER", 3500);
await clic("Agregar costo adicional");
await fijar("Concepto del costo adicional", "Flete"); await fijar("Valor del costo adicional", 10000);
await esperarTexto("$ 200.000");
await foto("nueva-compra");
await clicHacia("Confirmar pedido (llega después)", "^/compras/[0-9a-f-]{36}$");
await esperarTexto("Compra confirmada");
await esperarTexto("Por recibir");
const compra = p.url().match(/compras\/([0-9a-f-]{36})/)[1];
ok("compra C- confirmada por $ 200.000 (con flete)");

// 3. Recepción parcial: llegan 6 de 10 camisetas y los 20 transfer
await fijar(`Recibidas de Camiseta base cuello redondo · Cuello redondo · M · Blanco (${BASE})`, 6);
await clic("Registrar recepción");
await esperarTexto("Mercancía recibida");
await esperarTexto("Recibida en parte");
await esperarTexto("costo final $ 12.632 c/u");
if (!/Tienda Centro\s*16/.test(await existencias(BASE))) await falla("debían quedar 16 camisetas base en Tienda Centro");
ok("recepción parcial: entran 6 camisetas a $ 12.632 c/u (flete repartido); quedan 4 pendientes");

// 4. Pago parcial desde el banco
await ir(`/compras/${compra}`);
await elegir("#cuenta-pago", "Cuenta bancaria");
await llenar("#valor-pago", 100000);
await llenar("#referencia-pago", "TRF-778");
await clic("Registrar pago");
await esperarTexto("Pago al proveedor registrado");
await esperarTexto("Por pagar");
ok("pago de $ 100.000 desde la cuenta bancaria");

// 5. Llega el resto y se devuelven 2 con defecto
await clic("Registrar recepción");
await esperarTexto("Mercancía recibida");
await esperarTexto("Recibida");
await fijar(`Devolver de Camiseta base cuello redondo · Cuello redondo · M · Blanco (${BASE})`, 2);
await llenar("#motivo-devolucion", "Llegaron manchadas");
await clic("Registrar devolución");
await esperarTexto("Devolución al proveedor registrada");
await esperarTexto("DP-");
await esperarTexto("$ 74.737");
if (!/Tienda Centro\s*18/.test(await existencias(BASE))) await falla("tras recibir 4 y devolver 2 debían quedar 18");
ok("llega el resto; se devuelven 2 manchadas: el saldo baja a $ 74.737 y salen del inventario");

// 6. No se paga más de lo que se debe
await ir(`/compras/${compra}`);
await elegir("#cuenta-pago", "Caja Tienda Centro");
await llenar("#valor-pago", 80000);
await p.$eval("#valor-pago", (e) => e.removeAttribute("max"));
await clic("Registrar pago");
await esperarTexto("El pago supera el saldo por pagar");
ok("no se paga más del saldo");

// 7. Borrador anulado y pedido para quien recibe
await ir("/compras/nueva");
await elegir('select[aria-label="Proveedor"]', "Textiles del Caribe");
await agregar("TRANSFER");
await fijar("Cantidad de TRANSFER", 5); await fijar("Costo unitario de TRANSFER", 3500);
await clicHacia("Guardar borrador", "^/compras/[0-9a-f-]{36}$");
await esperarTexto("Compra guardada como borrador");
await llenar("#motivo-anulacion", "Se pidió por error");
await clic("Anular compra"); await esperarTexto("Compra anulada");
await ir("/compras/nueva");
await elegir('select[aria-label="Proveedor"]', "Textiles del Caribe");
await elegir('select[aria-label="Punto de llegada"]', "Tienda Centro");
await agregar("TRANSFER");
await fijar("Cantidad de TRANSFER", 5); await fijar("Costo unitario de TRANSFER", 3500);
await clicHacia("Confirmar pedido (llega después)", "^/compras/[0-9a-f-]{36}$");
const pedido = p.url().match(/compras\/([0-9a-f-]{36})/)[1];
ok("borrador anulado con motivo; pedido de 5 transfer por recibir");

// 8. Encargado de inventario: recibe sin ver costos
await ir("/usuarios");
await llenar("#nuevo-usuario input[name=nombre]", "Bodega Prueba"); await llenar("#nuevo-usuario input[name=correo]", "bodega@luma.local");
await llenar("#nuevo-usuario input[name=clave]", "temporal-321");
await elegir("#nuevo-usuario select[name=rol_id]", "Encargado de inventario");
await p.evaluate(() => { const l = [...document.querySelectorAll("#nuevo-usuario label")].find((e) => e.innerText.trim() === "Tienda Centro"); l?.querySelector("input")?.click(); });
await clic("Crear usuario"); await esperarTexto("ya puede ingresar");
await ingresar("bodega@luma.local", "temporal-321");
await llenar("input[name=clave]", "bodega-654"); await llenar("input[name=confirmacion]", "bodega-654");
await clicHacia("Guardar contraseña", "^/$");
await ir("/compras");
await esperarTexto("Compras por recibir");
await esperarTexto("5 unidad(es) pendientes");
if ((await texto()).includes("$")) await falla("quien recibe no debe ver valores");
await ir(`/compras/${pedido}/recibir`);
await clic("Registrar recepción");
await esperarTexto("Mercancía recibida");
await ir(`/compras/${pedido}`);
if (!p.url().endsWith("/sin-permiso")) await falla("quien recibe no debe abrir el detalle con costos");
await ir("/proveedores");
await esperarTexto("Textiles del Caribe");
if ((await texto()).includes("Por pagar")) await falla("quien recibe no debe ver lo que se le debe al proveedor");
await foto("recepcion");
ok("encargado de inventario: ve y recibe el pedido sin ver costos ni deudas");

await t.terminar();
