// Gastos y caja de punta a punta. Corre después de e2e-ventas.mjs, sobre la misma base:
// la Caja Tienda Centro tiene $ 155.500 y Nequi $ 50.000.
import { iniciar } from "./ayudas.mjs";

const t = await iniciar("e2e-dinero");
const { p, ok, foto, texto, falla, ir, esperarTexto, llenar, elegir, clic, casilla, clicHacia, ingresar } = t;
const saldo = async (cuenta) => {
  await ir("/caja");
  const m = (await texto()).match(new RegExp(`${cuenta}\\s+\\$ ([\\d.]+)`));
  return m ? Number(m[1].replace(/\./g, "")) : null;
};

await ingresar("admin@luma.local", "nueva-clave-456");
if ((await saldo("Caja Tienda Centro")) !== 155500) await falla("la caja debía empezar en $ 155.500");
ok("saldos de partida: caja $ 155.500");

// 1. Gasto pagado en efectivo desde la caja del punto
await ir("/gastos/nuevo");
await elegir("select[name=categoria_id]", "Transporte");
await llenar("input[name=descripcion]", "Taxi con mercancía");
await llenar("input[name=valor]", 12000);
await elegir("select[name=bodega_id]", "Tienda Centro");
await elegir("select[name=metodo_pago_id]", "Efectivo");
await clicHacia("Registrar gasto", "^/gastos/[0-9a-f-]{36}$");
await esperarTexto("Gasto registrado.");
await esperarTexto("Pagado");
const gasto1 = p.url().match(/gastos\/([0-9a-f-]{36})/)[1];
if ((await saldo("Caja Tienda Centro")) !== 143500) await falla("tras el gasto la caja debía quedar en $ 143.500");
ok("gasto de $ 12.000 pagado en efectivo: la caja baja a $ 143.500");

// 2. Gasto por pagar y pago posterior por Nequi
await ir("/gastos/nuevo");
await elegir("select[name=categoria_id]", "Empaques");
await llenar("input[name=descripcion]", "Bolsas con logo");
await llenar("input[name=valor]", 20000);
await casilla("Ya se pagó", false);
await clicHacia("Registrar gasto", "^/gastos/[0-9a-f-]{36}$");
await esperarTexto("Por pagar");
await elegir("select[name=metodo_pago_id]", "Nequi");
await llenar("input[name=referencia]", "NQ-55");
await clic("Pagar");
await esperarTexto("Gasto pagado");
if ((await saldo("Nequi")) !== 30000) await falla("Nequi debía quedar en $ 30.000");
ok("gasto por pagar de $ 20.000, pagado luego por Nequi");

// 3. Anular el gasto pagado devuelve el dinero
await ir(`/gastos/${gasto1}`);
await llenar("#motivo-anulacion", "Se registró por error");
await clic("Anular gasto");
await esperarTexto("Gasto anulado");
if ((await saldo("Caja Tienda Centro")) !== 155500) await falla("la anulación debía devolver los $ 12.000 a la caja");
ok("anular un gasto pagado devuelve el dinero a la caja");

// 4. Soporte: sin almacenamiento local se informa el error sin romper la página
await ir(`/gastos/${gasto1}`);
await esperarTexto("Soportes");

// 5. Categoría nueva y gasto fijo mensual
await ir("/gastos/categorias");
await llenar("#categoria-nombre", "Capacitaciones");
await clic("Crear categoría"); await esperarTexto("Categoría «Capacitaciones» creada");
await ir("/gastos/fijos");
await llenar("#recurrente-nombre", "Arriendo del local");
await elegir("#recurrente-categoria", "Arriendo");
await llenar("#recurrente-valor", 800000);
await llenar("#recurrente-dia", 5);
await clic("Crear gasto fijo"); await esperarTexto("Gasto fijo «Arriendo del local» creado");
await ir("/gastos/fijos");
await esperarTexto("$ 800.000");
await clic("Crear gastos fijos de este periodo"); await esperarTexto("Se crearon 1 gasto(s)");
await clic("Crear gastos fijos de este periodo"); await esperarTexto("ya estaban creados");
await ir("/gastos?estado=pendiente");
await esperarTexto("Arriendo del local");
await esperarTexto("$ 800.000");
await foto("gastos");
ok("categoría nueva; gasto fijo de arriendo creado una sola vez por periodo y por pagar");

// 6. Caja: movimientos del día, traslado al banco y retiro sin fondos
await ir("/caja");
for (const x of ["Cobro de venta", "Pago de gasto", "Anulación"]) await esperarTexto(x);
await elegir("#mov-tipo", "Traslado");
await elegir("#mov-cuenta", "Caja Tienda Centro");
await elegir("#mov-destino", "Cuenta bancaria");
await llenar("#mov-valor", 100000);
await llenar("#mov-descripcion", "Consignación del día");
await clic("Registrar"); await esperarTexto("Movimiento registrado");
if ((await saldo("Caja Tienda Centro")) !== 55500 || (await saldo("Cuenta bancaria")) !== 100000) await falla("el traslado debía dejar caja $ 55.500 y banco $ 100.000");
await elegir("#mov-tipo", "Retiro");
await elegir("#mov-cuenta", "Caja Tienda Centro");
await llenar("#mov-valor", 60000);
await llenar("#mov-descripcion", "Retiro del dueño");
await clic("Registrar"); await esperarTexto("El efectivo de la caja no alcanza para esta salida.");
ok("traslado de $ 100.000 al banco; un retiro mayor al efectivo se rechaza");

// 7. Cierre de caja con diferencia justificada
await ir("/caja");
await esperarTexto("Según el sistema debe haber $ 55.500");
await llenar('input[name="contado"]', 55000);
await esperarTexto("Faltan $ 500");
await llenar('input[name="justificacion"]', "Se dio mal un cambio");
await clic("Cerrar caja"); await esperarTexto("Cerrada hoy");
await ir("/caja");
await esperarTexto("Cerrada hoy");
await esperarTexto("faltaron $ 500");
await esperarTexto("Diferencia de cierre");
await foto("caja");
ok("cierre de caja: faltaron $ 500, justificado y registrado en el libro");

// 8. Cuentas y métodos de pago
await ir("/caja/cuentas");
await llenar("#cuenta-nombre", "Daviplata");
await elegir("#cuenta-tipo", "Otra");
await clic("Crear cuenta"); await esperarTexto("Cuenta «Daviplata» creada");
await ir("/caja/cuentas");
const filas = await texto();
if ((filas.match(/Daviplata/g) ?? []).length < 2) await falla("Daviplata debía quedar como cuenta y como método de pago");
ok("cuenta Daviplata creada también como método de pago");

// 9. La vendedora no ve gastos ni caja
await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/gastos"); if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe ver gastos");
await ir("/caja"); if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe ver la caja");
ok("la vendedora no ve gastos ni caja");

await t.terminar();
