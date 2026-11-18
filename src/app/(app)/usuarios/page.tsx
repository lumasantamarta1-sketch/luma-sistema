import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { EditarUsuario, NuevoUsuario } from "./formularios";
import { fecha } from "@/lib/utilidades";

export const metadata: Metadata = { title: "Usuarios" };

export default async function PaginaUsuarios() {
  const sesion = await exigirPermiso("usuarios.gestionar");
  const supabase = await crearClienteServidor();
  const [{ data: perfiles }, { data: roles }, { data: asignaciones }, { data: bodegas }] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, correo, rol_id, activo, debe_cambiar_clave, creado_en").order("nombre"),
    supabase.from("roles").select("id, codigo, nombre, activo").order("nombre"),
    supabase.from("usuario_bodegas").select("usuario_id, bodega_id"),
    supabase.from("bodegas").select("id, nombre, activo").eq("activo", true).order("nombre"),
  ]);
  const rolesActivos = (roles ?? []).filter((r) => r.activo);
  const nombreRol = new Map((roles ?? []).map((r) => [r.id, r.nombre]));
  const nombreBodega = new Map((bodegas ?? []).map((b) => [b.id, b.nombre]));

  return (
    <>
      <Encabezado
        titulo="Usuarios"
        descripcion="Cada usuario entra con su correo, tiene un rol y trabaja en los puntos que le asignes."
        acciones={
          <Link href="/usuarios/roles" className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado hover:bg-morado-50">
            Roles y permisos
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-3">
          {(perfiles ?? []).map((p) => {
            const suyas = (asignaciones ?? []).filter((a) => a.usuario_id === p.id).map((a) => a.bodega_id);
            return (
              <Tarjeta key={p.id}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{p.nombre || p.correo}</span>
                    <span className="text-sm text-suave">{p.correo}</span>
                    <span className="ml-auto flex flex-wrap gap-1.5">
                      <Insignia tono={p.rol_id ? "marca" : "alerta"}>{p.rol_id ? nombreRol.get(p.rol_id) : "Sin rol"}</Insignia>
                      {!p.activo && <Insignia tono="error">Inactivo</Insignia>}
                      {p.debe_cambiar_clave && p.activo && <Insignia>Contraseña temporal</Insignia>}
                    </span>
                    <span className="w-full text-sm text-suave">
                      {suyas.map((b) => nombreBodega.get(b)).filter(Boolean).join(", ") || "Sin puntos de venta"} · desde {fecha(p.creado_en)}
                    </span>
                  </summary>
                  <div className="mt-4">
                    <EditarUsuario
                      usuario={{ id: p.id, nombre: p.nombre, rol_id: p.rol_id, activo: p.activo, bodegas: suyas }}
                      roles={rolesActivos}
                      bodegas={bodegas ?? []}
                      esYo={p.id === sesion.usuarioId}
                    />
                  </div>
                </details>
              </Tarjeta>
            );
          })}
        </div>
        <Tarjeta className="h-fit">
          <NuevoUsuario roles={rolesActivos} bodegas={bodegas ?? []} />
        </Tarjeta>
      </div>
    </>
  );
}
