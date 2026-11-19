import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ESTADO_COMPRA, HECHOS_COMPRA } from "@/lib/compras";
import { numero } from "@/lib/inventario";
import { fecha } from "@/lib/utilidades";
import { Aviso } from "@/components/ui/aviso";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { RecibirCompra } from "../../formularios";

export const metadata: Metadata = { title: "Recibir compra" };

type Recepcion = {
  compra_id: string; numero: string; fecha: string; estado: string; proveedor: string; bodega: string;
  lineas: { compra_linea_id: string; sku: string; producto: string; cantidad: number; recibida: number; pendiente: number }[];
};

// Recepción sin costos: para quien recibe la mercancía en el punto
export default async function RecibirCompraPagina({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hecho?: string }> }) {
  const [{ id }, { hecho }] = await Promise.all([params, searchParams]);
  const sesion = await exigirPermiso("compras.recibir", "compras.gestionar");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.rpc("compra_para_recibir", { p_compra: id });
  if (error || !data) notFound();
  const c = data as Recepcion;
  const pendientes = (c.lineas ?? []).filter((l) => Number(l.pendiente) > 0);
  const abierta = c.estado === "confirmada" || c.estado === "recibida_parcial";
  return (
    <>
      <Encabezado titulo={`Recibir ${c.numero}`} descripcion={`${c.proveedor} · llega a ${c.bodega} · ${fecha(`${c.fecha}T12:00:00`)}`}
                  acciones={<Link href={tiene(sesion, "compras.ver") ? `/compras/${id}` : "/compras"}
                                  className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver</Link>} />
      {hecho && HECHOS_COMPRA[hecho] && <div className="mb-4"><Aviso tipo="exito">{HECHOS_COMPRA[hecho]}</Aviso></div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <Tarjeta>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1 text-lg font-semibold text-morado">Productos</h2>
            <Insignia tono={ESTADO_COMPRA[c.estado]?.tono}>{ESTADO_COMPRA[c.estado]?.texto ?? c.estado}</Insignia>
          </div>
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {(c.lineas ?? []).map((l) => (
              <li key={l.compra_linea_id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><b>{l.producto}</b> <span className="text-suave">({l.sku})</span></span>
                <span className="cifra">{numero(l.recibida)} de {numero(l.cantidad)} recibidas</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
        {abierta && pendientes.length > 0 ? (
          <Tarjeta>
            <h2 className="mb-2 text-lg font-semibold text-morado">Lo que llegó</h2>
            <RecibirCompra compraId={c.compra_id} volver="recibir" lineas={pendientes.map((l) => ({
              id: l.compra_linea_id, texto: `${l.producto} (${l.sku})`, pendiente: Number(l.pendiente), unidad: "",
            }))} />
          </Tarjeta>
        ) : (
          <Tarjeta className="h-fit text-suave">{c.estado === "recibida" ? "Ya se recibió toda la mercancía de esta compra." : "Esta compra no tiene mercancía por recibir."}</Tarjeta>
        )}
      </div>
    </>
  );
}
