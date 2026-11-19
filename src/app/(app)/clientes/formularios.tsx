"use client";

import { useActionState } from "react";
import { crearCliente, editarCliente, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

type Cliente = {
  id: string; nombre: string; documento: string | null; telefono: string | null; whatsapp: string | null;
  correo: string | null; ciudad: string | null; direccion: string | null; activo: boolean;
};

function CamposCliente({ c, prefijo }: { c?: Cliente; prefijo: string }) {
  return (
    <>
      <Campo etiqueta="Nombre" name="nombre" id={`${prefijo}-nombre`} defaultValue={c?.nombre} required autoComplete="off" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Teléfono" name="telefono" id={`${prefijo}-telefono`} defaultValue={c?.telefono ?? ""} inputMode="tel" />
        <Campo etiqueta="WhatsApp" name="whatsapp" id={`${prefijo}-whatsapp`} defaultValue={c?.whatsapp ?? ""} inputMode="tel" />
        <Campo etiqueta="Documento (opcional)" name="documento" id={`${prefijo}-documento`} defaultValue={c?.documento ?? ""} />
        <Campo etiqueta="Correo (opcional)" name="correo" id={`${prefijo}-correo`} type="email" defaultValue={c?.correo ?? ""} />
        <Campo etiqueta="Ciudad (opcional)" name="ciudad" id={`${prefijo}-ciudad`} defaultValue={c?.ciudad ?? ""} />
        <Campo etiqueta="Dirección (opcional)" name="direccion" id={`${prefijo}-direccion`} defaultValue={c?.direccion ?? ""} />
      </div>
    </>
  );
}

export function NuevoCliente() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearCliente, {});
  return (
    <form id="nuevo-cliente" action={accion} className="flex flex-col gap-3" key={estado.exito}>
      <h2 className="text-lg font-semibold text-morado">Nuevo cliente</h2>
      <p className="text-sm text-suave">Solo el nombre es obligatorio. Pide únicamente los datos que necesitas para la venta o la entrega.</p>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <CamposCliente prefijo="nuevo" />
      <div><Boton type="submit" cargando={enviando}>Registrar cliente</Boton></div>
    </form>
  );
}

export function EditarCliente({ cliente }: { cliente: Cliente }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(editarCliente, {});
  return (
    <form action={accion} className="flex flex-col gap-3 pt-3">
      <input type="hidden" name="id" value={cliente.id} />
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <CamposCliente c={cliente} prefijo={`c-${cliente.id}`} />
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="activo" defaultChecked={cliente.activo} className="size-5 accent-morado" /> Activo
      </label>
      <div><Boton type="submit" variante="secundario" cargando={enviando}>Guardar cambios</Boton></div>
    </form>
  );
}
