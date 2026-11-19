"use client";

import { useActionState } from "react";
import { anularCompra, confirmarCompra, devolverAProveedor, pagarCompra, recibirCompra, type Estado } from "./acciones";
import { nuevaClave } from "@/lib/ventas";
import { pesos } from "@/lib/utilidades";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";

// Clave única por envío: si la solicitud se repite, la operación no se registra dos veces
function ponerClave(e: React.FormEvent<HTMLFormElement>) {
  const campo = e.currentTarget.elements.namedItem("clave");
  if (campo instanceof HTMLInputElement) campo.value = nuevaClave();
}

function Resultado({ estado }: { estado: Estado }) {
  if (estado.error) return <Aviso>{estado.error}</Aviso>;
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return null;
}

export function ConfirmarBorrador({ compraId }: { compraId: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(confirmarCompra, {});
  return (
    <form action={accion} onSubmit={ponerClave} className="flex flex-col gap-3">
      <input type="hidden" name="compra_id" value={compraId} />
      <input type="hidden" name="clave" defaultValue="" />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="recibir" className="mt-0.5 size-5 accent-morado" />
        <span>La mercancía ya llegó completa: recibirla de una vez</span>
      </label>
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Confirmar compra</Boton></div>
    </form>
  );
}

export type LineaRecepcion = { id: string; texto: string; pendiente: number; unidad: string };

export function RecibirCompra({ compraId, lineas, volver }: { compraId: string; lineas: LineaRecepcion[]; volver?: "recibir" }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(recibirCompra, {});
  return (
    <form action={accion} onSubmit={ponerClave} className="flex flex-col gap-3">
      <input type="hidden" name="compra_id" value={compraId} />
      <input type="hidden" name="clave" defaultValue="" />
      {volver && <input type="hidden" name="volver" value={volver} />}
      <p className="text-sm text-suave">Cuenta lo que llegó. Si falta algo, recibe lo que hay y el resto queda pendiente.</p>
      {lineas.map((l) => (
        <label key={l.id} className="flex flex-col gap-1 text-sm font-semibold">
          {l.texto} <span className="font-normal text-suave">(pendientes: {l.pendiente})</span>
          <input name={`recibir__${l.id}`} type="number" inputMode="decimal" min={0} max={l.pendiente} step={l.unidad === "unidad" ? 1 : "any"}
                 defaultValue={l.pendiente} aria-label={`Recibidas de ${l.texto}`}
                 className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 text-base font-normal" />
        </label>
      ))}
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Registrar recepción</Boton></div>
    </form>
  );
}

export function PagarCompra({ compraId, cuentas, valor, tipo = "pago" }: {
  compraId: string; cuentas: { id: string; nombre: string; saldo?: number }[]; valor: number; tipo?: "pago" | "reembolso";
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(pagarCompra, {});
  return (
    <form action={accion} onSubmit={ponerClave} className="flex flex-col gap-3">
      <input type="hidden" name="compra_id" value={compraId} />
      <input type="hidden" name="clave" defaultValue="" />
      <input type="hidden" name="tipo" value={tipo} />
      <Selector etiqueta={tipo === "pago" ? "Sale de" : "Entra a"} name="cuenta_id" id={`cuenta-${tipo}`} defaultValue={cuentas[0]?.id}>
        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.saldo !== undefined ? ` (${pesos(c.saldo)})` : ""}</option>)}
      </Selector>
      <Campo etiqueta="Valor" name="valor" id={`valor-${tipo}`} type="number" inputMode="numeric" min={1} max={valor} step="any" defaultValue={valor} className="cifra" />
      <Campo etiqueta="Referencia (opcional)" name="referencia" id={`referencia-${tipo}`} maxLength={120} placeholder="Número de transferencia o recibo" />
      <Resultado estado={estado} />
      <div><Boton type="submit" variante={tipo === "pago" ? "principal" : "secundario"} cargando={enviando}>{tipo === "pago" ? "Registrar pago" : "Registrar reembolso"}</Boton></div>
    </form>
  );
}

export function AnularCompra({ compraId }: { compraId: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(anularCompra, {});
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="compra_id" value={compraId} />
      <p className="text-sm text-suave">Solo se anula si no ha llegado mercancía ni tiene pagos. No se borra.</p>
      <Campo etiqueta="Motivo de la anulación" name="motivo" id="motivo-anulacion" required maxLength={300} />
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="peligro" cargando={enviando}>Anular compra</Boton></div>
    </form>
  );
}

export type LineaDevolucionCompra = { id: string; texto: string; maximo: number; costo: number };

export function DevolverAProveedor({ compraId, lineas }: { compraId: string; lineas: LineaDevolucionCompra[] }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(devolverAProveedor, {});
  return (
    <form action={accion} onSubmit={ponerClave} className="flex flex-col gap-3">
      <input type="hidden" name="compra_id" value={compraId} />
      <input type="hidden" name="clave" defaultValue="" />
      <p className="text-sm text-suave">Sale del inventario a su costo y reduce lo que se le debe al proveedor.</p>
      {lineas.map((l) => (
        <label key={l.id} className="flex flex-col gap-1 text-sm font-semibold">
          {l.texto} <span className="font-normal text-suave">(máx. {l.maximo} · costo {pesos(l.costo)} c/u)</span>
          <input name={`devolver__${l.id}`} type="number" inputMode="decimal" min={0} max={l.maximo} step="any" placeholder="0"
                 aria-label={`Devolver de ${l.texto}`} className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 text-base font-normal" />
        </label>
      ))}
      <Campo etiqueta="Motivo" name="motivo" id="motivo-devolucion" required maxLength={300} placeholder="Ej.: llegaron con defecto" />
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="secundario" cargando={enviando}>Registrar devolución</Boton></div>
    </form>
  );
}
