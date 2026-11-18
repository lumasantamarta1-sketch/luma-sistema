"use client";

import { useActionState, useState } from "react";
import { accionTraslado, guardarTraslado, resolverAjuste, solicitarAjuste, type Estado } from "./acciones";
import { LineasVariantes, type OpcionVariante } from "@/components/formularios/lineas-variantes";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

type Punto = { id: string; nombre: string };

export function NuevoAjuste({ puntos, variantes, veCostos }: { puntos: Punto[]; variantes: OpcionVariante[]; veCostos: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(solicitarAjuste, {});
  const [tipo, setTipo] = useState(veCostos ? "saldo_inicial" : "ajuste");
  return (
    <form id="nuevo-ajuste" action={accion} className="flex flex-col gap-4" key={estado.exito}>
      <h2 className="text-lg font-semibold text-morado">Nuevo ajuste</h2>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Selector etiqueta="Tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {veCostos && <option value="saldo_inicial">Saldo inicial (lo que ya tienes, con su costo)</option>}
          <option value="ajuste">Ajuste por conteo (+ sobrante / − faltante)</option>
          <option value="perdida">Pérdida o daño</option>
        </Selector>
        <Selector etiqueta="Punto" name="bodega_id" defaultValue={puntos[0]?.id}>
          {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
      </div>
      <Campo etiqueta="Motivo" name="motivo" required
             placeholder={tipo === "saldo_inicial" ? "Inventario inicial al empezar a usar el sistema" : "¿Qué pasó?"} />
      {tipo === "ajuste" && <p className="text-sm text-suave">Escribe la cantidad con signo: 2 si sobran dos, −2 si faltan dos.</p>}
      <LineasVariantes key={tipo} opciones={variantes} conCosto={tipo === "saldo_inicial"} permitirNegativos={tipo === "ajuste"} />
      <div><Boton type="submit" cargando={enviando}>Registrar ajuste</Boton></div>
    </form>
  );
}

export function ResolverAjuste({ id }: { id: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(resolverAjuste, {});
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return (
    <form action={accion} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      {estado.error && <Aviso>{estado.error}</Aviso>}
      <input name="observacion" placeholder="Observación (obligatoria si rechazas)" aria-label="Observación"
             className="min-h-11 rounded-xl border border-borde bg-white px-3" />
      <div className="flex gap-2">
        <Boton type="submit" name="decision" value="aprobar" cargando={enviando}>Aprobar</Boton>
        <Boton type="submit" name="decision" value="rechazar" variante="peligro" disabled={enviando}>Rechazar</Boton>
      </div>
    </form>
  );
}

export function NuevoTraslado({ puntos, destinos, variantes }: { puntos: Punto[]; destinos: Punto[]; variantes: OpcionVariante[] }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(guardarTraslado, {});
  return (
    <form id="nuevo-traslado" action={accion} className="flex flex-col gap-4" key={estado.exito}>
      <h2 className="text-lg font-semibold text-morado">Nuevo traslado</h2>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Selector etiqueta="Sale de" name="origen_id" defaultValue={puntos[0]?.id}>
          {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
        <Selector etiqueta="Llega a" name="destino_id" defaultValue={destinos[1]?.id ?? destinos[0]?.id}>
          {destinos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
      </div>
      <Campo etiqueta="Observaciones" name="observaciones" />
      <LineasVariantes opciones={variantes} />
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="enviar" defaultChecked className="size-5 accent-morado" />
        Enviar de una vez (las unidades salen del origen)</label>
      <div><Boton type="submit" cargando={enviando}>Guardar traslado</Boton></div>
    </form>
  );
}

export function AccionTraslado({ id, accion, texto, variante = "secundario" }: {
  id: string; accion: "enviar" | "recibir" | "anular"; texto: string; variante?: "principal" | "secundario" | "peligro";
}) {
  const [estado, ejecutar, enviando] = useActionState<Estado, FormData>(accionTraslado, {});
  return (
    <form action={ejecutar} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="accion" value={accion} />
      {accion === "anular" && <input name="motivo" required placeholder="Motivo" aria-label="Motivo de la anulación"
                                      className="min-h-11 rounded-xl border border-borde bg-white px-3" />}
      <Boton type="submit" variante={variante} cargando={enviando}>{texto}</Boton>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
    </form>
  );
}
