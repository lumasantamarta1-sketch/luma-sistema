"use server";

import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function salir(motivo?: string) {
  const supabase = await crearClienteServidor();
  // Historial de usuarios: la salida queda en la auditoría antes de cerrar la sesión
  await supabase.rpc("registrar_sesion", { p_evento: "salida", p_motivo: motivo === "inactividad" ? "inactividad" : null });
  await supabase.auth.signOut();
  redirect(motivo === "inactividad" ? "/ingresar?motivo=inactividad" : "/ingresar");
}
