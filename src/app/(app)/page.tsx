import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus, Receipt, Truck, Wallet } from "lucide-react";
import { exigirSesion, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { BarrasHorizontales, GraficaBarras } from "@/components/ui/grafica-barras";
import { diasEntre, resolverPeriodo, restarDias } from "@/lib/periodos";
import { diaCorto, type InformeVentas, type ResumenFinanciero } from "@/lib/informes";
import { numero } from "@/lib/inventario";
import { cn, pesos } from "@/lib/utilidades";
import { hoyBogota } from "@/lib/ventas";

export const metadata: Metadata = { title: "Inicio" };

type Alerta = { variante_id: string; sku: string; producto: string; bodega: string; cantidad: number; stock_minimo: number; alerta: string };

export default async function Inicio() {
  const sesion = await exigirSesion();
  const supabase = await crearClienteServidor();
  const puede = (...p: string[]) => tiene(sesion, ...p);
  const hoy = hoyBogota();
  const mes = resolverPeriodo({ periodo: "mes" });
  const catorce = { desde: restarDias(hoy, 13), hasta: hoy };

  const [operacion, informe, informeMes, financiero, alertas] = await Promise.all([
    supabase.rpc("resumen_operacion", { p_desde: hoy, p_hasta: hoy }),
    puede("informes.ver") ? supabase.rpc("informe_ventas", { p_desde: catorce.desde, p_hasta: catorce.hasta }) : Promise.resolve({ data: null }),
    puede("informes.ver") ? supabase.rpc("informe_ventas", { p_desde: mes.desde, p_hasta: mes.hasta }) : Promise.resolve({ data: null }),
    puede("informes.financieros") ? supabase.rpc("resumen_financiero", { p_desde: mes.desde, p_hasta: mes.hasta }) : Promise.resolve({ data: null }),
    puede("inventario.ver") ? supabase.rpc("alertas_inventario", {}) : Promise.resolve({ data: [] }),
  ]);
  const ventas = (operacion.data?.ventas ?? null) as Record<string, number> | null;
  const inventario = (operacion.data?.inventario ?? null) as Record<string, number> | null;
  const quince = informe.data as InformeVentas | null;
  const delMes = informeMes.data as InformeVentas | null;
  const fin = financiero.data as ResumenFinanciero | null;
  const urgentes = ((alertas.data ?? []) as Alerta[]).filter((a) => a.alerta !== "pocas_unidades");
  const sinPuntos = sesion.bodegas.length === 0;
  const vende = puede("ventas.crear") && sesion.bodegas.some((b) => b.tipo === "punto_venta");
  const porDia = new Map((quince?.por_dia ?? []).map((d) => [d.fecha, Number(d.valor)]));

  const accesos = [
    { ver: vende, href: "/ventas/nueva", texto: "Nueva venta", Icono: Plus, principal: true },
    { ver: puede("ventas.entregar", "ventas.crear"), href: "/ventas/pedidos", texto: `Pedidos por entregar${ventas?.pedidos_pendientes ? ` (${ventas.pedidos_pendientes})` : ""}`, Icono: ClipboardList },
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ventas && (
          <>
            <Cifra titulo={puede("ventas.ver") ? "Ventas de hoy" : "Tus ventas de hoy"} valor={pesos(ventas.ventas_netas_entregadas)} etiqueta="Calculado"
                   detalle={`${ventas.ventas_entregadas ?? 0} entregada(s) · recibido ${pesos(ventas.recibido)}`} />
            <Cifra titulo="Pedidos pendientes" valor={String(ventas.pedidos_pendientes ?? 0)} etiqueta="Conteo"
                   detalle={`Anticipos: ${pesos(ventas.anticipos_pedidos_pendientes)}`} />
            <Cifra titulo="Por estampar" valor={String(ventas.por_estampar ?? 0)} etiqueta="Conteo" />
          </>
        )}
        {inventario && (
          <Cifra titulo="Camisetas terminadas" valor={numero(inventario.unidades_terminadas ?? 0)} etiqueta="Conteo"
                 detalle={`Base: ${numero(inventario.unidades_base ?? 0)} · agotados: ${inventario.agotados ?? 0} · bajo mínimo: ${inventario.stock_bajo ?? 0}`} />
        )}
      </div>

      {(quince || fin) && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
          {quince && (
            <Tarjeta>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="flex-1 text-lg font-semibold text-morado">Ventas de los últimos 14 días</h2>
                <Link href="/informes?periodo=30d" className="text-sm font-semibold text-morado underline">Ver informe</Link>
              </div>
              <GraficaBarras titulo="Valor vendido por día en los últimos 14 días"
                             datos={diasEntre(catorce.desde, catorce.hasta).map((d) => ({ etiqueta: diaCorto(d), valor: porDia.get(d) ?? 0 }))} />
              <p className="mt-1 text-sm text-suave">
                Total: <b className="cifra text-tinta">{pesos(quince.totales.valor)}</b> en {quince.totales.ventas} venta(s) entregada(s).
              </p>
            </Tarjeta>
          )}
          {fin && (
            <Tarjeta>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="flex-1 text-lg font-semibold text-morado">Este mes</h2>
                <Insignia tono="marca">Calculado</Insignia>
              </div>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between"><dt className="text-suave">Ventas netas</dt><dd className="cifra">{pesos(fin.calculado.ventas_netas)}</dd></div>
                <div className="flex justify-between"><dt className="text-suave">Utilidad bruta</dt><dd className="cifra">{pesos(fin.calculado.utilidad_bruta)}</dd></div>
                <div className="flex justify-between"><dt className="text-suave">Gastos operativos</dt><dd className="cifra">− {pesos(fin.calculado.gastos_operativos)}</dd></div>
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
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {delMes && delMes.por_producto.length > 0 && (
          <Tarjeta>
            <h2 className="mb-3 text-lg font-semibold text-morado">Lo más vendido este mes</h2>
            <BarrasHorizontales formato="numero" datos={delMes.por_producto.slice()
              .sort((a, b) => Number(b.unidades) - Number(a.unidades)).slice(0, 5)
              .map((p) => ({ etiqueta: `${p.producto}${p.detalle ? ` · ${p.detalle}` : ""}`, valor: Number(p.unidades), detalle: pesos(p.valor) }))} />
          </Tarjeta>
        )}
        {urgentes.length > 0 && (
          <Tarjeta>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flex-1 text-lg font-semibold text-morado">Para reponer</h2>
              <Link href={puede("informes.inventario") ? "/informes/inventario" : "/inventario"} className="text-sm font-semibold text-morado underline">Ver todo</Link>
            </div>
            <ul className="flex flex-col divide-y divide-borde text-sm">
              {urgentes.slice(0, 6).map((a) => (
                <li key={`${a.variante_id}-${a.bodega}`} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">{a.producto} <span className="text-suave">({a.sku}) · {a.bodega}</span></span>
                  <Insignia tono={a.alerta === "agotado" ? "error" : "alerta"}>{a.alerta === "agotado" ? "Agotado" : `Quedan ${numero(a.cantidad)}`}</Insignia>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </div>
    </>
  );
}

function Cifra({ titulo, valor, etiqueta, detalle }: { titulo: string; valor: string; etiqueta: string; detalle?: string }) {
  return (
    <Tarjeta className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-suave">{titulo}</p>
      <p className="cifra font-titulo text-2xl font-semibold text-morado">{valor}</p>
      <p className="text-xs text-suave">{etiqueta}</p>
      {detalle && <p className="text-xs text-suave">{detalle}</p>}
    </Tarjeta>
  );
}
