"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ingresar, type EstadoFormulario } from "../acciones";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

export function FormularioIngreso({ aviso }: { aviso?: string }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(ingresar, {});
  return (
    <form action={accion} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold text-morado">Ingresar</h1>
      {aviso && !estado.error && <Aviso tipo="info">{aviso}</Aviso>}
      {estado.error && <Aviso>{estado.error}</Aviso>}
      <Campo etiqueta="Correo" name="correo" type="email" autoComplete="username" inputMode="email"
             defaultValue={estado.campos?.correo} required />
      <Campo etiqueta="Contraseña" name="clave" type="password" autoComplete="current-password" required />
      <Boton type="submit" cargando={enviando}>Ingresar</Boton>
      <Link href="/recuperar" className="text-center text-sm font-semibold text-morado underline-offset-4 hover:underline">
        Olvidé mi contraseña
      </Link>
    </form>
  );
}
