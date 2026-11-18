"use client";

import { useActionState } from "react";
import { anularOrden, crearOrden, registrarEstampado, type Estado } from "./acciones";
import { LineasVariantes, type OpcionVariante } from "@/components/formularios/lineas-variantes";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

export function NuevaOrden({ puntos, variantes, veCostos }: { puntos: { id: string; nombre: string }[]; variantes: OpcionVariante[]; veCostos: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearOrden, {});
  return (
    <form id="nueva-orden" action={accion} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-morado">Nueva orden por lote</h2>
      <p className="text-sm text-suave">Elige diseños, tallas y cantidades. El sistema calcula las camisetas base y los materiales y avisa qué falta.</p>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      <Selector etiqueta="Punto donde se estampa" name="bodega_id" defaultValue={puntos[0]?.id}>
        {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Selector>
      <LineasVariantes opciones={variantes} etiquetaCantidad="Unidades" />
      <Campo etiqueta="Observaciones" name="observaciones" />
      {veCostos && (
        <Campo etiqueta="Costos adicionales de la orden ($)" name="costos_adicionales" type="number" inputMode="numeric" min={0}
               ayuda="Solo si pagas el estampado a un tercero. Tu trabajo propio es gasto operativo, no va aquí." />
      )}
      <div><Boton type="submit" cargando={enviando}>Crear orden</Boton></div>
    </form>
  );
}

type Linea = {
  id: string; sku: string; producto: string; planeada: number;
  consumos: { variante_id: string; sku: string; producto: string; unidad: string; teorica: number; disponible: number }[];
};

export function RegistrarEstampado({ ordenId, lineas, veCostos }: { ordenId: string; lineas: Linea[]; veCostos: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(registrarEstampado, {});
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return (
    <form id="registrar-estampado" action={accion} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-morado">Registrar resultado</h2>
      <p className="text-sm text-suave">Anota las buenas y las dañadas. Corrige el consumo solo si no coincidió con la receta.</p>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      <input type="hidden" name="orden_id" value={ordenId} />
      {lineas.map((l) => (
        <fieldset key={l.id} className="flex flex-col gap-3 rounded-xl border border-borde p-3">
          <legend className="px-1 font-semibold">{l.producto} · {l.sku} <span className="font-normal text-suave">({l.planeada} planeadas)</span></legend>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Buenas" name={`buenas__${l.id}`} id={`b-${l.id}`} type="number" inputMode="numeric" min={0} step={1} defaultValue={l.planeada} required />
            <Campo etiqueta="Dañadas" name={`danadas__${l.id}`} id={`d-${l.id}`} type="number" inputMode="numeric" min={0} step={1} defaultValue={0} required />
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-morado">Consumo real (opcional)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {l.consumos.map((c) => (
                <Campo key={c.variante_id} etiqueta={`${c.producto} (receta: ${c.teorica} ${c.unidad})`}
                       name={`consumo__${l.id}__${c.variante_id}`} id={`c-${l.id}-${c.variante_id}`}
                       type="number" inputMode="decimal" min={0} step="any" placeholder="Igual a la receta" />
              ))}
            </div>
          </details>
        </fieldset>
      ))}
      {veCostos && <Campo etiqueta="Costos adicionales ($)" name="costos_adicionales" type="number" inputMode="numeric" min={0} />}
      <div><Boton type="submit" cargando={enviando}>Registrar estampado</Boton></div>
    </form>
  );
}

export function AnularOrden({ ordenId }: { ordenId: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(anularOrden, {});
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return (
    <form action={accion} className="flex flex-col gap-2">
      <input type="hidden" name="orden_id" value={ordenId} />
      {estado.error && <Aviso>{estado.error}</Aviso>}
      <Campo etiqueta="Motivo de la anulación" name="motivo" id="motivo-anulacion" required />
      <div><Boton type="submit" variante="peligro" cargando={enviando}>Anular orden</Boton></div>
    </form>
  );
}
