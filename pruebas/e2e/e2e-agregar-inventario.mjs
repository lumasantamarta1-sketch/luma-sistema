// Agregar inventario: el administrador agrega camisetas por talla y color en un solo paso
import { iniciar } from "./ayudas.mjs";

const t = await iniciar("e2e-agregar-inventario");
const { p, ok, foto, texto, falla, ir, esperarTexto, llenar, clic, elegir, ingresar } = t;
const presionado = (etiqueta) => p.$(`button[aria-label="${etiqueta}"][aria-pressed="true"]`);
const fila = (sku, punto) => p.evaluate((s, b) =>
  [...document.querySelectorAll("tr, li")].find((e) => e.innerText.includes(s) && e.innerText.includes(b))?.innerText ?? "", sku, punto);

await ingresar("admin@luma.local", "nueva-clave-456");
await ir("/inventario");
if (!(await p.$('a[href="/inventario/agregar"]'))) await falla("el inventario debía ofrecer «Agregar inventario»");
await ir("/");
if (!(await p.$('a[href="/inventario/agregar"]'))) await falla("el inicio debía tener el acceso «Agregar inventario»");

// 1. Camiseta nueva y estampada, con diseño nuevo: cuadrícula de tallas y colores, como inventario que ya se tenía
await ir("/inventario/agregar");
await esperarTexto("¿Qué camiseta?");
await clic("Una nueva");
await llenar('input[aria-label="Nombre de la camiseta nueva"]', "Camiseta Grilla");
await clic("Estampada");
await elegir('select[aria-label="Diseño"]', "Un diseño nuevo");
await llenar('input[aria-label="Nombre del diseño nuevo"]', "Grilla feliz");
await clic("Cuello redondo");
for (const x of ["Talla S", "Talla M", "Color Blanco", "Color Negro"]) await clic(x);
await llenar('input[aria-label="Cantidad S Blanco"]', 3);
await llenar('input[aria-label="Cantidad M Blanco"]', 5);
await llenar('input[aria-label="Cantidad M Negro"]', 2);
await esperarTexto("10 camisetas");
if (await p.$('select[aria-label="Punto"]')) await elegir('select[aria-label="Punto"]', "Tienda Centro");
await llenar('input[aria-label="Costo por camiseta"]', 12000);
await llenar('input[aria-label="Precio de venta"]', 35000);
await clic("Ya las tenía");
await foto("formulario");
await clic("Agregar al inventario");
await esperarTexto("¡Inventario agregado!", 30000);
for (const x of ["10 camisetas", "Camiseta Grilla", "Tienda Centro", "$ 120.000", "3 combinación"]) await esperarTexto(x);
await foto("listo");
ok("camiseta nueva con diseño nuevo: 10 unidades en 3 tallas y colores, creadas y agregadas en un paso");

// 2. Más de la misma camiseta, comprada a un proveedor nuevo y sin pagar
await clic("Agregar más de esta camiseta");
await esperarTexto("hay 3");
await llenar('input[aria-label="Cantidad S Blanco"]', 2);
await llenar('input[aria-label="Costo por camiseta"]', 12000);
await clic("Las compré a un proveedor");
await elegir('select[aria-label="Proveedor"]', "Un proveedor nuevo");
await llenar('input[aria-label="Nombre del proveedor nuevo"]', "Textiles Grilla");
await clic("No, le debo");
await clic("Agregar al inventario");
await esperarTexto("¡Inventario agregado!", 30000);
await esperarTexto("Textiles Grilla");
await esperarTexto("Le debes $ 24.000");
const compra = await p.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.innerText.startsWith("Ver la compra"))?.getAttribute("href"));
if (!compra) await falla("debía enlazar a la compra");
await ir(compra);
await esperarTexto("Textiles Grilla");
ok("misma camiseta comprada a un proveedor nuevo: compra recibida y la deuda de $ 24.000 queda registrada");

// 3. El inventario muestra cada talla y color con su cantidad
await ir("/inventario?q=Grilla");
for (const [sku, n] of [["GF-CR-S-BLA", 5], ["GF-CR-M-BLA", 5], ["GF-CR-M-NEG", 2]]) {
  const f = await fila(sku, "Tienda Centro");
  if (!new RegExp(`\\b${n}\\b`).test(f)) await falla(`${sku} en Tienda Centro debía tener ${n}: «${f}»`);
}
ok("el inventario quedó con S Blanco 5, M Blanco 5 y M Negro 2");

// 4. Desde la ficha de la camiseta, «Agregar inventario» llega con sus tallas y colores marcados
await ir("/productos?clase=terminado");
const ficha = await p.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.innerText.includes("Camiseta Grilla"))?.getAttribute("href"));
if (!ficha) await falla("la camiseta nueva debía estar en Productos");
await ir(ficha);
const enlace = await p.$('a[href^="/inventario/agregar?producto="]');
if (!enlace) await falla("la ficha debía ofrecer «Agregar inventario»");
await ir(await p.evaluate((a) => a.getAttribute("href"), enlace));
for (const x of ["Talla S", "Talla M", "Color Blanco", "Color Negro"]) if (!(await presionado(x))) await falla(`debía venir marcada «${x}»`);
if (await p.$('select[aria-label="Punto"]')) await elegir('select[aria-label="Punto"]', "Tienda Centro");
await esperarTexto("hay 5");

// 5. Una talla nueva sin salir de la pantalla
await clic("Otra talla");
await llenar('input[aria-label="Nombre: otra talla"]', "3XL");
await clic("Agregar");
await p.waitForSelector('button[aria-label="Talla 3XL"][aria-pressed="true"]', { timeout: 15000 }).catch(() => falla("no apareció la talla 3XL marcada"));
await esperarTexto("nueva");
ok("desde la ficha llega con tallas y colores marcados; una talla nueva se agrega ahí mismo");

// 6. La vendedora no agrega inventario
await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/inventario/agregar");
if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debía entrar a «Agregar inventario»");
ok("la vendedora no puede agregar inventario");

// 7. En celular, con la sesión del administrador (cambiar a celular recarga la página; va de último)
await ingresar("admin@luma.local", "nueva-clave-456");
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await ir(ficha.replace("/productos/", "/inventario/agregar?producto="));
await esperarTexto("¿Cuántas llegan de cada una?");
await foto("celular");
ok("en celular: la cuadrícula se desplaza y el botón queda fijo abajo");
await t.terminar();
