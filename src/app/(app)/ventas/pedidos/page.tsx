import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ESTADO_LINEA, HECHOS, estadoVenta, saldoVenta } from "@/lib/ventas";
import { fecha, mensajeError, pesos } from "@/lib/utilidades";
import { PestanasVentas } from "@/components/app/pestanas-ventas";
import { Aviso } from "@/components/ui/aviso";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { ApartarVenta, EntregarVenta } from "../formularios";

export const metadata: Metadata = { title: "Pedidos por entregar" };

type Pedido = {
  venta_id: string; numero: string; confirmada_en: string; bodega: string; cliente: string; estado_entrega: string; observaciones: string | null;
  lineas: { venta_linea_id: string; sku: string; producto: string; talla: string | null; color: string | null; cantidad: number;
    apartada: number; estado: string; personalizacion: string | null; se_puede_apartar: boolean }[];
};

export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<{ punto?: string; hecho?: string }> }) {
  const filtros = await searchParams;
  const sesion = await exigirPermiso("ventas.entregar", "ventas.crear");
  const supabase = await crearClienteServidor();
  const puntos = sesion.bodegas.filter((b) => b.tipo === "punto_venta");
  const punto = puntos.some((p) => p.id === filtros.punto) ? filtros.punto : null;
  const { data, error } = await supabase.rpc("pedidos_por_preparar", { p_bodega: punto });
  const pedidos = (data ?? []) as Pedido[];
  const { data: saldos } = pedidos.length
    ? await supabase.from("ventas").select("id, estado, total, pagos_venta(tipo, valor), devoluciones_venta(valor_total)").in("id", pedidos.map((p) => p.venta_id))
    : { data: [] };
  const saldoDe = new Map((saldos ?? []).map((v) => [v.id as string, saldoVenta(v as Parameters<typeof saldoVenta>[0])]));
  const entrega = tiene(sesion, "ventas.entregar");

  return (
    <>
      <Encabezado titulo="Pedidos por entregar" descripcion="Ventas confirmadas que aún no se entregan: por apartar, por estampar o listas para el cliente." />
      <PestanasVentas actual="/ventas/pedidos" permisos={sesion.permisos} />
      {filtros.hecho && HECHOS[filtros.hecho] && <div className="mb-4"><Aviso tipo="exito">{HECHOS[filtros.hecho]}</Aviso></div>}
      {puntos.length > 1 && (
        <div className="mb-4 flex gap-1 overflow-x-auto">
          {[{ id: "", nombre: "Todos los puntos" }, ...puntos].map((p) => (
            <Link key={p.id} href={p.id ? `/ventas/pedidos?punto=${p.id}` : "/ventas/pedidos"} aria-current={(punto ?? "") === p.id ? "true" : undefined}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${(punto ?? "") === p.id ? "border-morado bg-morado text-white" : "border-borde bg-white text-suave"}`}>
              {p.nombre}
            </Link>
          ))}
        </div>
      )}
      {error && <Tarjeta className="text-error">{mensajeError(error)}</Tarjeta>}
      {!error && pedidos.length === 0 && <Tarjeta className="text-center text-suave">No hay pedidos pendientes de entrega.</Tarjeta>}
      <div className="grid gap-3 lg:grid-cols-2">
        {pedidos.map((p) => {
          const { texto, tono } = estadoVenta({ estado: "confirmada", estado_entrega: p.estado_entrega });
          const saldo = saldoDe.get(p.venta_id) ?? 0;
          return (
            <Tarjeta key={p.venta_id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/ventas/${p.venta_id}`} className="font-semibold text-morado underline">{p.numero}</Link>
                <span className="text-sm text-suave">{p.cliente} · {p.bodega} · {fecha(p.confirmada_en)}</span>
                <span className="ml-auto"><Insignia tono={tono}>{texto}</Insignia></span>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {p.lineas.map((l) => (
                  <li key={l.venta_linea_id} className="flex flex-wrap justify-between gap-2">
                    <span>{l.producto}{[l.talla, l.color].filter(Boolean).length ? ` · ${[l.talla, l.color].filter(Boolean).join(" · ")}` : ""} <span className="text-suave">({l.sku})</span>
                      {l.personalizacion && <span className="block text-suave">Personalización: <b className="text-tinta">{l.personalizacion}</b></span>}</span>
                    <span className="cifra">{Number(l.apartada)}/{Number(l.cantidad)} · {ESTADO_LINEA[l.estado] ?? l.estado}</span>
                  </li>
                ))}
              </ul>
              {p.observaciones && <p className="rounded-xl bg-morado-50 p-2 text-sm">{p.observaciones}</p>}
              {saldo > 0 && <p className="cifra text-sm font-semibold text-naranja">Saldo pendiente: {pesos(saldo)}</p>}
              {p.lineas.some((l) => l.se_puede_apartar) && <ApartarVenta ventaId={p.venta_id} volver="/ventas/pedidos" />}
              {p.estado_entrega === "en_preparacion" && entrega && (
                <EntregarVenta key={saldo} ventaId={p.venta_id} saldo={saldo} credito={tiene(sesion, "ventas.credito")} volver="/ventas/pedidos" />
              )}
            </Tarjeta>
          );
        })}
      </div>
    </>
  );
}
