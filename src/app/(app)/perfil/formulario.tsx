"use client";

import { useActionState } from "react";
import { actualizarNombre, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

export function FormularioPerfil({ nombre }: { nombre: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(actualizarNombre, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <Campo etiqueta="Nombre" name="nombre" defaultValue={nombre} autoComplete="name" required />
      <div><Boton type="submit" cargando={enviando}>Guardar</Boton></div>
    </form>
  );
}
