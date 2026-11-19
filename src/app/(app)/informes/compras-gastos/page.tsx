import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { resolverPeriodo } from "@/lib/periodos";
import { pestanasInformes, variacion, type InformeComprasGastos } from "@/lib/informes";
import { cn, fecha, mensajeError, pesos } from "@/lib/utilidades";
import { Pestanas } from "@/components/app/pestanas";
import { FiltroPeriodo } from "@/components/app/filtro-periodo";
import { Descargas } from "@/components/app/descargas";
import { BarrasHorizontales } from "@/components/ui/grafica-barras";
import { Cifra } from "@/components/ui/cifra";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";

export const metadata: Metadata = { title: "Compras y gastos" };

// Compras por proveedor y gastos por categoría, proveedor y usuario, comparados con el periodo anterior
export default async function InformeComprasYGastos({ searchParams }: {
  searchParams: Promise<{ periodo?: string; desde?: string; hasta?: string; punto?: string }>;
}) {
  const f = await searchParams;
  const sesion = await exigirPermiso("informes.financieros");
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");
  const punto = puntos.some((p) => p.id === f.punto) ? f.punto : undefined;
  const periodo = resolverPeriodo(f);
  const { data, error } = await supabase.rpc("informe_compras_gastos", { p_desde: periodo.desde, p_hasta: periodo.hasta, p_bodega: punto ?? null });
  const inf = data as InformeComprasGastos | null;
  const filtro = `desde=${periodo.desde}&hasta=${periodo.hasta}${punto ? `&punto=${punto}` : ""}`;
  const descargas = tiene(sesion, "informes.exportar") ? [
    { titulo: "Resumen por categoría y proveedor", url: `/informes/exportar?tipo=gastos_resumen&${filtro}` },
    ...(tiene(sesion, "gastos.ver") ? [{ titulo: "Lista de gastos", url: `/informes/exportar?tipo=gastos&${filtro}` }] : []),
    ...(tiene(sesion, "compras.ver") ? [{ titulo: "Lista de compras", url: `/informes/exportar?tipo=compras&${filtro}` }] : []),
  ] : [];
  const anterior = inf ? `${fecha(`${inf.periodo.anterior_desde}T12:00:00`)} al ${fecha(`${inf.periodo.anterior_hasta}T12:00:00`)}` : "";

  return (
    <>
      <Encabezado titulo="Compras y gastos"
                  descripcion={`Del ${fecha(`${periodo.desde}T12:00:00`)} al ${fecha(`${periodo.hasta}T12:00:00`)}${anterior ? `, comparado con el ${anterior}` : ""}.`}
                  acciones={<Descargas enlaces={descargas} />} />
      <Pestanas actual="/informes/compras-gastos" etiqueta="Informes" items={pestanasInformes(sesion.permisos)} />
      <FiltroPeriodo ruta="/informes/compras-gastos" clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} punto={punto} puntos={puntos} />
      {error && <Tarjeta className="text-error">{mensajeError(error)}</Tarjeta>}
      {inf && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Gastos del periodo" valor={pesos(inf.gastos.total)}
                   detalle={`${inf.gastos.cantidad} gasto(s) · antes ${pesos(inf.gastos.anterior)} (${variacion(Number(inf.gastos.total), Number(inf.gastos.anterior))})`} />
            <Cifra titulo="Gastos sin pagar" valor={pesos(inf.gastos.pendiente)} detalle="Del periodo" tono={Number(inf.gastos.pendiente) > 0 ? "alerta" : "normal"} />
            <Cifra titulo="Compras del periodo" valor={pesos(inf.compras.total)}
                   detalle={`${inf.compras.cantidad} compra(s) · antes ${pesos(inf.compras.anterior)} (${variacion(Number(inf.compras.total), Number(inf.compras.anterior))})`} />
            <Cifra titulo="Saldo de esas compras" valor={pesos(inf.compras.saldo)} detalle="Lo que falta pagar de ellas" tono={Number(inf.compras.saldo) > 0 ? "alerta" : "normal"} />
          </div>

          <Tarjeta>
            <h2 className="mb-3 text-lg font-semibold text-morado">Gastos por categoría</h2>
            {inf.gastos_por_categoria.length === 0 ? <p className="text-sm text-suave">No hay gastos en este periodo ni en el anterior.</p> : (
              <div className="grid gap-4 lg:grid-cols-2">
                <BarrasHorizontales datos={inf.gastos_por_categoria.filter((g) => Number(g.valor) > 0).map((g) => ({
                  etiqueta: g.categoria, detalle: g.tipo === "mercancia" ? "mercancía" : undefined, valor: Number(g.valor),
                }))} />
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-suave">
                      <th className="py-2 font-semibold">Categoría</th><th className="py-2 text-right font-semibold">Este periodo</th>
                      <th className="py-2 text-right font-semibold">Anterior</th><th className="py-2 text-right font-semibold">Cambio</th>
                    </tr></thead>
                    <tbody>
                      {inf.gastos_por_categoria.map((g) => {
                        const v = variacion(Number(g.valor), Number(g.anterior));
                        return (
                          <tr key={g.categoria} className="border-t border-borde">
                            <td className="py-1.5">{g.categoria}</td>
                            <td className="cifra py-1.5 text-right">{pesos(g.valor)}</td>
                            <td className="cifra py-1.5 text-right text-suave">{pesos(g.anterior)}</td>
                            <td className={cn("cifra py-1.5 text-right font-semibold", v.startsWith("+") || v === "nuevo" ? "text-naranja" : "text-morado")}>{v}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Tarjeta>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta>
              <h2 className="mb-3 text-lg font-semibold text-morado">Compras por proveedor</h2>
              {inf.compras_por_proveedor.length === 0 ? <p className="text-sm text-suave">No hay compras en este periodo.</p> : (
                <BarrasHorizontales datos={inf.compras_por_proveedor.filter((c) => Number(c.valor) > 0).map((c) => ({
                  etiqueta: c.proveedor, valor: Number(c.valor),
                  detalle: `${c.compras} compra(s)${Number(c.saldo) > 0 ? ` · debes ${pesos(c.saldo)}` : ""}`,
                }))} />
              )}
            </Tarjeta>
            <Tarjeta>
              <h2 className="mb-3 text-lg font-semibold text-morado">Gastos por proveedor</h2>
              {inf.gastos_por_proveedor.length === 0 ? <p className="text-sm text-suave">Sin gastos.</p> : (
                <BarrasHorizontales datos={inf.gastos_por_proveedor.slice(0, 10).map((g) => ({ etiqueta: g.proveedor, detalle: `${g.gastos} gasto(s)`, valor: Number(g.valor) }))} />
              )}
            </Tarjeta>
            <Tarjeta>
              <h2 className="mb-3 text-lg font-semibold text-morado">Gastos por usuario</h2>
              <p className="-mt-2 mb-3 text-xs text-suave">Quién registró cada gasto.</p>
              {inf.gastos_por_usuario.length === 0 ? <p className="text-sm text-suave">Sin gastos.</p> : (
                <BarrasHorizontales datos={inf.gastos_por_usuario.map((g) => ({ etiqueta: g.usuario, detalle: `${g.gastos} gasto(s)`, valor: Number(g.valor) }))} />
              )}
            </Tarjeta>
          </div>
        </div>
      )}
    </>
  );
}
