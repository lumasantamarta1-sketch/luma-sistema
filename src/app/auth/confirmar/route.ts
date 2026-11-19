import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { crearClienteServidor } from "@/lib/supabase/server";

// Recibe el enlace del correo de recuperación (código PKCE o token) y abre la sesión
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const siguiente = url.searchParams.get("siguiente") ?? "/cambiar-clave";
  const destino = siguiente.startsWith("/") && !siguiente.startsWith("//") ? siguiente : "/cambiar-clave";
  const supabase = await crearClienteServidor();

  const codigo = url.searchParams.get("code");
  const token = url.searchParams.get("token_hash");
  const tipo = url.searchParams.get("type") as EmailOtpType | null;

  let error: { message?: string } | true | null = null;
  if (codigo) {
    ({ error } = await supabase.auth.exchangeCodeForSession(codigo));
  } else if (token && tipo) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: token, type: tipo }));
  } else {
    error = true;
  }
  if (error) console.error("[auth/confirmar]", error === true ? "faltan parámetros" : error.message);
  return NextResponse.redirect(new URL(error ? "/ingresar?motivo=enlace" : destino, request.url));
}
