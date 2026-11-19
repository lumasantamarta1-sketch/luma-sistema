// Venta rápida (mostrador): la vendedora vende sin capacitación. Corre al final, sobre la base que dejan las otras pruebas.
import { iniciar } from "./ayudas.mjs";

const t = await iniciar("e2e-venta-rapida");
const { p, ok, foto, texto, falla, ir, esperarTexto, llenar, clic, ingresar } = t;
const baldosa = (sku) => `button[data-sku="${sku}"]`;
const quedan = (sku) => p.$eval(baldosa(sku), (b) => Number(b.innerText.match(/Quedan? (\d+)/)?.[1] ?? 0)).catch(() => null);
const tocar = async (sku) => { const b = await p.$(baldosa(sku)); if (!b) await falla(`no está la camiseta ${sku}`); await b.click(); };

await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/ventas/nueva");
await esperarTexto("Toca una camiseta para agregarla");
const antes = await quedan("NAV-CR-M-BLA");
if (!antes) await falla("NAV-CR-M-BLA debía tener unidades disponibles en el punto de la vendedora");
await foto("elegir");

// 1. Un toque, promoción aplicada sola, efectivo con cambio y entrega inmediata
await tocar("NAV-CR-M-BLA");
await esperarTexto("1 camiseta");
await esperarTexto("$ 40.500");
await clic("Cobrar");
await esperarTexto("¿Cuánto paga ahora?");
await esperarTexto("Promoción: Navidad 10 %");
await clic("$ 50.000");
await esperarTexto("Devuelve");
await esperarTexto("$ 9.500");
await foto("cobrar-efectivo");
await clic("Registrar venta");
await esperarTexto("¡Venta registrada!", 30000);
await esperarTexto("Entregada");
const numero = (await texto()).match(/V-\d{5}/)?.[0];
if (!numero) await falla("debía mostrar el número de la venta");
if (!(await texto()).includes("$ 9.500")) await falla("debía recordar el cambio a devolver");
await foto("lista");
await clic("Nueva venta");
await esperarTexto("Toca una camiseta para agregarla");
const despues = await quedan("NAV-CR-M-BLA");
if (despues !== antes - 1) await falla(`debían quedar ${antes - 1} y se ven ${despues}`);
ok(`venta ${numero}: un toque, promoción sola, efectivo con cambio de $ 9.500 y entregada; quedan ${despues}`);

// 2. Camiseta por pedido con abono por Nequi, a nombre de un cliente que ya existe
const skuPer = await p.evaluate(() => document.querySelector("button[data-sku^='PER-']")?.dataset.sku);
if (!skuPer) await falla("no apareció la camiseta personalizada");
await tocar(skuPer);
await clic("Cobrar");
await llenar('input[placeholder="Nombre, número, frase o diseño"]', "ANA 7");
await clic("Una parte (abono)");
await llenar('input[aria-label="Valor del abono"]', 30000);
await esperarTexto("Quedará debiendo $ 30.000");
await clic("Nequi");
await llenar('input[aria-label="Número del comprobante"]', "NQ-123");
await esperarTexto("Escribe el nombre del cliente");
await llenar('input[aria-label="Nombre del cliente"]', "Ana");
await esperarTexto("¿Es alguno de estos clientes?");
await clic("Ana Gómez");
if (!(await p.$('button[aria-label="Cambiar cliente"]'))) await falla("debía quedar elegido el cliente Ana Gómez");
await foto("cobrar-abono");
await clic("Registrar venta");
await esperarTexto("¡Venta registrada!", 30000);
await esperarTexto("Estampado");
const pedido = (await texto()).match(/V-\d{5}/)?.[0];
if (!(await texto()).includes("$ 30.000")) await falla("debía decir el saldo de $ 30.000");
ok(`pedido ${pedido}: «ANA 7» por estampar, abono de $ 30.000 por Nequi, cliente elegido de la lista`);

// 3. Separado sin pago con un cliente nuevo (se crea solo)
await clic("Nueva venta");
await tocar(skuPer);
await clic("Cobrar");
await clic("Una parte (abono)");
await clic("No paga ahora");
await esperarTexto("No recibe dinero ahora");
await llenar('input[aria-label="Nombre del cliente"]', "Rosa Prueba Mostrador");
await llenar('input[aria-label="Teléfono del cliente"]', "300 999 8877");
await clic("Registrar venta");
await esperarTexto("¡Venta registrada!", 30000);
await esperarTexto("$ 60.000");
await ir("/clientes?q=Rosa");
await esperarTexto("Rosa Prueba Mostrador");
ok("separado sin pago: el cliente nuevo quedó creado con su celular");

// 4. Sus ventas aparecen en la lista; el formulario completo sigue disponible
await ir("/ventas");
await esperarTexto(numero);
await ir("/ventas/nueva");
const enlace = await p.$('a[href="/ventas/nueva/completa"]');
if (!enlace) await falla("debía ofrecer el formulario completo");
await ir("/ventas/nueva/completa");
await esperarTexto("Con existencias en este punto");
ok("la venta está en la lista y el formulario completo sigue en «Cotización o más opciones»");

// 5. En celular
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await ir("/ventas/nueva");
await tocar("NAV-CR-M-BLA");
await esperarTexto("Cobrar");
await foto("celular-elegir");
await clic("Cobrar");
await foto("celular-cobrar");
ok("en celular: barra de cobro fija y pantalla de cobro");
await t.terminar();
