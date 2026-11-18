"use client";

import { useActionState } from "react";
import { crearRol, guardarPermisos, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

type Permiso = { codigo: string; modulo: string; descripcion: string };

export function MatrizPermisos({ rolId, soloLectura, permisos, marcados, exclusivos }: {
  rolId: string; soloLectura: boolean; permisos: Permiso[]; marcados: string[]; exclusivos: string[];
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(guardarPermisos, {});
  const modulos = [...new Set(permisos.map((p) => p.modulo))];
  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="rol_id" value={rolId} />
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      {soloLectura && <Aviso tipo="info">El Administrador tiene siempre todos los permisos.</Aviso>}
      <div className="grid gap-4 md:grid-cols-2">
        {modulos.map((m) => (
          <fieldset key={m} className="rounded-xl border border-borde p-3">
            <legend className="px-1 font-semibold text-morado">{m}</legend>
            {permisos.filter((p) => p.modulo === m).map((p) => {
              const bloqueado = soloLectura || exclusivos.includes(p.codigo);
              return (
                <label key={p.codigo} className="flex min-h-11 items-start gap-3 py-1.5">
                  <input type="checkbox" name="permisos" value={p.codigo} defaultChecked={marcados.includes(p.codigo)}
                         disabled={bloqueado} className="mt-0.5 size-5 shrink-0 accent-morado" />
                  <span className="text-sm">
                    {p.descripcion}
                    {exclusivos.includes(p.codigo) && !soloLectura && <span className="block text-xs text-suave">Solo el Administrador</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      {!soloLectura && <div><Boton type="submit" cargando={enviando}>Guardar permisos</Boton></div>}
    </form>
  );
}

export function NuevoRol() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearRol, {});
  return (
    <form action={accion} className="flex flex-col gap-3">
      <h2 className="font-semibold text-morado">Rol personalizado</h2>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <Campo etiqueta="Nombre" name="nombre" required />
      <Campo etiqueta="Descripción" name="descripcion" />
      <div><Boton type="submit" variante="secundario" cargando={enviando}>Crear rol</Boton></div>
    </form>
  );
}
