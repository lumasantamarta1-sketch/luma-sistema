import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { MatrizPermisos, NuevoRol } from "./formularios";
import { cn } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Roles y permisos" };

// Permisos que la base de datos reserva al Administrador (reglas fijas de la sección 7)
const EXCLUSIVOS = ["descuentos.autorizar", "ventas.credito", "bodegas.todas"];

export default async function PaginaRoles({ searchParams }: { searchParams: Promise<{ rol?: string }> }) {
  await exigirPermiso("usuarios.gestionar");
  const { rol: codigoElegido } = await searchParams;
  const supabase = await crearClienteServidor();
  const [{ data: roles }, { data: permisos }, { data: asignados }] = await Promise.all([
    supabase.from("roles").select("id, codigo, nombre, descripcion, es_sistema, activo").order("es_sistema", { ascending: false }).order("nombre"),
    supabase.from("permisos").select("codigo, modulo, descripcion").order("modulo").order("codigo"),
    supabase.from("rol_permisos").select("rol_id, permiso_codigo"),
  ]);
  const elegido = (roles ?? []).find((r) => r.codigo === codigoElegido) ?? (roles ?? [])[0];

  return (
    <>
      <Encabezado titulo="Roles y permisos" descripcion="Cada permiso se verifica también en el servidor y en la base de datos."
                  acciones={<Link href="/usuarios" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver a usuarios</Link>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-4">
          <Tarjeta className="p-2">
            <nav className="flex flex-col gap-1" aria-label="Roles">
              {(roles ?? []).map((r) => (
                <Link key={r.id} href={`/usuarios/roles?rol=${r.codigo}`}
                      className={cn("flex min-h-11 items-center justify-between rounded-xl px-3 font-semibold",
                                    r.id === elegido?.id ? "bg-morado text-white" : "hover:bg-morado-50")}>
                  {r.nombre}
                  <span className="text-xs opacity-75">{(asignados ?? []).filter((a) => a.rol_id === r.id).length}</span>
                </Link>
              ))}
            </nav>
          </Tarjeta>
          <Tarjeta><NuevoRol /></Tarjeta>
        </div>
        {elegido && (
          <Tarjeta>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-morado">{elegido.nombre}</h2>
              {elegido.es_sistema && <Insignia>Rol de partida</Insignia>}
              {elegido.descripcion && <p className="w-full text-sm text-suave">{elegido.descripcion}</p>}
            </div>
            <MatrizPermisos
              key={elegido.id}
              rolId={elegido.id}
              soloLectura={elegido.codigo === "administrador"}
              permisos={permisos ?? []}
              marcados={(asignados ?? []).filter((a) => a.rol_id === elegido.id).map((a) => a.permiso_codigo)}
              exclusivos={EXCLUSIVOS}
            />
          </Tarjeta>
        )}
      </div>
    </>
  );
}
