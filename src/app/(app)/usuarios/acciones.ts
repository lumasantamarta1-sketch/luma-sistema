"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { mensajeError } from "@/lib/utilidades";

export type Estado = { error?: string; exito?: string };

const uuid = z.string().uuid();
const clave = z.string().min(8, "La contraseña temporal debe tener al menos 8 caracteres.").max(72);

function bodegasDe(datos: FormData) {
  return datos.getAll("bodegas").map(String).filter((b) => uuid.safeParse(b).success);
}

// Crea el usuario en Supabase Auth con una contraseña temporal y le asigna rol y puntos.
// La llave secreta solo se usa aquí, después de verificar el permiso del administrador.
export async function crearUsuario(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("usuarios.gestionar");
  const r = z
    .object({
      nombre: z.string().trim().min(2, "Escribe el nombre."),
      correo: z.string().trim().toLowerCase().email("Escribe un correo válido."),
      clave,
      rol_id: uuid.or(z.literal("")),
    })
    .safeParse(Object.fromEntries(datos));
  if (!r.success) return { error: r.error.issues[0]?.message };

  let admin;
  try {
    admin = crearClienteAdmin();
  } catch {
    return { error: "Falta configurar la llave secreta de Supabase en el servidor (SUPABASE_SECRET_KEY)." };
  }
  const { data: creado, error } = await admin.auth.admin.createUser({
    email: r.data.correo,
    password: r.data.clave,
    email_confirm: true,
    user_metadata: { nombre: r.data.nombre },
  });
  if (error || !creado.user) return { error: mensajeError(error) };

  // El perfil lo crea la base de datos; el rol se asigna con la sesión del administrador
  const supabase = await crearClienteServidor();
  const { error: errorRol } = await supabase.rpc("asignar_usuario", {
    p_usuario: creado.user.id,
    p_datos: {
      nombre: r.data.nombre,
      rol_id: r.data.rol_id || null,
      debe_cambiar_clave: true,
      bodegas: bodegasDe(datos),
    },
  });
  if (errorRol) return { error: `El usuario se creó, pero no se pudo asignar su rol: ${mensajeError(errorRol)}` };
  revalidatePath("/usuarios");
  return { exito: `Listo. ${r.data.nombre} ya puede ingresar con su correo y la contraseña temporal; se le pedirá cambiarla.` };
}

export async function actualizarUsuario(_: Estado, datos: FormData): Promise<Estado> {
  const sesion = await exigirPermiso("usuarios.gestionar");
  const r = z
    .object({
      usuario_id: uuid,
      nombre: z.string().trim().min(2, "Escribe el nombre."),
      rol_id: uuid.or(z.literal("")),
      activo: z.enum(["si", "no"]),
    })
    .safeParse({
      usuario_id: datos.get("usuario_id"),
      nombre: datos.get("nombre"),
      rol_id: datos.get("rol_id"),
      activo: datos.get("activo") ? "si" : "no",
    });
  if (!r.success) return { error: r.error.issues[0]?.message };
  const activo = r.data.activo === "si";
  if (!activo && r.data.usuario_id === sesion.usuarioId) return { error: "No puedes desactivar tu propio usuario." };

  const supabase = await crearClienteServidor();
  const { data: antes } = await supabase.from("perfiles").select("activo").eq("id", r.data.usuario_id).maybeSingle();
  const { error } = await supabase.rpc("asignar_usuario", {
    p_usuario: r.data.usuario_id,
    p_datos: { nombre: r.data.nombre, rol_id: r.data.rol_id || null, activo, bodegas: bodegasDe(datos) },
  });
  if (error) return { error: mensajeError(error) };

  // Desactivar también bloquea el ingreso en Auth; reactivar lo desbloquea
  if (antes && antes.activo !== activo) {
    try {
      await crearClienteAdmin().auth.admin.updateUserById(r.data.usuario_id, { ban_duration: activo ? "none" : "876000h" });
    } catch {
      return { exito: "Cambios guardados. Sin la llave secreta en el servidor, el bloqueo en Auth queda pendiente; RLS ya le impide ver datos." };
    }
  }
  revalidatePath("/usuarios");
  return { exito: "Cambios guardados." };
}

export async function restablecerClave(_: Estado, datos: FormData): Promise<Estado> {
  await exigirPermiso("usuarios.gestionar");
  const r = z.object({ usuario_id: uuid, clave }).safeParse({ usuario_id: datos.get("usuario_id"), clave: datos.get("clave") });
  if (!r.success) return { error: r.error.issues[0]?.message };
  let admin;
  try {
    admin = crearClienteAdmin();
  } catch {
    return { error: "Falta configurar la llave secreta de Supabase en el servidor (SUPABASE_SECRET_KEY)." };
  }
  const { error } = await admin.auth.admin.updateUserById(r.data.usuario_id, { password: r.data.clave });
  if (error) return { error: mensajeError(error) };
  const supabase = await crearClienteServidor();
  const { error: e2 } = await supabase.rpc("asignar_usuario", { p_usuario: r.data.usuario_id, p_datos: { debe_cambiar_clave: true } });
  if (e2) return { error: mensajeError(e2) };
  revalidatePath("/usuarios");
  return { exito: "Contraseña temporal asignada. Se le pedirá cambiarla al ingresar." };
}
