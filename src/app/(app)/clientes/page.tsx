import type { Metadata } from "next";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { EditarCliente, NuevoCliente } from "./formularios";

export const metadata: Metadata = { title: "Clientes" };

type Cliente = {
  id: string; nombre: string; documento: string | null; telefono: string | null; whatsapp: string | null;
  correo: string | null; ciudad: string | null; direccion: string | null; activo: boolean;
};

export default async function PaginaClientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sesion = await exigirPermiso("clientes.ver", "clientes.crear", "clientes.gestionar");
  const { q = "" } = await searchParams;
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("clientes")
    .select("id, nombre, documento, telefono, whatsapp, correo, ciudad, direccion, activo")
    .order("nombre").limit(1000);
  const t = q.trim().toLowerCase();
  const clientes = ((data ?? []) as Cliente[]).filter((c) =>
    !t || [c.nombre, c.documento, c.telefono, c.whatsapp, c.correo].some((x) => x?.toLowerCase().includes(t)));
  const gestiona = tiene(sesion, "clientes.gestionar");
  const crea = tiene(sesion, "clientes.crear", "clientes.gestionar");

  return (
    <>
      <Encabezado titulo="Clientes" descripcion="Personas y empresas a las que les vendes. Se eligen al registrar una venta." />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-3">
          <form className="flex gap-2" role="search">
            <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre, teléfono o documento" aria-label="Buscar cliente"
                   className="min-h-11 flex-1 rounded-xl border border-borde bg-white px-3" />
            <button className="min-h-11 rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Buscar</button>
          </form>
          <p className="text-sm text-suave">{clientes.length} cliente(s)</p>
          {clientes.length === 0 && <Tarjeta className="text-center text-suave">No hay clientes{t ? " con esa búsqueda" : " todavía"}.</Tarjeta>}
          <ul className="flex flex-col gap-2">
            {clientes.map((c) => (
              <li key={c.id} className="rounded-2xl border border-borde bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.nombre}</span>
                  {!c.activo && <Insignia tono="error">Inactivo</Insignia>}
                </div>
                <p className="text-sm text-suave">
                  {[c.telefono && `Tel. ${c.telefono}`, c.whatsapp && `WhatsApp ${c.whatsapp}`, c.documento && `Doc. ${c.documento}`, c.ciudad]
                    .filter(Boolean).join(" · ") || "Sin datos de contacto"}
                </p>
                {gestiona && (
                  <details>
                    <summary className="mt-2 cursor-pointer text-sm font-semibold text-morado">Editar</summary>
                    <EditarCliente cliente={c} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
        {crea && <Tarjeta className="h-fit"><NuevoCliente /></Tarjeta>}
      </div>
    </>
  );
}
