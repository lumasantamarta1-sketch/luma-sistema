import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerVariantes } from "@/lib/catalogo";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { NuevaOrden } from "./formularios";
import { fecha } from "@/lib/utilidades";
import { ESTADOS_ORDEN } from "@/lib/inventario";

export const metadata: Metadata = { title: "Estampado" };

type Orden = {
  id: string; numero: string; estado: string; venta_id: string | null; creado_en: string; bodegas: { nombre: string } | null;
  orden_estampado_lineas: { id: string; cantidad_planeada: number; cantidad_buenas: number | null; cantidad_danadas: number | null;
    variantes: { sku: string; productos: { nombre: string } } | null }[];
};


export default async function PaginaEstampado() {
  const sesion = await exigirPermiso("estampado.ver", "estampado.gestionar");
  const supabase = await crearClienteServidor();
  const gestiona = tiene(sesion, "estampado.gestionar");
  const [{ data }, variantes] = await Promise.all([
    supabase.from("ordenes_estampado")
      .select("id, numero, estado, venta_id, creado_en, bodegas(nombre), orden_estampado_lineas(id, cantidad_planeada, cantidad_buenas, cantidad_danadas, variantes(sku, productos(nombre)))")
      .order("creado_en", { ascending: false }).limit(100),
    gestiona ? obtenerVariantes(supabase, { clases: ["terminado"] }) : Promise.resolve([]),
  ]);
  const ordenes = (data ?? []) as unknown as Orden[];
  const pendientes = ordenes.filter((o) => o.estado === "borrador");

  return (
    <>
      <Encabezado titulo="Estampado" descripcion="Convierte camisetas base y materiales en camisetas terminadas, cada una con su costo real." />
      <div className="grid gap-4 xl:grid-cols-[1fr_460px]">
        <div className="flex flex-col gap-3">
          {pendientes.length > 0 && <p className="text-sm font-semibold text-suave">{pendientes.length} orden(es) por estampar</p>}
          {ordenes.length === 0 && <Tarjeta className="text-center text-suave">Aún no hay órdenes de estampado.</Tarjeta>}
          {ordenes.map((o) => (
            <Link key={o.id} href={`/estampado/${o.id}`} className="block rounded-2xl border border-borde bg-white p-4 hover:border-morado">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{o.numero}</span>
                <span className="text-sm text-suave">{o.bodegas?.nombre} · {fecha(o.creado_en)}</span>
                {o.venta_id && <Insignia tono="marca">Pedido personalizado</Insignia>}
                <span className="ml-auto"><Insignia tono={ESTADOS_ORDEN[o.estado].tono}>{ESTADOS_ORDEN[o.estado].texto}</Insignia></span>
              </div>
              <ul className="mt-2 text-sm text-suave">
                {o.orden_estampado_lineas.map((l) => (
                  <li key={l.id}>{l.variantes?.productos.nombre} · {l.variantes?.sku}: <b className="cifra text-tinta">{Number(l.cantidad_planeada)}</b>
                    {o.estado === "terminada" && ` → ${Number(l.cantidad_buenas)} buenas, ${Number(l.cantidad_danadas)} dañadas`}</li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
        {gestiona && (
          <Tarjeta className="h-fit">
            {sesion.bodegas.length ? <NuevaOrden puntos={sesion.bodegas} variantes={variantes} veCostos={tiene(sesion, "costos.ver")} />
              : <p className="text-suave">No tienes puntos asignados.</p>}
          </Tarjeta>
        )}
      </div>
    </>
  );
}
