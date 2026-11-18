"use client";

import { useActionState } from "react";
import { cambiarClave, type EstadoClave } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

export function FormularioClave({ obligatorio }: { obligatorio: boolean }) {
  const [estado, accion, enviando] = useActionState<EstadoClave, FormData>(cambiarClave, {});
  return (
    <form action={accion} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-semibold text-morado">{obligatorio ? "Crea tu contraseña" : "Cambiar contraseña"}</h1>
      {obligatorio && (
        <Aviso tipo="info">Entraste con una contraseña temporal. Crea una propia para continuar.</Aviso>
      )}
      {estado.error && <Aviso>{estado.error}</Aviso>}
      <Campo etiqueta="Contraseña nueva" name="clave" type="password" autoComplete="new-password"
             ayuda="Mínimo 8 caracteres." required />
      <Campo etiqueta="Repite la contraseña" name="confirmacion" type="password" autoComplete="new-password" required />
      <Boton type="submit" cargando={enviando}>Guardar contraseña</Boton>
    </form>
  );
}
