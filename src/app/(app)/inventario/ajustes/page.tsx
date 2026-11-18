import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { obtenerVariantes } from "@/lib/catalogo";
import { TIPOS_AJUSTE, numero } from "@/lib/inventario";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { PestanasInventario } from "@/components/app/pestanas-inventario";
import { NuevoAjuste, ResolverAjuste } from "../formularios";
import { fecha } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Ajustes de inventario" };

type Ajuste = {
  id: string; numero: string; tipo: string; motivo: string; estado: string; solicitado_por: string | null; solicitado_en: string;
  resuelto_por: string | null; observacion: string | null; bodegas: { nombre: string } | null;
  ajuste_lineas: { id: string; cantidad: number; variantes: { sku: string; productos: { nombre: string } } | null }[];
};

const ESTADOS: Record<string, { texto: string; tono: "alerta" | "exito" | "error" }> = {
  pendiente: { texto: "Pendiente", tono: "alerta" }, aprobado: { texto: "Aplicado", tono: "exito" }, rechazado: { texto: "Rechazado", tono: "error" },
};

export default async function PaginaAjustes() {
  const sesion = await exigirPermiso("inventario.ajustar", "inventario.aprobar_ajuste", "inventario.kardex");
  const supabase = await crearClienteServidor();
  const [{ data }, { data: nombres }, variantes] = await Promise.all([
    supabase.from("ajustes_inventario")
      .select("id, numero, tipo, motivo, estado, solicitado_por, solicitado_en, resuelto_por, observacion, bodegas(nombre), ajuste_lineas(id, cantidad, variantes(sku, productos(nombre)))")
      .order("solicitado_en", { ascending: false }).limit(100),
    supabase.rpc("usuarios_nombres"),
    tiene(sesion, "inventario.ajustar") ? obtenerVariantes(supabase) : Promise.resolve([]),
  ]);
  const nombre = new Map(((nombres ?? []) as { id: string; nombre: string }[]).map((n) => [n.id, n.nombre]));
  const ajustes = (data ?? []) as unknown as Ajuste[];
  const puedeAprobar = tiene(sesion, "inventario.aprobar_ajuste");
  const puntos = sesion.bodegas.map((b) => ({ id: b.id, nombre: b.nombre }));

  return (
    <>
      <Encabezado titulo="Inventario" descripcion="Las existencias no se editan: se corrigen con un ajuste justificado." />
      <PestanasInventario actual="/inventario/ajustes" permisos={sesion.permisos} />
      <div className="grid gap-4 xl:grid-cols-[1fr_460px]">
        <div className="flex flex-col gap-3">
          {ajustes.length === 0 && <Tarjeta className="text-center text-suave">Aún no hay ajustes.</Tarjeta>}
          {ajustes.map((a) => (
            <Tarjeta key={a.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{a.numero}</span>
                <span className="text-sm text-suave">{TIPOS_AJUSTE[a.tipo]} · {a.bodegas?.nombre} · {fecha(a.solicitado_en)}</span>
                <span className="ml-auto"><Insignia tono={ESTADOS[a.estado].tono}>{ESTADOS[a.estado].texto}</Insignia></span>
              </div>
              <p className="mt-1 text-sm">{a.motivo}</p>
              <ul className="mt-2 text-sm text-suave">
                {a.ajuste_lineas.map((l) => (
                  <li key={l.id}>{l.variantes?.productos.nombre} · {l.variantes?.sku}: <b className="cifra text-tinta">{Number(l.cantidad) > 0 ? "+" : ""}{numero(l.cantidad)}</b></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-suave">
                Solicitó {nombre.get(a.solicitado_por ?? "") ?? "—"}{a.resuelto_por ? ` · resolvió ${nombre.get(a.resuelto_por) ?? "—"}` : ""}
                {a.observacion ? ` · ${a.observacion}` : ""}
              </p>
              {a.estado === "pendiente" && puedeAprobar && (a.solicitado_por !== sesion.usuarioId || sesion.esAdministrador) && (
                <div className="mt-3"><ResolverAjuste id={a.id} /></div>
              )}
            </Tarjeta>
          ))}
        </div>
        {tiene(sesion, "inventario.ajustar") && (
          <Tarjeta className="h-fit">
            {puntos.length ? <NuevoAjuste puntos={puntos} variantes={variantes} veCostos={tiene(sesion, "costos.ver")} />
              : <p className="text-suave">No tienes puntos de venta asignados.</p>}
          </Tarjeta>
        )}
      </div>
    </>
  );
}
