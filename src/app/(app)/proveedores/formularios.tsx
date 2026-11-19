"use client";

import { useActionState } from "react";
import { crearProveedor, editarProveedor, type Estado } from "./acciones";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";

export type Proveedor = {
  id: string; nombre: string; identificacion_tributaria: string | null; contacto: string | null; telefono: string | null;
  correo: string | null; direccion: string | null; observaciones: string | null; activo: boolean;
};

function Campos({ p, prefijo }: { p?: Proveedor; prefijo: string }) {
  return (
    <>
      <Campo etiqueta="Nombre" name="nombre" id={`${prefijo}-nombre`} required maxLength={160} defaultValue={p?.nombre ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="NIT o cédula" name="identificacion_tributaria" id={`${prefijo}-nit`} maxLength={40} defaultValue={p?.identificacion_tributaria ?? ""} />
        <Campo etiqueta="Persona de contacto" name="contacto" id={`${prefijo}-contacto`} maxLength={120} defaultValue={p?.contacto ?? ""} />
        <Campo etiqueta="Teléfono" name="telefono" id={`${prefijo}-telefono`} inputMode="tel" maxLength={40} defaultValue={p?.telefono ?? ""} />
        <Campo etiqueta="Correo" name="correo" id={`${prefijo}-correo`} type="email" maxLength={200} defaultValue={p?.correo ?? ""} />
      </div>
      <Campo etiqueta="Dirección" name="direccion" id={`${prefijo}-direccion`} maxLength={200} defaultValue={p?.direccion ?? ""} />
      <Campo etiqueta="Observaciones" name="observaciones" id={`${prefijo}-observaciones`} maxLength={500} defaultValue={p?.observaciones ?? ""}
             placeholder="Qué vende, plazos de pago, días de entrega…" />
    </>
  );
}

export function NuevoProveedor() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearProveedor, {});
  return (
    <form action={accion} key={estado.exito} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-morado">Nuevo proveedor</h2>
      <p className="text-sm text-suave">Solo el nombre es obligatorio. No guardes números de cuenta bancaria.</p>
      <Campos prefijo="nuevo" />
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <div><Boton type="submit" cargando={enviando}>Registrar proveedor</Boton></div>
    </form>
  );
}

export function EditarProveedor({ proveedor }: { proveedor: Proveedor }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(editarProveedor, {});
  return (
    <form action={accion} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="id" value={proveedor.id} />
      <Campos p={proveedor} prefijo={`p-${proveedor.id}`} />
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" name="activo" defaultChecked={proveedor.activo} className="size-5 accent-morado" /> Proveedor activo
      </label>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <div><Boton type="submit" variante="secundario" cargando={enviando}>Guardar cambios</Boton></div>
    </form>
  );
}
