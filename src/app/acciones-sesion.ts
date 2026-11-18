"use server";

import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function salir(motivo?: string) {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect(motivo === "inactividad" ? "/ingresar?motivo=inactividad" : "/ingresar");
}
