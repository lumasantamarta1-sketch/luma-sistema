"use client";

import Link from "next/link";
import { useActionState } from "react";
import { recuperar, type EstadoFormulario } from "../acciones";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

export function FormularioRecuperar() {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(recuperar, {});
  return (
    <form action={accion} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold text-morado">Recuperar contraseña</h1>
      <p className="text-sm text-suave">
        Te enviaremos un enlace a tu correo. También puedes pedirle al administrador una contraseña temporal.
      </p>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <Campo etiqueta="Correo" name="correo" type="email" autoComplete="username" inputMode="email" required />
      <Boton type="submit" cargando={enviando}>Enviar enlace</Boton>
      <Link href="/ingresar" className="text-center text-sm font-semibold text-morado hover:underline">Volver a ingresar</Link>
    </form>
  );
}
