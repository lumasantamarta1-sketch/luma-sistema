import type { Metadata } from "next";
import Image from "next/image";
import { exigirSesion } from "@/lib/sesion";
import { FormularioClave } from "./formulario";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default async function PaginaCambiarClave() {
  const sesion = await exigirSesion({ permitirCambioClave: true });
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-borde bg-white p-6 shadow-sm">
        <Image src="/marca/logo-luma.png" alt="LUMA · Ideas que cobran vida" width={900} height={549}
               className="mx-auto mb-4 h-auto w-40" />
        <FormularioClave obligatorio={sesion.debeCambiarClave} />
      </div>
    </main>
  );
}
