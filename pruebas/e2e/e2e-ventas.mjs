// Prueba de punta a punta del módulo de ventas (Fase 6). Corre después de e2e.mjs, sobre la misma base:
// Tienda Centro tiene 7 camisetas NAV-CR-M-BLA y el Taller 2.
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
fs.mkdirSync("/tmp/e2e-ventas", { recursive: true });
const navegador = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
let p = await navegador.newPage();
await p.setViewport({ width: 1280, height: 900 });
const errores = [];
p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
p.on("console", (m) => { if (m.type() === "error") errores.push(`consola: ${m.text()}`); });
let pasos = 0;
const ok = (m) => console.log(`ok · ${m}`);
const foto = (n) => p.screenshot({ path: `/tmp/e2e-ventas/${String(++pasos).padStart(2, "0")}-${n}.png`, fullPage: true });
const texto = () => p.evaluate(() => document.body.innerText);
const falla = async (m) => { await foto("fallo"); console.log(`FALLÓ: ${m}\n--- página (${p.url()}) ---\n${(await texto()).slice(0, 2500)}`); await navegador.close(); process.exit(1); };
const ir = async (ruta) => { await p.goto(BASE + ruta, { waitUntil: "networkidle0" }); };
const esperarTexto = async (t, ms = 15000) => {
  try { await p.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, t); }
  catch { await falla(`no apareció «${t}»`); }
};
const llenar = async (sel, valor) => {
  const e = await p.$(sel); if (!e) await falla(`no existe ${sel}`);
  await e.click({ clickCount: 3 }); await p.keyboard.press("Backspace"); await e.type(String(valor));
};
const elegir = async (sel, textoOpcion) => {
  const valor = await p.$eval(sel, (s, t) => [...s.options].find((o) => o.textContent.includes(t))?.value, textoOpcion).catch(() => undefined);
  if (valor === undefined) await falla(`no hay opción «${textoOpcion}» en ${sel}`);
  await p.select(sel, valor);
};
const clic = async (t, dentro = "body") => {
  const hecho = await p.evaluate((x, d) => {
    const todos = [...document.querySelector(d).querySelectorAll("button, summary")];
    const b = todos.find((e) => e.innerText.trim() === x || e.getAttribute("aria-label") === x)
      ?? todos.find((e) => e.innerText.includes(x));
    if (b && !b.disabled) { b.click(); return true; } return false;
  }, t, dentro);
  if (!hecho) await falla(`no encontré el botón «${t}» (o está deshabilitado)`);
};
const deshabilitado = (t) => p.evaluate((x) => [...document.querySelectorAll("button")].find((e) => e.innerText.includes(x))?.disabled ?? null, t);
const casilla = async (t, valor = true) => {
  const hecho = await p.evaluate((x, v) => {
    const l = [...document.querySelectorAll("label")].find((e) => e.innerText.includes(x));
    const i = l?.querySelector("input[type=checkbox]"); if (i && i.checked !== v) i.click(); return Boolean(i);
  }, t, valor);
  if (!hecho) await falla(`no encontré la casilla «${t}»`);
};
const clicHacia = async (t, patron) => {
  await clic(t);
  try { await p.waitForFunction((x) => new RegExp(x).test(location.pathname), { timeout: 20000 }, patron); }
  catch { await falla(`tras «${t}» no se llegó a ${patron}`); }
  await p.waitForNetworkIdle({ idleTime: 500 });
};
const ingresar = async (correo, clave) => {
  await p.deleteCookie(...(await p.cookies()));
  await ir("/ingresar");
  await llenar("input[name=correo]", correo); await llenar("input[name=clave]", clave);
  await clicHacia("Ingresar", "^/(?!ingresar)");
};
const existencias = async (sku) => { await ir(`/inventario?q=${sku}`); return texto(); };
const agregarProducto = async (sku) => {
  await llenar('input[aria-label="Buscar producto"]', sku);
  const hecho = await p.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((e) => e.innerText.includes(s) && e.closest(".grid")); if (b) b.click(); return Boolean(b);
  }, sku);
  if (!hecho) await falla(`no apareció ${sku} en el buscador`);
};
const cantidad = async (n, linea = 0) => {
  const sel = (await p.$$('input[aria-labelledby^="cant-"]'))[linea]; if (!sel) await falla("no hay línea de producto");
  await sel.click({ clickCount: 3 }); await p.keyboard.press("Backspace"); await sel.type(String(n));
};
const idVenta = () => p.url().match(/\/ventas\/([0-9a-f-]{36})/)?.[1];

// ---------------------------------------------------------------------
// Preparación (administrador): una camiseta personalizada por pedido
// ---------------------------------------------------------------------
await ingresar("admin@luma.local", "nueva-clave-456");
await ir("/productos/nuevo");
await elegir("select[name=clase]", "Camiseta terminada"); await llenar("input[name=codigo]", "PER"); await llenar("input[name=nombre]", "Camiseta personalizada");
await casilla("Personalizada");
await clicHacia("Crear producto", "^/productos/[0-9a-f-]{36}$");
for (const c of ["Cuello redondo", "M", "Blanco"]) {
  await p.evaluate((x) => { const l = [...document.querySelectorAll("#generar-variantes label")].find((e) => e.innerText.trim() === x); const i = l?.querySelector("input"); if (i && !i.checked) i.click(); }, c);
}
await llenar("#generar-variantes input[name=precio_venta]", 60000);
await clic("Generar", "#generar-variantes"); await esperarTexto("1 variante creada");
const skuPer = (await texto()).match(/PER-[A-Z0-9-]+/)?.[0];
if (!skuPer) await falla("no se creó la variante personalizada");
ok(`camiseta personalizada ${skuPer} a $ 60.000`);

// ---------------------------------------------------------------------
// 1. La vendedora vende en mostrador, cobra en efectivo y entrega en un paso
// ---------------------------------------------------------------------
await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/");
if (!(await texto()).includes("Nueva venta")) await falla("el inicio debía ofrecer «Nueva venta»");
await ir("/ventas/nueva");
await esperarTexto("Con existencias en este punto");
await agregarProducto("NAV-CR-M-BLA");
await clic("Agregar una");
await esperarTexto("$ 90.000");
await clic("Pagó el total");
await llenar('input[placeholder="90000"]', 100000);
await esperarTexto("Cambio: $ 10.000");
await foto("venta-mostrador");
await clicHacia("Confirmar y entregar", "^/ventas/[0-9a-f-]{36}$");
const venta1 = idVenta();
await esperarTexto("Entregada");
if (!/V-\d{5}/.test(await texto())) await falla("la venta debía recibir número V-");
if (!(await texto()).includes("Pagado")) await falla("debía mostrar lo pagado");
await foto("venta-entregada");
if (!/Tienda Centro\s*5/.test(await existencias("NAV-CR-M-BLA"))) await falla("debían quedar 5 en Tienda Centro");
ok("venta de mostrador: 2 camisetas, efectivo con cambio, entregada; quedan 5");

// ---------------------------------------------------------------------
// 2. Sin existencias suficientes no se confirma (y el servidor da un mensaje claro)
// ---------------------------------------------------------------------
await ir("/ventas/nueva");
await agregarProducto("NAV-CR-M-BLA");
await cantidad(8);
await esperarTexto("Faltan 3 en este punto");
if (!(await deshabilitado("Confirmar venta"))) await falla("con existencias insuficientes no se debía poder confirmar");
await clicHacia("Guardar como cotización", "^/ventas/[0-9a-f-]{36}$");
await esperarTexto("Cotización COT-");
const cotSinStock = idVenta();
await clic("Confirmar venta");
await esperarTexto("No hay existencias suficientes de NAV-CR-M-BLA: disponibles 5, pedidas 8.");
ok("sin existencias: el formulario bloquea y el servidor explica «disponibles 5, pedidas 8»");
await p.evaluate(() => document.querySelector("#motivo-anulacion")?.focus());
await llenar("#motivo-anulacion", "El cliente no esperó");
await clic("Anular"); await esperarTexto("Venta anulada");
ok("la vendedora anula su cotización con motivo");

// ---------------------------------------------------------------------
// 3. Cotización con cliente nuevo, editada y confirmada con abono
// ---------------------------------------------------------------------
await ir("/ventas/nueva");
await clic("Cliente nuevo");
await llenar('input[aria-label="Nombre del cliente"]', "Ana Gómez");
await llenar('input[aria-label="Teléfono del cliente"]', "3001234567");
await clic("Guardar cliente");
await esperarTexto("Ana Gómez · 3001234567");
await agregarProducto("NAV-CR-M-BLA");
await clicHacia("Guardar como cotización", "^/ventas/[0-9a-f-]{36}$");
const cot = idVenta();
await esperarTexto("Ana Gómez");
await ir(`/ventas/${cot}/editar`);
await esperarTexto("Cotización COT-");
await clic("Agregar una");
await llenar('textarea', "Recoge el viernes");
await clicHacia("Guardar cambios de la cotización", `^/ventas/${cot}$`);
await esperarTexto("Recoge el viernes");
if (!(await texto()).includes("$ 90.000")) await falla("la cotización editada debía sumar $ 90.000");
await clic("Registrar un pago al confirmar");
await elegir("select[name=metodo_pago_id]", "Nequi");
await llenar("input[name=valor]", 50000);
await llenar("input[name=referencia]", "NEQ-778");
await clic("Confirmar venta");
await esperarTexto("Venta confirmada");
await ir(`/ventas/${cot}`);
await esperarTexto("Lista para entregar");
await esperarTexto("Falta un saldo de $ 40.000");
if ((await texto()).includes("Entregar al cliente")) await falla("sin crédito la vendedora no debía poder entregar con saldo");
await foto("cotizacion-confirmada");
ok("cotización con cliente nuevo, editada, confirmada con $ 50.000 por Nequi; sin crédito no entrega");

// La vendedora ve solo sus ventas
await ir("/ventas");
const listaVendedora = await texto();
if (!listaVendedora.includes("Ana Gómez")) await falla("la vendedora debía ver su venta");

// ---------------------------------------------------------------------
// 4. El administrador entrega a crédito y luego recibe el saldo
// ---------------------------------------------------------------------
await ingresar("admin@luma.local", "nueva-clave-456");
await ir(`/ventas/${cot}`);
await esperarTexto("Vendió Vendedora Prueba");
await casilla("Entregar a crédito");
await clic("Entregar al cliente");
await esperarTexto("Venta entregada");
await ir(`/ventas/${cot}`);
await esperarTexto("Saldo pendiente");
await llenar("input[name=valor]", 40000);
await clic("Registrar pago");
await esperarTexto("Pago registrado");
await ir(`/ventas/${cot}`);
if ((await texto()).includes("Saldo pendiente")) await falla("tras el pago el saldo debía quedar en cero");
ok("el administrador entrega a crédito y registra el pago del saldo");

// ---------------------------------------------------------------------
// 5. Promoción autorizada por el administrador
// ---------------------------------------------------------------------
await ir("/ventas/descuentos");
await llenar("#promo-nombre", "Navidad 10 %");
await llenar("#promo-valor", 10);
await elegir("#promo-producto", "Camiseta Navidad");
await clic("Crear promoción"); await esperarTexto("Promoción creada");
await ir("/ventas/descuentos"); await esperarTexto("Vigente");
ok("promoción del 10 % creada");

// El administrador registra una cotización propia (la vendedora no debe verla)
await ir("/ventas/nueva");
await agregarProducto("NAV-CR-M-BLA");
await clicHacia("Guardar como cotización", "^/ventas/[0-9a-f-]{36}$");
const cotAdmin = idVenta();

await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/ventas/nueva");
await agregarProducto("NAV-CR-M-BLA");
await esperarTexto("Disponible");
await p.evaluate(() => {
  const l = [...document.querySelectorAll("label")].find((e) => e.innerText.includes("Descuento autorizado"));
  const s = l.querySelector("select"); const o = [...s.options].find((x) => x.textContent.includes("Navidad 10 %"));
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, o.value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await esperarTexto("$ 40.500");
if ((await texto()).includes("Descuento en pesos")) await falla("la vendedora no debe escribir descuentos libres");
await clic("Pagó el total");
await clicHacia("Confirmar y entregar", "^/ventas/[0-9a-f-]{36}$");
await esperarTexto("Entregada");
if (!(await texto()).includes("Navidad 10 %")) await falla("el detalle debía mostrar la promoción aplicada");
ok("la vendedora aplica la promoción: $ 40.500, cobrada y entregada");

// Permisos de la vendedora
await ir(`/ventas/${cotAdmin}`);
if (!(await texto()).match(/404|no existe|no se encontró|not found/i)) await falla("la vendedora no debía ver la cotización del administrador");
await ir("/ventas");
if ((await texto()).match(new RegExp(cotAdmin))) await falla("la lista de la vendedora no debía incluir ventas ajenas");
await ir("/ventas/descuentos");
if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe administrar descuentos");
await ir("/clientes");
await esperarTexto("Ana Gómez");
if ((await texto()).includes("Editar")) await falla("la vendedora no debe editar clientes");
ok("la vendedora: solo sus ventas, sin descuentos libres, clientes sin edición");

// ---------------------------------------------------------------------
// 6. Pedido personalizado: se estampa por pedido con anticipo
// ---------------------------------------------------------------------
await ir("/ventas/nueva");
await agregarProducto(skuPer);
await llenar('input[placeholder="Ej.: «MARÍA 10» en la espalda"]', "LUIS 10");
await clic("Otro pago");
await llenar('input[aria-label="Valor del pago"]', 30000);
await clicHacia("Confirmar venta", "^/ventas/[0-9a-f-]{36}$");
await esperarTexto("Por estampar");
await esperarTexto("LUIS 10");
const pedido = idVenta();
await ir("/ventas/pedidos");
await esperarTexto("LUIS 10");
ok("pedido personalizado «LUIS 10» confirmado con anticipo: queda por estampar y en pedidos");

// ---------------------------------------------------------------------
// 7. Devolución con reembolso (administrador) y comprobante
// ---------------------------------------------------------------------
await ingresar("admin@luma.local", "nueva-clave-456");
await ir(`/ventas/${pedido}`);
await esperarTexto("Estampado");
if (!(await texto()).match(/Orden E?-?\S*/)) await falla("el pedido debía tener su orden de estampado");
await ir(`/ventas/${venta1}`);
await esperarTexto("Devolución del cliente");
const campoDev = await p.$("fieldset input[type=number]");
await campoDev.type("1");
await llenar('input[placeholder="Ej.: talla equivocada"]', "Talla equivocada");
await esperarTexto("Valor de lo devuelto: $ 45.000");
await clic("Registrar devolución");
await esperarTexto("Devolución registrada");
await ir(`/ventas/${venta1}`);
await esperarTexto("DV-");
await esperarTexto("Devolución de dinero");
if (!/Tienda Centro\s*3/.test(await existencias("NAV-CR-M-BLA"))) await falla("tras la devolución debían quedar 3 en Tienda Centro (7 − 2 − 2 − 1 + 1)");
ok("devolución de 1 camiseta en buen estado con reembolso de $ 45.000; vuelve al inventario");

await ir(`/comprobante/venta/${venta1}`);
await esperarTexto("No es una factura electrónica");
await esperarTexto("Comprobante de venta");
await foto("comprobante");
ok("comprobante interno imprimible, aclara que no es factura electrónica");

// Lista del administrador con filtros
await ir("/ventas?estado=entregadas");
await esperarTexto("Ana Gómez");
await ir("/ventas?q=Ana");
const filtrada = await texto();
if (!filtrada.includes("Ana Gómez") || filtrada.includes("Cliente mostrador")) await falla("la búsqueda por cliente no filtró");
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await ir("/ventas/nueva"); await foto("nueva-venta-movil");
ok("lista con filtros por estado y cliente; formulario en celular");

console.log(errores.length ? `Errores del navegador (${errores.length}):\n${JSON.stringify(errores, null, 1)}` : "Sin errores en el navegador");
await navegador.close();
