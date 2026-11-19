// Informes, exportación y panel de inicio. Corre después de e2e-compras.mjs, sobre la misma base.
import { iniciar } from "./ayudas.mjs";

const t = await iniciar("e2e-informes");
const { p, ok, foto, texto, falla, ir, esperarTexto, ingresar } = t;
const descargar = (ruta) => p.evaluate(async (r) => {
  const x = await fetch(r);
  return { estado: x.status, tipo: x.headers.get("content-type") ?? "", cuerpo: await x.text() };
}, ruta);

await ingresar("admin@luma.local", "nueva-clave-456");

// 1. Panel de inicio con filtro de fechas
await ir("/");
for (const x of ["Resumen: este mes", "Ventas del periodo", "Gastos del periodo", "Utilidad bruta", "Resultado operativo", "Ventas por día",
                 "Resultado del periodo", "Lo más vendido", "Gastos por categoría", "Últimos 12 meses", "Ventas por mes", "Utilidad por mes",
                 "Evolución del inventario", "Agotados", "Stock bajo", "Registrar gasto", "Nueva compra"]) await esperarTexto(x);
await foto("inicio-admin");
await ir("/?periodo=hoy");
await esperarTexto("Resumen: hoy");
await ir("/?desde=2026-01-01&hasta=2026-01-31");
await esperarTexto("Resumen: del 01/01/2026 al 31/01/2026");
ok("inicio: indicadores, filtro de fechas, ventas por día y por mes, utilidad, gastos por categoría e inventario");

// 2. Informe de ventas
await ir("/informes?periodo=mes");
for (const x of ["Vendido", "Ventas por día", "Productos más vendidos", "Utilidad bruta", "Camiseta Navidad", "Por vendedor", "Vendedora Prueba", "Por cliente"]) await esperarTexto(x);
await foto("informe-ventas");
ok("informe de ventas del mes con utilidad, productos y vendedores");

// 3. Resultado y dinero
await ir("/informes/resultado?periodo=mes");
for (const x of ["Estado de resultados", "Ventas netas", "Costo de lo vendido", "Resultado operativo", "Dinero real", "Saldos de hoy", "Gastos por categoría", "Arriendo", "Mes a mes"]) await esperarTexto(x);
await foto("informe-resultado");
ok("resultado del mes: ventas netas, costo, gastos, flujo de caja, saldos y mes a mes");

// 3b. Clientes y cuentas; compras y gastos
await ir("/informes/cuentas?periodo=mes");
for (const x of ["Ventas por cliente", "Ana Gómez", "Cuentas por cobrar", "Saldo de pedidos", "Cuentas por pagar", "Debes a proveedores", "Gastos por pagar", "Arriendo"]) await esperarTexto(x);
await foto("informe-cuentas");
await ir("/informes/compras-gastos?periodo=mes");
for (const x of ["Gastos del periodo", "Compras del periodo", "Gastos por categoría", "Compras por proveedor", "Gastos por proveedor", "Gastos por usuario", "Arriendo"]) await esperarTexto(x);
await foto("informe-compras-gastos");
ok("informes de clientes y cuentas por cobrar y pagar; compras por proveedor y gastos por categoría, proveedor y usuario");

// 4. Inventario
await ir("/informes/inventario");
for (const x of ["Existencias", "Valor del inventario", "Alertas", "BASE-CR-CR-M-BLA", "Evolución del inventario"]) await esperarTexto(x);
ok("informe de inventario valorizado con alertas y evolución mes a mes");

// 5. Exportaciones
for (const [ruta, encabezado, contiene] of [
  ["/informes/exportar?tipo=ventas&periodo=mes", "Producto;SKU", "NAV-CR-M-BLA"],
  ["/informes/exportar?tipo=ventas_lista&periodo=mes", "Número;Confirmada", "V-00001"],
  ["/informes/exportar?tipo=inventario", "Producto;SKU", "BASE-CR-CR-M-BLA"],
  ["/informes/exportar?tipo=gastos&periodo=mes", "Número;Fecha", "Arriendo del local"],
  ["/informes/exportar?tipo=clientes&periodo=mes", "Cliente;Ventas;Valor", "Ana Gómez"],
  ["/informes/exportar?tipo=cobrar", "Venta;Fecha;Cliente", "V-"],
  ["/informes/exportar?tipo=pagar", "Tipo;Número;Fecha", "Compra"],
  ["/informes/exportar?tipo=compras&periodo=mes", "Proveedor;Compras;Valor", "$"],
  ["/informes/exportar?tipo=gastos_resumen&periodo=mes", "Categoría;Tipo;Este periodo", "Arriendo"],
  ["/informes/exportar?tipo=resultado&periodo=mes", "Concepto;Valor", "Ventas netas"],
  ["/informes/exportar?tipo=caja&periodo=mes", "Fecha;Cuenta;Entrada;Salida", "Cobro de venta"],
  ["/informes/exportar?tipo=kardex&periodo=mes", "Fecha;Movimiento;Producto", "NAV-CR-M-BLA"],
  ["/informes/exportar?tipo=alertas", "Producto;SKU;Punto", "Alerta"],
  ["/informes/exportar?tipo=auditoria&periodo=mes", "Fecha;Usuario;Acción", "Ingresó"],
]) {
  const r = await descargar(ruta);
  const cuerpoOk = contiene === "$" ? r.cuerpo.split("\r\n").length > 1 : r.cuerpo.includes(contiene);
  if (r.estado !== 200 || !r.tipo.includes("text/csv") || !r.cuerpo.includes(encabezado) || !cuerpoOk) {
    await falla(`la exportación ${ruta} no salió bien (estado ${r.estado}): ${r.cuerpo.slice(0, 300)}`);
  }
}
for (const ruta of ["/informes/exportar?tipo=ventas&periodo=mes&formato=xlsx", "/informes/exportar?tipo=resultado&periodo=mes&formato=xlsx", "/configuracion/respaldo"]) {
  const r = await descargar(ruta);
  if (r.estado !== 200 || !r.tipo.includes("spreadsheetml") || !r.cuerpo.startsWith("PK")) {
    await falla(`el Excel ${ruta} no salió bien (estado ${r.estado}, tipo ${r.tipo}): ${r.cuerpo.slice(0, 120)}`);
  }
}
ok("exportaciones en CSV y Excel: ventas, clientes, cuentas por cobrar y pagar, compras, gastos, resultado, caja, kardex, alertas y auditoría; copia de seguridad");

// 5b. Auditoría y ficha de cliente
await ir("/auditoria");
for (const x of ["Auditoría", "Ingresó", "Ingresos y salidas"]) await esperarTexto(x);
await ir("/auditoria?tabla=ventas");
await esperarTexto("Ventas");
await t.clic("Ver cambios");
await esperarTexto("Antes");
await foto("auditoria");
await ir("/clientes?q=Ana");
const enlaceCliente = await p.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.innerText.trim() === "Ana Gómez")?.getAttribute("href"));
if (!enlaceCliente) await falla("la lista de clientes debía enlazar a la ficha de Ana Gómez");
await ir(enlaceCliente);
for (const x of ["Total comprado", "Saldo pendiente", "Historial de compras y pedidos", "V-"]) await esperarTexto(x);
await foto("ficha-cliente");
ok("auditoría con filtros y cambios campo a campo; ficha del cliente con historial y saldo");

// 6. La vendedora no ve informes ni exporta
await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/informes"); if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe ver informes");
await ir("/auditoria"); if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe ver la auditoría");
const rRespaldo = await descargar("/configuracion/respaldo");
if (rRespaldo.estado !== 403) await falla(`la vendedora no debe descargar la copia de seguridad (estado ${rRespaldo.estado})`);
const r = await descargar("/informes/exportar?tipo=ventas&periodo=mes");
if (r.estado !== 403) await falla(`la vendedora no debe exportar (estado ${r.estado})`);
await ir("/");
await esperarTexto("Tus ventas de hoy");
if ((await texto()).includes("Este mes")) await falla("la vendedora no debe ver el resultado del mes");
ok("la vendedora no ve informes, auditoría ni copia de seguridad; su inicio muestra solo sus ventas");

// 7. Encargado de inventario: informe de inventario sin costos
await ingresar("bodega@luma.local", "bodega-654");
await ir("/informes");
if (!p.url().includes("/informes/inventario")) await falla("el encargado debía llegar al informe de inventario");
await esperarTexto("Existencias");
if ((await texto()).includes("Valor del inventario")) await falla("el encargado no debe ver costos");
await esperarTexto("Evolución del inventario");
await ir("/");
if ((await texto()).includes("Ventas por mes")) await falla("el encargado no debe ver ventas en su inicio");
ok("encargado de inventario: ve existencias y su evolución sin valores ni ventas");

await t.terminar();
