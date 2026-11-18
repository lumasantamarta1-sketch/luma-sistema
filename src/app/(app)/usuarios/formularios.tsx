"use client";

import { useActionState, useState } from "react";
import { actualizarUsuario, crearUsuario, restablecerClave, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

type Rol = { id: string; nombre: string };
type Bodega = { id: string; nombre: string };

// Contraseña temporal legible: sin letras que se confundan
function generarClave() {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const valores = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(valores, (v) => letras[v % letras.length]).join("");
}

function Puntos({ bodegas, marcadas = [] }: { bodegas: Bodega[]; marcadas?: string[] }) {
  if (!bodegas.length) return <p className="text-sm text-suave">Aún no hay puntos de venta. Créalos en Configuración.</p>;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">Puntos de venta</legend>
      {bodegas.map((b) => (
        <label key={b.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-borde px-3">
          <input type="checkbox" name="bodegas" value={b.id} defaultChecked={marcadas.includes(b.id)} className="size-5 accent-morado" />
          {b.nombre}
        </label>
      ))}
    </fieldset>
  );
}

export function NuevoUsuario({ roles, bodegas }: { roles: Rol[]; bodegas: Bodega[] }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearUsuario, {});
  const [clave, setClave] = useState("");
  return (
    <form id="nuevo-usuario" action={accion} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-morado">Nuevo usuario</h2>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <Campo etiqueta="Nombre" name="nombre" autoComplete="off" required />
      <Campo etiqueta="Correo" name="correo" type="email" inputMode="email" autoComplete="off" required />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Campo etiqueta="Contraseña temporal" name="clave" value={clave} onChange={(e) => setClave(e.target.value)}
                 autoComplete="new-password" ayuda="Entrégasela en persona; se le pedirá cambiarla." required />
        </div>
        <Boton type="button" variante="secundario" onClick={() => setClave(generarClave())} className="mb-7">Generar</Boton>
      </div>
      <Selector etiqueta="Rol" name="rol_id" defaultValue="">
        <option value="">Sin rol (no puede entrar)</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
      </Selector>
      <Puntos bodegas={bodegas} />
      <div><Boton type="submit" cargando={enviando}>Crear usuario</Boton></div>
    </form>
  );
}

type Usuario = { id: string; nombre: string; rol_id: string | null; activo: boolean; bodegas: string[] };

export function EditarUsuario({ usuario, roles, bodegas, esYo }: { usuario: Usuario; roles: Rol[]; bodegas: Bodega[]; esYo: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(actualizarUsuario, {});
  const [estadoClave, accionClave, enviandoClave] = useActionState<Estado, FormData>(restablecerClave, {});
  const [clave, setClave] = useState("");
  return (
    <div className="flex flex-col gap-5 border-t border-borde pt-4">
      <form action={accion} className="flex flex-col gap-4">
        {estado.error && <Aviso>{estado.error}</Aviso>}
        {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
        <input type="hidden" name="usuario_id" value={usuario.id} />
        <Campo etiqueta="Nombre" name="nombre" defaultValue={usuario.nombre} id={`nombre-${usuario.id}`} required />
        <Selector etiqueta="Rol" name="rol_id" defaultValue={usuario.rol_id ?? ""} id={`rol-${usuario.id}`}>
          <option value="">Sin rol (no puede entrar)</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </Selector>
        <Puntos bodegas={bodegas} marcadas={usuario.bodegas} />
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="activo" defaultChecked={usuario.activo} disabled={esYo} className="size-5 accent-morado" />
          Usuario activo
          {esYo && <input type="hidden" name="activo" value="on" />}
        </label>
        <div><Boton type="submit" cargando={enviando}>Guardar cambios</Boton></div>
      </form>
      {!esYo && (
        <form action={accionClave} className="flex flex-col gap-3 rounded-xl bg-morado-50 p-3">
          <p className="text-sm font-semibold">Restablecer contraseña</p>
          {estadoClave.error && <Aviso>{estadoClave.error}</Aviso>}
          {estadoClave.exito && <Aviso tipo="exito">{estadoClave.exito}</Aviso>}
          <input type="hidden" name="usuario_id" value={usuario.id} />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Campo etiqueta="Contraseña temporal" name="clave" id={`clave-${usuario.id}`} value={clave}
                     onChange={(e) => setClave(e.target.value)} autoComplete="new-password" required />
            </div>
            <Boton type="button" variante="secundario" onClick={() => setClave(generarClave())}>Generar</Boton>
          </div>
          <div><Boton type="submit" variante="secundario" cargando={enviandoClave}>Asignar contraseña temporal</Boton></div>
        </form>
      )}
    </div>
  );
}
