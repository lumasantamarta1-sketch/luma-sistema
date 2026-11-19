// Informes, exportación y panel de inicio. Corre después de e2e-compras.mjs, sobre la misma base.
import { iniciar } from "./ayudas.mjs";

const t = await iniciar("e2e-informes");
const { p, ok, foto, texto, falla, ir, esperarTexto, ingresar } = t;
const descargar = (ruta) => p.evaluate(async (r) => {
  const x = await fetch(r);
  return { estado: x.status, tipo: x.headers.get("content-type") ?? "", cuerpo: await x.text() };
}, ruta);

await ingresar("admin@luma.local", "nueva-clave-456");

// 1. Panel de inicio
await ir("/");
for (const x of ["Ventas de los últimos 14 días", "Este mes", "Lo más vendido este mes", "Registrar gasto", "Nueva compra"]) await esperarTexto(x);
await foto("inicio-admin");
ok("inicio: gráfica de 14 días, resultado del mes, lo más vendido y accesos rápidos");

// 2. Informe de ventas
await ir("/informes?periodo=mes");
for (const x of ["Vendido", "Ventas por día", "Productos más vendidos", "Utilidad bruta", "Camiseta Navidad", "Por vendedor", "Vendedora Prueba"]) await esperarTexto(x);
await foto("informe-ventas");
ok("informe de ventas del mes con utilidad, productos y vendedores");

// 3. Resultado y dinero
await ir("/informes/resultado?periodo=mes");
for (const x of ["Estado de resultados", "Ventas netas", "Costo de lo vendido", "Resultado operativo", "Dinero real", "Saldos de hoy", "Gastos por categoría", "Arriendo"]) await esperarTexto(x);
await foto("informe-resultado");
ok("resultado del mes: ventas netas, costo, gastos, flujo de caja y saldos");

// 4. Inventario
await ir("/informes/inventario");
for (const x of ["Existencias", "Valor del inventario", "Alertas", "BASE-CR-CR-M-BLA"]) await esperarTexto(x);
ok("informe de inventario valorizado con alertas");

// 5. Exportaciones
for (const [ruta, encabezado, contiene] of [
  ["/informes/exportar?tipo=ventas&periodo=mes", "Producto;SKU", "NAV-CR-M-BLA"],
  ["/informes/exportar?tipo=ventas_lista&periodo=mes", "Número;Confirmada", "V-00001"],
  ["/informes/exportar?tipo=inventario", "Producto;SKU", "BASE-CR-CR-M-BLA"],
  ["/informes/exportar?tipo=gastos&periodo=mes", "Número;Fecha", "Arriendo del local"],
]) {
  const r = await descargar(ruta);
  if (r.estado !== 200 || !r.tipo.includes("text/csv") || !r.cuerpo.includes(encabezado) || !r.cuerpo.includes(contiene)) {
    await falla(`la exportación ${ruta} no salió bien (estado ${r.estado}): ${r.cuerpo.slice(0, 200)}`);
  }
}
ok("exportaciones a Excel (CSV) de productos, ventas, inventario y gastos");

// 6. La vendedora no ve informes ni exporta
await ingresar("vendedora@luma.local", "vendedora-456");
await ir("/informes"); if (!p.url().endsWith("/sin-permiso")) await falla("la vendedora no debe ver informes");
const r = await descargar("/informes/exportar?tipo=ventas&periodo=mes");
if (r.estado !== 403) await falla(`la vendedora no debe exportar (estado ${r.estado})`);
await ir("/");
await esperarTexto("Tus ventas de hoy");
if ((await texto()).includes("Este mes")) await falla("la vendedora no debe ver el resultado del mes");
ok("la vendedora no ve informes ni exporta; su inicio muestra solo sus ventas");

// 7. Encargado de inventario: informe de inventario sin costos
await ingresar("bodega@luma.local", "bodega-654");
await ir("/informes");
if (!p.url().includes("/informes/inventario")) await falla("el encargado debía llegar al informe de inventario");
await esperarTexto("Existencias");
if ((await texto()).includes("Valor del inventario")) await falla("el encargado no debe ver costos");
ok("encargado de inventario: ve existencias sin valores");

await t.terminar();
