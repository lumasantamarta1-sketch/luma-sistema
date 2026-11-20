import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, ClipboardList, PackagePlus, Plus, Receipt, Truck, Wallet } from "lucide-react";
import { exigirSesion, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { Cifra } from "@/components/ui/cifra";
import { BarrasHorizontales, GraficaBarras, GraficaColumnas } from "@/components/ui/grafica-barras";
import { FiltroPeriodo } from "@/components/app/filtro-periodo";
import { diasEntre, PERIODOS, resolverPeriodo } from "@/lib/periodos";
import { diaCorto, mesCorto, type CuentasPendientes, type InformeComprasGastos, type InformeVentas, type ResumenFinanciero, type SerieMes } from "@/lib/informes";
import { numero } from "@/lib/inventario";
import { cn, fecha, pesos } from "@/lib/utilidades";
import { hoyBogota } from "@/lib/ventas";

export const metadata: Metadata = { title: "Inicio" };

type Alerta = { variante_id: string; sku: string; producto: string; bodega: string; cantidad: number; stock_minimo: number; alerta: string };
const nada = Promise.resolve({ data: null });

// Panel de inicio: lo de hoy para todos y, según el rol, ventas, resultado, gastos e inventario del periodo elegido
export default async function Inicio({ searchParams }: { searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string }> }) {
  const f = await searchParams;
  const sesion = await exigirSesion();
  const supabase = await crearClienteServidor();
  const puede = (...p: string[]) => tiene(sesion, ...p);
  const hoy = hoyBogota();
  const periodo = resolverPeriodo(f);
  const verVentas = puede("informes.ver");
  const verFin = puede("informes.financieros");
  const verSerie = verVentas || verFin || puede("informes.inventario");

  const [operacion, informe, financiero, alertas, mensual, comprasGastos, cuentas] = await Promise.all([
    supabase.rpc("resumen_operacion", { p_desde: hoy, p_hasta: hoy }),
    verVentas ? supabase.rpc("informe_ventas", { p_desde: periodo.desde, p_hasta: periodo.hasta }) : nada,
    verFin ? supabase.rpc("resumen_financiero", { p_desde: periodo.desde, p_hasta: periodo.hasta }) : nada,
    puede("inventario.ver") ? supabase.rpc("alertas_inventario", {}) : Promise.resolve({ data: [] }),
    verSerie ? supabase.rpc("serie_mensual", { p_meses: 12 }) : nada,
    verFin ? supabase.rpc("informe_compras_gastos", { p_desde: periodo.desde, p_hasta: periodo.hasta }) : nada,
    puede("informes.financieros", "gastos.ver") ? supabase.rpc("cuentas_pendientes") : nada,
  ]);
  const ventas = (operacion.data?.ventas ?? null) as Record<string, number> | null;
  const inventario = (operacion.data?.inventario ?? null) as Record<string, number> | null;
  const inf = informe.data as InformeVentas | null;
  const fin = financiero.data as ResumenFinanciero | null;
  const serie = (mensual.data ?? []) as SerieMes[];
  const gastos = comprasGastos.data as InformeComprasGastos | null;
  const pendientes = (cuentas.data as CuentasPendientes | null)?.gastos_por_pagar ?? [];
  const vencidos = pendientes.filter((g) => g.dias > 30);
  const urgentes = ((alertas.data ?? []) as Alerta[]).filter((a) => a.alerta !== "pocas_unidades");
  const sinPuntos = sesion.bodegas.length === 0;
  const vende = puede("ventas.crear") && sesion.bodegas.some((b) => b.tipo === "punto_venta");
  const porDia = new Map((inf?.por_dia ?? []).map((d) => [d.fecha, Number(d.valor)]));
  const nombrePeriodo = PERIODOS.find((p) => p.valor === periodo.clave)?.titulo.toLowerCase()
    ?? `del ${fecha(`${periodo.desde}T12:00:00`)} al ${fecha(`${periodo.hasta}T12:00:00`)}`;
  const conCostos = serie.some((m) => m.utilidad_bruta !== null);
  const conVentasMes = serie.some((m) => m.ventas_netas !== null);
  const conInventarioMes = serie.some((m) => m.inventario_unidades !== null);

  const accesos = [
    { ver: vende, href: "/ventas/nueva", texto: "Nueva venta", Icono: Plus, principal: true },
    { ver: puede("ventas.entregar", "ventas.crear"), href: "/ventas/pedidos", texto: `Pedidos por entregar${ventas?.pedidos_pendientes ? ` (${ventas.pedidos_pendientes})` : ""}`, Icono: ClipboardList },
    { ver: puede("inventario.ajustar", "compras.gestionar") && puede("costos.ver"), href: "/inventario/agregar", texto: "Agregar inventario", Icono: PackagePlus },
    { ver: puede("gastos.registrar"), href: "/gastos/nuevo", texto: "Registrar gasto", Icono: Receipt },
    { ver: puede("compras.gestionar"), href: "/compras/nueva", texto: "Nueva compra", Icono: Truck },
    { ver: puede("compras.recibir") && !puede("compras.gestionar"), href: "/compras", texto: "Compras por recibir", Icono: Truck },
    { ver: puede("caja.cerrar", "caja.ver"), href: "/caja", texto: "Caja", Icono: Wallet },
  ].filter((a) => a.ver);

  return (
    <>
      <Encabezado titulo={`Hola, ${sesion.nombre.split(" ")[0] || "bienvenido"}`}
                  descripcion={`${sesion.rolNombre ?? ""}${sesion.bodegas.length ? " · " + sesion.bodegas.map((b) => b.nombre).join(", ") : ""}`} />

      {sinPuntos && (
        <Tarjeta className="mb-5 border-amarillo bg-amarillo/10">
          <h2 className="text-lg font-semibold text-morado">Siguiente paso</h2>
          {puede("configuracion.gestionar") ? (
            <p className="mt-1">Crea tu primer punto de venta en{" "}
              <Link href="/configuracion" className="font-bold text-morado underline">Configuración</Link>.</p>
          ) : (
            <p className="mt-1">El administrador aún no te asigna un punto de venta.</p>
          )}
        </Tarjeta>
      )}

      {accesos.length > 0 && (
        <nav aria-label="Accesos rápidos" className="mb-5 flex flex-wrap gap-2">
          {accesos.map(({ href, texto, Icono, principal }) => (
            <Link key={href} href={href}
                  className={cn("inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold",
                                principal ? "bg-morado text-white hover:bg-morado-700" : "border border-borde bg-white text-morado hover:bg-morado-50")}>
              <Icono className="size-5" aria-hidden /> {texto}
            </Link>
          ))}
        </nav>
      )}

      {vencidos.length > 0 && (
        <Link href="/informes/cuentas" className="mb-4 flex items-start gap-2 rounded-2xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><b>{vencidos.length} gasto(s) sin pagar hace más de 30 días</b> por {pesos(vencidos.reduce((s, g) => s + Number(g.valor), 0))}. Revísalos en Clientes y cuentas.</span>
        </Link>
      )}

      {/* Hoy */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ventas && (
          <>
            <Cifra titulo={puede("ventas.ver") ? "Ventas de hoy" : "Tus ventas de hoy"} valor={pesos(ventas.ventas_netas_entregadas)} etiqueta="Calculado"
                   detalle={`${ventas.ventas_entregadas ?? 0} entregada(s) · recibido ${pesos(ventas.recibido)}`} />
            <Cifra titulo="Pedidos pendientes" valor={String(ventas.pedidos_pendientes ?? 0)} etiqueta="Conteo"
                   detalle={<>Anticipos: {pesos(ventas.anticipos_pedidos_pendientes)} · <Link href="/ventas/pedidos" className="underline">ver</Link></>} />
            <Cifra titulo="Por estampar" valor={String(ventas.por_estampar ?? 0)} etiqueta="Conteo" />
          </>
        )}
        {inventario && (
          <>
            <Cifra titulo="Camisetas en inventario" valor={numero(inventario.unidades_terminadas ?? 0)} etiqueta="Terminadas · conteo"
                   detalle={`Base para estampar: ${numero(inventario.unidades_base ?? 0)}`} />
            <Cifra titulo="Agotados" valor={String(inventario.agotados ?? 0)} etiqueta="Productos sin unidades" tono={(inventario.agotados ?? 0) > 0 ? "error" : "normal"} />
            <Cifra titulo="Stock bajo" valor={String(inventario.stock_bajo ?? 0)} etiqueta="Por debajo del mínimo" tono={(inventario.stock_bajo ?? 0) > 0 ? "alerta" : "normal"} />
          </>
        )}
      </div>

      {/* Periodo elegido */}
      {(verVentas || verFin) && (
        <section aria-labelledby="titulo-periodo" className="mt-6">
          <h2 id="titulo-periodo" className="mb-2 font-titulo text-xl font-semibold text-morado">Resumen: {nombrePeriodo}</h2>
          <FiltroPeriodo ruta="/" clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} compacto />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {inf && <Cifra titulo="Ventas del periodo" valor={pesos(inf.totales.valor)} etiqueta="Entregadas"
                           detalle={`${inf.totales.ventas} venta(s) · ${numero(inf.totales.unidades)} unidad(es)`} />}
            {fin && <Cifra titulo="Gastos del periodo" valor={pesos(fin.calculado.gastos_registrados)} etiqueta="Operativos, pagados o no" />}
            {fin && <Cifra titulo="Utilidad bruta" valor={pesos(fin.calculado.utilidad_bruta)} etiqueta="Calculado"
                                        detalle={fin.calculado.margen_bruto !== null ? `Margen ${Math.round(Number(fin.calculado.margen_bruto) * 100)} %` : undefined} />}
            {fin && <Cifra titulo="Resultado operativo" valor={pesos(fin.calculado.resultado_operativo)} etiqueta="Calculado"
                                        tono={fin.calculado.resultado_operativo < 0 ? "error" : "normal"} />}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
            {inf && (
              <Tarjeta>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="flex-1 text-lg font-semibold text-morado">Ventas por día</h3>
                  <Link href={`/informes?periodo=${periodo.clave}${periodo.clave === "personalizado" ? `&desde=${periodo.desde}&hasta=${periodo.hasta}` : ""}`}
                        className="text-sm font-semibold text-morado underline">Ver informe</Link>
                </div>
                <GraficaBarras titulo={`Valor vendido por día, ${nombrePeriodo}`}
                               datos={diasEntre(periodo.desde, periodo.hasta).map((d) => ({ etiqueta: diaCorto(d), valor: porDia.get(d) ?? 0 }))} />
                <p className="mt-1 text-sm text-suave">
                  Total: <b className="cifra text-tinta">{pesos(inf.totales.valor)}</b> en {inf.totales.ventas} venta(s) entregada(s).
                </p>
              </Tarjeta>
            )}
            {fin && (
              <Tarjeta>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="flex-1 text-lg font-semibold text-morado">Resultado del periodo</h3>
                  <Insignia tono="marca">Calculado</Insignia>
                </div>
                <dl className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between"><dt className="text-suave">Ventas netas</dt><dd className="cifra">{pesos(fin.calculado.ventas_netas)}</dd></div>
                  <div className="flex justify-between"><dt className="text-suave">Utilidad bruta</dt><dd className="cifra">{pesos(fin.calculado.utilidad_bruta)}</dd></div>
                  <div className="flex justify-between"><dt className="text-suave">Gastos operativos</dt><dd className="cifra">− {pesos(fin.calculado.gastos_registrados)}</dd></div>
                  {fin.calculado.perdidas_inventario !== 0 && (
                    <div className="flex justify-between"><dt className="text-suave">Pérdidas y ajustes de inventario</dt>
                      <dd className="cifra">{fin.calculado.perdidas_inventario > 0 ? "− " : "+ "}{pesos(Math.abs(fin.calculado.perdidas_inventario))}</dd></div>
                  )}
                  <div className={cn("flex justify-between border-t border-borde pt-2 text-base font-semibold", fin.calculado.resultado_operativo < 0 ? "text-error" : "text-morado")}>
                    <dt>Resultado</dt><dd className="cifra">{pesos(fin.calculado.resultado_operativo)}</dd>
                  </div>
                  <div className="mt-2 flex justify-between"><dt className="text-suave">Flujo de caja (dinero real)</dt><dd className="cifra">{pesos(fin.dinero_real.flujo_de_caja)}</dd></div>
                  <div className="flex justify-between"><dt className="text-suave">Te deben / debes</dt>
                    <dd className="cifra">{pesos(fin.saldos.cuentas_por_cobrar)} / {pesos(fin.saldos.cuentas_por_pagar)}</dd></div>
                </dl>
                <Link href="/informes/resultado" className="mt-3 inline-block text-sm font-semibold text-morado underline">Ver resultado completo</Link>
              </Tarjeta>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {inf && inf.por_producto.length > 0 && (
              <Tarjeta>
                <h3 className="mb-3 text-lg font-semibold text-morado">Lo más vendido</h3>
                <BarrasHorizontales formato="numero" datos={inf.por_producto.slice()
                  .sort((a, b) => Number(b.unidades) - Number(a.unidades)).slice(0, 5)
                  .map((p) => ({ etiqueta: `${p.producto}${p.detalle ? ` · ${p.detalle}` : ""}`, valor: Number(p.unidades), detalle: pesos(p.valor) }))} />
              </Tarjeta>
            )}
            {gastos && (
              <Tarjeta>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="flex-1 text-lg font-semibold text-morado">Gastos por categoría</h3>
                  <Link href={`/informes/compras-gastos?periodo=${periodo.clave}${periodo.clave === "personalizado" ? `&desde=${periodo.desde}&hasta=${periodo.hasta}` : ""}`}
                        className="text-sm font-semibold text-morado underline">Ver detalle</Link>
                </div>
                {gastos.gastos_por_categoria.filter((g) => Number(g.valor) > 0).length === 0
                  ? <p className="text-sm text-suave">No hay gastos en este periodo.</p>
                  : <BarrasHorizontales datos={gastos.gastos_por_categoria.filter((g) => Number(g.valor) > 0).slice(0, 6)
                      .map((g) => ({ etiqueta: g.categoria, valor: Number(g.valor) }))} />}
              </Tarjeta>
            )}
          </div>
        </section>
      )}

      {/* Mes a mes */}
      {(conVentasMes || conInventarioMes) && (
        <section aria-labelledby="titulo-meses" className="mt-6">
          <h2 id="titulo-meses" className="mb-3 font-titulo text-xl font-semibold text-morado">Últimos 12 meses</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {conVentasMes && (
              <Tarjeta>
                <h3 className="mb-2 text-lg font-semibold text-morado">Ventas por mes</h3>
                <GraficaColumnas titulo="Ventas netas por mes" datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.ventas_netas ?? 0), detalle: `${m.ventas ?? 0} venta(s)` }))} />
              </Tarjeta>
            )}
            {conCostos && (
              <Tarjeta>
                <h3 className="mb-2 text-lg font-semibold text-morado">Utilidad por mes</h3>
                <GraficaColumnas titulo="Utilidad bruta por mes"
                                 datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.utilidad_bruta ?? 0),
                                                            detalle: m.resultado !== null ? `resultado ${pesos(m.resultado)}` : undefined }))} />
              </Tarjeta>
            )}
            {conInventarioMes && (
              <Tarjeta>
                <h3 className="mb-2 text-lg font-semibold text-morado">Evolución del inventario</h3>
                <GraficaColumnas formato="numero" titulo="Camisetas en inventario al cierre de cada mes"
                                 datos={serie.map((m) => ({ etiqueta: mesCorto(m.mes), valor: Number(m.inventario_unidades ?? 0),
                                                            detalle: m.inventario_valor !== null ? `a costo ${pesos(m.inventario_valor)}` : undefined }))} />
              </Tarjeta>
            )}
          </div>
        </section>
      )}

      {urgentes.length > 0 && (
        <Tarjeta className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="flex-1 text-lg font-semibold text-morado">Para reponer</h2>
            <Link href={puede("informes.inventario") ? "/informes/inventario" : "/inventario"} className="text-sm font-semibold text-morado underline">Ver todo</Link>
          </div>
          <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
            {urgentes.slice(0, 8).map((a) => (
              <li key={`${a.variante_id}-${a.bodega}`} className="flex flex-wrap items-center gap-2 border-b border-borde py-2">
                <span className="min-w-0 flex-1">{a.producto} <span className="text-suave">({a.sku}) · {a.bodega}</span></span>
                <Insignia tono={a.alerta === "agotado" ? "error" : "alerta"}>{a.alerta === "agotado" ? "Agotado" : `Quedan ${numero(a.cantidad)}`}</Insignia>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </>
  );
}
