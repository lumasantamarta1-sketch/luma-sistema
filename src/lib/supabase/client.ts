import { createBrowserClient } from "@supabase/ssr";

// Cliente del navegador: solo la llave publicable; RLS decide qué puede leer.
export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
