import "server-only";
import { createClient } from "@supabase/supabase-js";

// Cliente con la llave secreta: se salta RLS. Solo para administrar usuarios de Auth
// (crear, restablecer contraseña, bloquear), siempre después de verificar el permiso
// usuarios.gestionar con la sesión del administrador.
export function crearClienteAdmin() {
  const secreta = process.env.SUPABASE_SECRET_KEY;
  if (!secreta) {
    throw new Error("Falta la variable SUPABASE_SECRET_KEY en el servidor.");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secreta, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
