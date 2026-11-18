import type { NextRequest } from "next/server";
import { actualizarSesion } from "@/lib/supabase/proxy";

// Renueva la sesión en cada solicitud y envía al ingreso a quien no la tenga.
// Es una revisión rápida; los permisos se validan en el servidor y en la base de datos.
export async function proxy(request: NextRequest) {
  return await actualizarSesion(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|marca/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
