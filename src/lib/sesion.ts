import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Bodega = { id: string; nombre: string; tipo: string };

export type Sesion = {
  usuarioId: string;
  nombre: string;
  correo: string | null;
  activo: boolean;
  debeCambiarClave: boolean;
  rol: string | null;
  rolNombre: string | null;
  esAdministrador: boolean;
  permisos: string[];
  bodegas: Bodega[];
};

// Lee la sesión y los permisos una sola vez por solicitud (capa de acceso a datos).
export const obtenerSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await crearClienteServidor();
  const { data: reclamos } = await supabase.auth.getClaims();
  if (!reclamos?.claims) return null;
  const { data, error } = await supabase.rpc("mis_permisos");
  if (error || !data) {
    // Hay sesión de Auth pero no perfil utilizable: se trata como usuario sin acceso
    // (evita un ciclo entre /ingresar y el inicio).
    return {
      usuarioId: String(reclamos.claims.sub ?? ""), nombre: "", correo: (reclamos.claims.email as string) ?? null,
      activo: false, debeCambiarClave: false, rol: null, rolNombre: null, esAdministrador: false, permisos: [], bodegas: [],
    };
  }
  const d = data as Record<string, unknown>;
  return {
    usuarioId: String(d.usuario_id),
    nombre: String(d.nombre ?? ""),
    correo: (d.correo as string) ?? null,
    activo: Boolean(d.activo),
    debeCambiarClave: Boolean(d.debe_cambiar_clave),
    rol: (d.rol as string) ?? null,
    rolNombre: (d.rol_nombre as string) ?? null,
    esAdministrador: Boolean(d.es_administrador),
    permisos: (d.permisos as string[]) ?? [],
    bodegas: (d.bodegas as Bodega[]) ?? [],
  };
});

export function tiene(sesion: Sesion, ...permisos: string[]) {
  return permisos.some((p) => sesion.permisos.includes(p));
}

// Exige una sesión activa con rol. Si debe cambiar la contraseña, lo envía a hacerlo.
export async function exigirSesion(opciones: { permitirCambioClave?: boolean } = {}): Promise<Sesion> {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/ingresar");
  if (!sesion.activo || !sesion.rol) redirect("/sin-acceso");
  if (sesion.debeCambiarClave && !opciones.permitirCambioClave) redirect("/cambiar-clave");
  return sesion;
}

// Exige al menos uno de los permisos. La base de datos vuelve a verificarlo en cada operación.
export async function exigirPermiso(...permisos: string[]): Promise<Sesion> {
  const sesion = await exigirSesion();
  if (!tiene(sesion, ...permisos)) redirect("/sin-permiso");
  return sesion;
}
