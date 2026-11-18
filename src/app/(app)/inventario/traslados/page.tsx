import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerVariantes } from "@/lib/catalogo";
import { numero } from "@/lib/inventario";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { PestanasInventario } from "@/components/app/pestanas-inventario";
import { AccionTraslado, NuevoTraslado } from "../formularios";
import { fecha } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Traslados" };

type Traslado = {
  id: string; numero: string; estado: string; creado_en: string; observaciones: string | null; origen_id: string; destino_id: string;
  origen: { nombre: string } | null; destino: { nombre: string } | null;
  traslado_lineas: { id: string; cantidad: number; variantes: { sku: string; productos: { nombre: string } } | null }[];
};

const ESTADOS: Record<string, { texto: string; tono: "neutro" | "alerta" | "exito" | "error" }> = {
  borrador: { texto: "Borrador", tono: "neutro" }, enviado: { texto: "En camino", tono: "alerta" },
  recibido: { texto: "Recibido", tono: "exito" }, anulado: { texto: "Anulado", tono: "error" },
};

export default async function PaginaTraslados() {
  const sesion = await exigirPermiso("traslados.ver", "traslados.gestionar");
  const supabase = await crearClienteServidor();
  const gestiona = tiene(sesion, "traslados.gestionar");
  const [{ data }, { data: destinos }, variantes] = await Promise.all([
    supabase.from("traslados")
      .select("id, numero, estado, creado_en, observaciones, origen_id, destino_id, origen:bodegas!traslados_origen_id_fkey(nombre), destino:bodegas!traslados_destino_id_fkey(nombre), traslado_lineas(id, cantidad, variantes(sku, productos(nombre)))")
      .order("creado_en", { ascending: false }).limit(100),
    supabase.from("bodegas").select("id, nombre").eq("activo", true).order("nombre"),
    gestiona ? obtenerVariantes(supabase) : Promise.resolve([]),
  ]);
  const traslados = (data ?? []) as unknown as Traslado[];
  const mios = new Set(sesion.bodegas.map((b) => b.id));

  return (
    <>
      <Encabezado titulo="Inventario" descripcion="La mercancía sale del origen al enviarse y entra al destino al recibirse." />
      <PestanasInventario actual="/inventario/traslados" permisos={sesion.permisos} />
      <div className="grid gap-4 xl:grid-cols-[1fr_460px]">
        <div className="flex flex-col gap-3">
          {traslados.length === 0 && <Tarjeta className="text-center text-suave">Aún no hay traslados.</Tarjeta>}
          {traslados.map((t) => (
            <Tarjeta key={t.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{t.numero}</span>
                <span className="text-sm text-suave">{t.origen?.nombre} → {t.destino?.nombre} · {fecha(t.creado_en)}</span>
                <span className="ml-auto"><Insignia tono={ESTADOS[t.estado].tono}>{ESTADOS[t.estado].texto}</Insignia></span>
              </div>
              <ul className="mt-2 text-sm text-suave">
                {t.traslado_lineas.map((l) => <li key={l.id}>{l.variantes?.productos.nombre} · {l.variantes?.sku}: <b className="cifra text-tinta">{numero(l.cantidad)}</b></li>)}
              </ul>
              {gestiona && (
                <div className="mt-3 flex flex-wrap items-start gap-3">
                  {t.estado === "borrador" && mios.has(t.origen_id) && <AccionTraslado id={t.id} accion="enviar" texto="Enviar" variante="principal" />}
                  {t.estado === "enviado" && mios.has(t.destino_id) && <AccionTraslado id={t.id} accion="recibir" texto="Recibir" variante="principal" />}
                  {(t.estado === "borrador" || t.estado === "enviado") && mios.has(t.origen_id) && <AccionTraslado id={t.id} accion="anular" texto="Anular" variante="peligro" />}
                </div>
              )}
            </Tarjeta>
          ))}
        </div>
        {gestiona && (
          <Tarjeta className="h-fit">
            <NuevoTraslado puntos={sesion.bodegas} destinos={destinos ?? []} variantes={variantes} />
          </Tarjeta>
        )}
      </div>
    </>
  );
}
