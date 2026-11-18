// Prueba de punta a punta en un navegador real contra la base local (Fases 3 y 4)
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:3100";
fs.mkdirSync("/tmp/e2e", { recursive: true });
const navegador = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
let p = await navegador.newPage();
await p.setViewport({ width: 1280, height: 900 });
const errores = [];
const escuchar = (pg) => {
  pg.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => { if (m.type() === "error") errores.push(`consola: ${m.text()}`); });
};
escuchar(p);
let pasos = 0;
const ok = (m) => console.log(`ok · ${m}`);
const falla = async (m) => { await foto("fallo"); console.log(`FALLÓ: ${m}\n--- página ---\n${(await texto()).slice(0, 1500)}`); await navegador.close(); process.exit(1); };
const foto = (n) => p.screenshot({ path: `/tmp/e2e/${String(++pasos).padStart(2, "0")}-${n}.png`, fullPage: true });
const texto = () => p.evaluate(() => document.body.innerText);
const ir = async (ruta) => { await p.goto(BASE + ruta, { waitUntil: "networkidle0" }); };
const esperarTexto = async (t, ms = 15000) => {
  try { await p.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, t); }
  catch { await falla(`no apareció «${t}»`); }
};
const llenar = async (sel, valor) => { await p.$eval(sel, (e) => (e.value = "")); await p.type(sel, String(valor)); };
const elegir = async (sel, textoOpcion) => {
  const valor = await p.$eval(sel, (s, t) => [...s.options].find((o) => o.textContent.includes(t))?.value, textoOpcion);
  if (valor === undefined) await falla(`no hay opción «${textoOpcion}» en ${sel}`);
  await p.select(sel, valor);
};
const clic = async (t, dentro = "body") => {
  const ok2 = await p.evaluate((x, d) => {
    const b = [...document.querySelector(d).querySelectorAll("button")].find((e) => e.innerText.trim() === x || e.innerText.includes(x));
    if (b) { b.click(); return true; } return false;
  }, t, dentro);
  if (!ok2) await falla(`no encontré el botón «${t}»`);
};
const marcar = async (t, dentro = "body") => {
  const ok2 = await p.evaluate((x, d) => {
    const l = [...document.querySelector(d).querySelectorAll("label")].find((e) => e.innerText.trim() === x);
    const i = l?.querySelector("input"); if (i && !i.checked) i.click(); return Boolean(i);
  }, t, dentro);
  if (!ok2) await falla(`no encontré la casilla «${t}»`);
};
// Las acciones del servidor redirigen con navegación del lado del cliente: se espera la ruta
const clicHacia = async (t, patron) => {
  await clic(t);
  try { await p.waitForFunction((x) => new RegExp(x).test(location.pathname), { timeout: 15000 }, patron); }
  catch { await falla(`tras «${t}» no se llegó a ${patron} (quedó en ${p.url()})`); }
  await p.waitForNetworkIdle({ idleTime: 500 });
};
const ingresar = async (correo, clave) => {
  await ir("/ingresar");
  await llenar("input[name=correo]", correo); await llenar("input[name=clave]", clave);
  await clicHacia("Ingresar", "^/(?!ingresar)");
};

// 1. Ingreso del administrador y cambio de contraseña obligatorio
await ingresar("admin@luma.local", "clave-prueba-123");
if (!p.url().endsWith("/cambiar-clave")) await falla(`debía pedir cambio de contraseña, quedó en ${p.url()}`);
ok("el primer ingreso pide crear contraseña");
await llenar("input[name=clave]", "nueva-clave-456"); await llenar("input[name=confirmacion]", "nueva-clave-456");
await clicHacia("Guardar contraseña", "^/$");
await esperarTexto("Siguiente paso"); await foto("inicio-vacio"); ok("inicio sugiere crear el primer punto de venta");

// 2. Puntos de venta
await ir("/configuracion");
for (const [codigo, nombre, tipo] of [["CEN", "Tienda Centro", "Punto de venta"], ["TAL", "Taller", "Taller"]]) {
  await llenar("#nuevo-punto input[name=codigo]", codigo); await llenar("#nuevo-punto input[name=nombre]", nombre); await elegir("#nuevo-punto select[name=tipo]", tipo);
  await clic("Crear punto"); await esperarTexto(`«${nombre}» creado`);
}
ok("puntos creados; la tienda recibe su caja");

// 3. Usuario vendedor
await ir("/usuarios");
await llenar("#nuevo-usuario input[name=nombre]", "Vendedora Prueba"); await llenar("#nuevo-usuario input[name=correo]", "vendedora@luma.local");
await llenar("#nuevo-usuario input[name=clave]", "temporal-789");
await elegir("#nuevo-usuario select[name=rol_id]", "Vendedor");
await marcar("Tienda Centro", "#nuevo-usuario");
await clic("Crear usuario"); await esperarTexto("ya puede ingresar"); await foto("usuarios"); ok("vendedora creada con rol y punto");

// 4. Catálogos
await ir("/productos/catalogos");
const agregar = async (tabla, valores) => {
  for (const [campo, valor] of Object.entries(valores)) await llenar(`form:has(input[name=tabla][value=${tabla}]) input[name=${campo}]`, valor);
  await p.evaluate((t) => [...document.querySelectorAll(`form:has(input[name=tabla][value=${t}]) button`)].find((b) => b.innerText.includes("Agregar")).click(), tabla);
  await p.waitForNetworkIdle({ idleTime: 400 });
};
await agregar("tipos_camiseta", { nombre: "Cuello redondo" });
await agregar("colores", { nombre: "Blanco" });
await agregar("colores", { nombre: "Negro" });
await agregar("disenos", { codigo: "NAV", nombre: "Navidad" });
await ir("/productos/catalogos");
for (const t of ["Cuello redondo", "Blanco", "Negro", "NAV · Navidad"]) if (!(await texto()).includes(t)) await falla(`no quedó «${t}» en catálogos`);
ok("tipo, colores y diseño agregados");

// 5. Productos y variantes
const crearProducto = async (clase, codigo, nombre, extra) => {
  await ir("/productos/nuevo");
  await elegir("select[name=clase]", clase); await llenar("input[name=codigo]", codigo); await llenar("input[name=nombre]", nombre);
  if (extra) await extra();
  await clicHacia("Crear producto", "^/productos/[0-9a-f-]{36}$");
  if (!/\/productos\/[0-9a-f-]{36}$/.test(p.url())) await falla(`no abrió la ficha de ${nombre}`);
};
await crearProducto("Camiseta base", "BASE-CR", "Camiseta base cuello redondo");
for (const c of ["Cuello redondo", "S", "M", "L", "Blanco", "Negro"]) await marcar(c, "#generar-variantes");
await clic("Generar", "#generar-variantes"); await esperarTexto("6 variantes creadas"); ok("6 camisetas base generadas (3 tallas × 2 colores)");
await crearProducto("Material", "TRANSFER", "Transfer de estampado", () => elegir("select[name=unidad_medida]", "Hoja"));
if (!(await texto()).includes("TRANSFER")) await falla("el material no creó su variante");
await crearProducto("Camiseta terminada", "NAV", "Camiseta Navidad");
await elegir("#generar-variantes select[name=diseno_id]", "Navidad");
for (const c of ["Cuello redondo", "M", "L", "Blanco"]) await marcar(c, "#generar-variantes");
await llenar("#generar-variantes input[name=precio_venta]", 45000);
await clic("Generar", "#generar-variantes"); await esperarTexto("2 variantes creadas"); await foto("producto-navidad"); ok("camiseta Navidad con 2 variantes y precio");

// 6. Receta del diseño
await ir("/productos/catalogos");
await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
await elegir("select[name=material_id]", "Transfer"); await llenar("input[name=cantidad]", 1);
await p.evaluate(() => [...document.querySelectorAll("form:has(input[name=diseno_id]) button")].find((b) => b.innerText.includes("Agregar")).click());
await p.waitForNetworkIdle({ idleTime: 400 });
await ir("/productos/catalogos");
if (!(await texto()).includes("1 material(es)")) await falla("la receta no quedó guardada");
ok("receta: 1 hoja de transfer por camiseta");

// 7. Saldo inicial
await ir("/inventario/ajustes");
await llenar("input[name=motivo]", "Inventario inicial");
await elegir("#nuevo-ajuste select[name=bodega_id]", "Tienda Centro");
const lineas = await p.$$("select:not([name])");
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Agregar producto")).click());
const filas = await p.$$("#nuevo-ajuste select:not([name])");
const opciones = async (i, sku) => p.evaluate((idx, s) => {
  const sel = document.querySelectorAll("#nuevo-ajuste select:not([name])")[idx];
  return [...sel.options].find((o) => o.textContent.startsWith(s))?.value;
}, i, sku);
const fijar = async (i, sku, cantidad, costo) => {
  const v = await opciones(i, sku); if (!v) await falla(`sin opción ${sku}`);
  const sels = await p.$$("#nuevo-ajuste select:not([name])"); await sels[i].select(v);
  const nums = await p.$$("#nuevo-ajuste input[type=number]");
  await nums[i * 2].type(String(cantidad)); await nums[i * 2 + 1].type(String(costo));
};
await fijar(0, "BASE-CR-CR-M-BLA", 20, 12000);
await fijar(1, "TRANSFER", 30, 3500);
await clic("Registrar ajuste"); await esperarTexto("aplicado al inventario"); ok("saldo inicial aplicado (20 base, 30 transfer)");

// 8. Estampado
await ir("/estampado");
const vNav = await p.evaluate(() => [...document.querySelector("#nueva-orden select:not([name])").options].find((o) => o.textContent.startsWith("NAV-CR-M-BLA"))?.value);
await elegir("#nueva-orden select[name=bodega_id]", "Tienda Centro");
await (await p.$("#nueva-orden select:not([name])")).select(vNav);
await (await p.$("#nueva-orden input[type=number]")).type("10");
await clicHacia("Crear orden", "^/estampado/[0-9a-f-]{36}$");
await esperarTexto("Materiales necesarios"); await foto("orden-estampado");
await llenar("input[name^=buenas__]", 9); await llenar("input[name^=danadas__]", 1);
await clic("Registrar estampado"); await esperarTexto("costo real");
if (!(await texto()).includes("$ 15.500")) await falla("el costo real de la camiseta debía ser $ 15.500");
await foto("orden-terminada"); ok("estampado: 9 buenas, 1 dañada, costo real $ 15.500 c/u");

// 9. Inventario y kardex
await ir("/inventario?q=NAV");
if (!/NAV-CR-M-BLA[\s\S]*Tienda Centro\s*9/.test(await texto())) await falla("debían quedar 9 camisetas Navidad");
await ir("/inventario/kardex"); await esperarTexto("Dañada al estampar"); await foto("kardex"); ok("existencias y kardex correctos");

// 10. Traslado al taller
await ir("/inventario/traslados");
await elegir("#nuevo-traslado select[name=origen_id]", "Tienda Centro");
await elegir("#nuevo-traslado select[name=destino_id]", "Taller");
const vNav2 = await p.evaluate(() => [...document.querySelector("#nuevo-traslado select:not([name])").options].find((o) => o.textContent.startsWith("NAV-CR-M-BLA"))?.value);
await (await p.$("#nuevo-traslado select:not([name])")).select(vNav2);
await (await p.$("#nuevo-traslado input[type=number]")).type("2");
await clic("Guardar traslado"); await esperarTexto("Traslado enviado");
await ir("/inventario/traslados"); await clic("Recibir"); await esperarTexto("Recibido\n");
await ir("/inventario?q=NAV");
if (!/Taller\s*2/.test(await texto())) await falla("el taller debía tener 2");
ok("traslado enviado y recibido");

// 11. La vendedora: sin costos, sin administración
await p.deleteCookie(...(await p.cookies()));
await ingresar("vendedora@luma.local", "temporal-789");
if (!p.url().endsWith("/cambiar-clave")) await falla("la vendedora debía cambiar su contraseña temporal");
await llenar("input[name=clave]", "vendedora-456"); await llenar("input[name=confirmacion]", "vendedora-456");
await clicHacia("Guardar contraseña", "^/$");
const menu = await texto();
if (menu.includes("Usuarios") || menu.includes("Configuración")) await falla("la vendedora no debe ver administración");
await ir("/productos?clase=terminado"); await p.click("a[href^='/productos/']:not([href$=nuevo]):not([href$=catalogos])");
await p.waitForNetworkIdle({ idleTime: 400 });
if ((await texto()).includes("Costo promedio")) await falla("la vendedora no debe ver costos");
await ir("/inventario/kardex");
if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe ver el kardex");
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await ir("/"); await foto("vendedora-movil"); ok("vendedora: sin costos, sin kardex, sin administración");

console.log(errores.length ? `Errores del navegador:\n${errores.join("\n")}` : "Sin errores en el navegador");
await navegador.close();
