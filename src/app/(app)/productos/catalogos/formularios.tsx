"use client";

import { useActionState } from "react";
import { agregarMaterial, crearElemento, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/aviso";

const entrada = "min-h-11 rounded-xl border border-borde bg-white px-3";

export function AgregarElemento({ tabla }: { tabla: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearElemento, {});
  return (
    <form action={accion} className="flex flex-col gap-2">
      <input type="hidden" name="tabla" value={tabla} />
      <div className="flex flex-wrap gap-2">
        {tabla === "disenos" && <input name="codigo" placeholder="Código" aria-label="Código" maxLength={12} className={`${entrada} w-24`} required />}
        <input name="nombre" placeholder="Nombre" aria-label="Nombre" className={`${entrada} min-w-0 flex-1`} required />
        {tabla === "tallas" && <input name="orden" type="number" placeholder="Orden" aria-label="Orden" className={`${entrada} w-20`} />}
        {tabla === "colores" && <input name="hex" type="color" aria-label="Color" defaultValue="#ffffff" className="h-11 w-12 rounded-xl border border-borde" />}
        <Boton type="submit" variante="secundario" cargando={enviando}>Agregar</Boton>
      </div>
      {estado.error && <Aviso>{estado.error}</Aviso>}
    </form>
  );
}

export function AgregarMaterial({ disenoId, materiales, tallas }: {
  disenoId: string; materiales: { id: string; etiqueta: string }[]; tallas: { id: string; nombre: string }[];
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(agregarMaterial, {});
  return (
    <form action={accion} className="flex flex-col gap-2">
      <input type="hidden" name="diseno_id" value={disenoId} />
      <div className="flex flex-wrap gap-2">
        <select name="material_id" aria-label="Material" defaultValue="" className={`${entrada} min-w-0 flex-1`} required>
          <option value="">Material…</option>
          {materiales.map((m) => <option key={m.id} value={m.id}>{m.etiqueta}</option>)}
        </select>
        <select name="talla_id" aria-label="Talla" defaultValue="" className={`${entrada} w-28`}>
          <option value="">Todas</option>
          {tallas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
        <input name="cantidad" type="number" step="any" min={0} placeholder="Cantidad" aria-label="Cantidad por camiseta"
               className={`${entrada} w-28`} required />
        <Boton type="submit" variante="secundario" cargando={enviando}>Agregar</Boton>
      </div>
      {estado.error && <Aviso>{estado.error}</Aviso>}
    </form>
  );
}
