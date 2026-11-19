"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Aviso } from "@/components/ui/aviso";
import { crearClienteNavegador } from "@/lib/supabase/client";

/**
 * Lee la sesión que Supabase deja en la dirección (#access_token=…&refresh_token=…&type=recovery),
 * la guarda en las cookies y lleva a crear la contraseña nueva. Devuelve el mensaje de error, o
 * null cuando ya está redirigiendo.
 */
async function abrirSesionDelEnlace(): Promise<string | null> {
  const datos = new URLSearchParams(window.location.hash.slice(1));
  const consulta = new URLSearchParams(window.location.search);
  // Los tokens no deben quedar en la barra de direcciones ni en el historial
  window.history.replaceState(null, "", window.location.pathname);

  const codigoError = datos.get("error_code") ?? consulta.get("error_code");
  if (codigoError || datos.get("error") || consulta.get("error")) {
    return codigoError === "otp_expired"
      ? "El enlace ya venció o ya se usó. Pide uno nuevo."
      : "El enlace no es válido. Pide uno nuevo.";
  }
  const acceso = datos.get("access_token");
  const renovacion = datos.get("refresh_token");
  if (!acceso || !renovacion) return "El enlace no es válido. Pide uno nuevo.";

  const { error } = await crearClienteNavegador().auth.setSession({ access_token: acceso, refresh_token: renovacion });
  if (error) return "No se pudo abrir la sesión con este enlace. Pide uno nuevo.";

  const tipo = datos.get("type");
  window.location.replace(tipo === "recovery" || tipo === "invite" ? "/cambiar-clave" : "/");
  return null;
}

export function AbrirSesion() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    abrirSesionDelEnlace().then((mensaje) => {
      if (activo && mensaje) setError(mensaje);
    });
    return () => {
      activo = false;
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-morado">Enlace no válido</h1>
        <Aviso>{error}</Aviso>
        <Link href="/recuperar" className="text-center text-sm font-semibold text-morado underline-offset-4 hover:underline">
          Pedir un enlace nuevo
        </Link>
        <Link href="/ingresar" className="text-center text-sm text-suave underline-offset-4 hover:underline">
          Ingresar con mi contraseña
        </Link>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-morado" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span>Abriendo tu sesión…</span>
    </div>
  );
}
