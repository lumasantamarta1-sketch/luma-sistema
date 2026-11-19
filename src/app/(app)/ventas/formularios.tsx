"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import {
  anularVenta, apartarVenta, autorizarDescuentoPuntual, cambiarDescuento, confirmarCotizacion, crearPromocion, entregarVenta,
  ordenarEstampado, registrarDevolucion, registrarPago, registrarReembolso, type Estado,
} from "./acciones";
import { nuevaClave } from "@/lib/ventas";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { cn, pesos } from "@/lib/utilidades";

export type Metodo = { id: string; nombre: string; tipo: string };
type Accion = (estado: Estado, datos: FormData) => Promise<Estado>;

// Cada operación de dinero lleva una clave única: si el envío se repite, no se registra dos veces
function ponerClaves(e: React.FormEvent<HTMLFormElement>, ...nombres: string[]) {
  for (const n of nombres) {
    const campo = e.currentTarget.elements.namedItem(n);
    if (campo instanceof HTMLInputElement) campo.value = nuevaClave();
  }
}

function Resultado({ estado }: { estado: Estado }) {
  if (estado.error) return <Aviso>{estado.error}</Aviso>;
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return null;
}

// Campos sin estado propio: React los limpia solos después de cada envío
function CamposPago({ metodos, valor, maximo }: { metodos: Metodo[]; valor?: number; maximo?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <Selector etiqueta="Método" name="metodo_pago_id" defaultValue={metodos.find((m) => m.tipo === "efectivo")?.id ?? metodos[0]?.id}>
        {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
      </Selector>
      <Campo etiqueta="Valor" name="valor" type="number" inputMode="numeric" min={0} max={maximo}
             defaultValue={valor ? String(valor) : ""} className="cifra" />
      <Campo etiqueta="Referencia (opcional)" name="referencia" maxLength={120} ayuda="Para Nequi o transferencia: el número del comprobante." />
    </div>
  );
}

export function ConfirmarCotizacion({ ventaId, total, metodos, cobra, anticipoMinimo }: {
  ventaId: string; total: number; metodos: Metodo[]; cobra: boolean; anticipoMinimo: number;
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(confirmarCotizacion, {});
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return (
    <form action={accion} onSubmit={(e) => ponerClaves(e, "clave", "clave_pago")} className="flex flex-col gap-3">
      <input type="hidden" name="venta_id" value={ventaId} />
      <input type="hidden" name="clave" defaultValue="" />
      <input type="hidden" name="clave_pago" defaultValue="" />
      <p className="text-sm text-suave">Al confirmar se apartan las unidades del punto y la cotización recibe su número de venta.</p>
      {cobra && (
        <details className="rounded-xl border border-borde p-3">
          <summary className="cursor-pointer font-semibold text-morado">Registrar un pago al confirmar</summary>
          <div className="mt-3"><CamposPago metodos={metodos} valor={total} maximo={total} /></div>
        </details>
      )}
      {anticipoMinimo > 0 && <p className="text-sm text-suave">Si quedan productos por estampar o por llegar, se exige un anticipo de {pesos(anticipoMinimo)}.</p>}
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Confirmar venta</Boton></div>
    </form>
  );
}

export function RegistrarPago({ ventaId, saldo, metodos }: { ventaId: string; saldo: number; metodos: Metodo[] }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(registrarPago, {});
  return (
    <form action={accion} onSubmit={(e) => ponerClaves(e, "clave")} className="flex flex-col gap-3">
      <input type="hidden" name="venta_id" value={ventaId} />
      <input type="hidden" name="clave" defaultValue="" />
      <CamposPago metodos={metodos} valor={saldo} maximo={saldo} />
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Registrar pago</Boton></div>
    </form>
  );
}

export function Reembolso({ ventaId, maximo, metodos, texto }: { ventaId: string; maximo: number; metodos: Metodo[]; texto: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(registrarReembolso, {});
  return (
    <form action={accion} onSubmit={(e) => ponerClaves(e, "clave")} className="flex flex-col gap-3">
      <input type="hidden" name="venta_id" value={ventaId} />
      <input type="hidden" name="clave" defaultValue="" />
      <p className="text-sm text-suave">{texto}</p>
      <CamposPago metodos={metodos} valor={maximo} maximo={maximo} />
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="secundario" cargando={enviando}>Registrar devolución de dinero</Boton></div>
    </form>
  );
}

function BotonSimple({ accion: fn, ventaId, texto, variante = "principal", ayuda, volver }: {
  accion: Accion; ventaId: string; texto: string; variante?: "principal" | "secundario"; ayuda?: string; volver?: string;
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(fn, {});
  return (
    <form action={accion} className="flex flex-col gap-2">
      <input type="hidden" name="venta_id" value={ventaId} />
      {volver && <input type="hidden" name="volver" value={volver} />}
      {ayuda && <p className="text-sm text-suave">{ayuda}</p>}
      <Resultado estado={estado} />
      <div><Boton type="submit" variante={variante} cargando={enviando}>{texto}</Boton></div>
    </form>
  );
}

export function ApartarVenta({ ventaId, volver }: { ventaId: string; volver?: string }) {
  return <BotonSimple accion={apartarVenta} ventaId={ventaId} volver={volver} variante="secundario" texto="Apartar lo que ya llegó"
                      ayuda="Reserva para esta venta las unidades que ya hay en el punto." />;
}

export function OrdenarEstampado({ ventaId }: { ventaId: string }) {
  return <BotonSimple accion={ordenarEstampado} ventaId={ventaId} variante="secundario" texto="Crear orden de estampado"
                      ayuda="Hay productos personalizados sin una orden de estampado activa." />;
}

export function EntregarVenta({ ventaId, saldo, credito, volver }: { ventaId: string; saldo: number; credito: boolean; volver?: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(entregarVenta, {});
  const [aceptaCredito, setAceptaCredito] = useState(false);
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  if (saldo > 0 && !credito) {
    return (
      <p className="rounded-xl bg-naranja/10 p-3 text-sm text-morado">
        Falta un saldo de <b className="cifra">{pesos(saldo)}</b>. Registra el pago para entregar, o pide al administrador que autorice el crédito.
      </p>
    );
  }
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="venta_id" value={ventaId} />
      {volver && <input type="hidden" name="volver" value={volver} />}
      <p className="text-sm text-suave">Los productos salen del inventario del punto con su costo del momento.</p>
      {saldo > 0 && (
        <label className="flex items-start gap-3 rounded-xl bg-naranja/10 p-3 text-sm">
          <input type="checkbox" checked={aceptaCredito} onChange={(e) => setAceptaCredito(e.target.checked)} className="mt-0.5 size-5 accent-morado" />
          <span>Entregar a crédito: el cliente queda debiendo <b className="cifra">{pesos(saldo)}</b>.</span>
        </label>
      )}
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando} disabled={saldo > 0 && !aceptaCredito}>Entregar al cliente</Boton></div>
    </form>
  );
}

export function AnularVenta({ ventaId, ayuda }: { ventaId: string; ayuda: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(anularVenta, {});
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="venta_id" value={ventaId} />
      <p className="text-sm text-suave">{ayuda}</p>
      <Campo etiqueta="Motivo de la anulación" name="motivo" id="motivo-anulacion" required maxLength={300} />
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="peligro" cargando={enviando}>Anular</Boton></div>
    </form>
  );
}

export type LineaDevolucion = { id: string; texto: string; maximo: number; valorUnidad: number };

// Devolución de un cliente. Se envía a mano para no perder lo escrito si hay un error.
export function Devolucion({ ventaId, lineas, saldo, metodos, puedeReembolsar }: {
  ventaId: string; lineas: LineaDevolucion[]; saldo: number; metodos: Metodo[]; puedeReembolsar: boolean;
}) {
  const [estado, despachar, enviando] = useActionState<Estado, FormData>(registrarDevolucion, {});
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [condiciones, setCondiciones] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [conReembolso, setConReembolso] = useState(true);
  const [metodo, setMetodo] = useState(metodos.find((m) => m.tipo === "efectivo")?.id ?? metodos[0]?.id ?? "");
  const [valor, setValor] = useState<string | null>(null);
  const [referencia, setReferencia] = useState("");

  const valorDevuelto = useMemo(() => Math.round(lineas.reduce((s, l) =>
    s + Math.min(Number(cantidades[l.id]) || 0, l.maximo) * l.valorUnidad, 0) * 100) / 100, [lineas, cantidades]);
  // Primero se descuenta lo que el cliente aún debe; el resto se le puede devolver
  const maximoReembolso = Math.max(0, Math.round((valorDevuelto - saldo) * 100) / 100);
  const valorReembolso = valor ?? String(maximoReembolso);

  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("venta_id", ventaId);
    fd.set("clave", nuevaClave());
    fd.set("motivo", motivo);
    for (const l of lineas) {
      if (Number(cantidades[l.id]) > 0) {
        fd.set(`devolver__${l.id}`, cantidades[l.id]);
        fd.set(`condicion__${l.id}`, condiciones[l.id] ?? "buena");
      }
    }
    if (puedeReembolsar && conReembolso && Number(valorReembolso) > 0) {
      fd.set("reembolso_valor", valorReembolso);
      fd.set("reembolso_metodo", metodo);
      fd.set("reembolso_referencia", referencia);
      fd.set("reembolso_clave", nuevaClave());
    }
    startTransition(() => despachar(fd));
  }

  const tipo = metodos.find((m) => m.id === metodo)?.tipo;
  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <p className="text-sm text-suave">Lo que vuelve en buen estado entra de nuevo al inventario; lo dañado se registra como pérdida.</p>
      {lineas.map((l) => (
        <fieldset key={l.id} className="flex flex-col gap-2 rounded-xl border border-borde p-3">
          <legend className="px-1 text-sm font-semibold">{l.texto}</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Devuelve (máx. {l.maximo})
              <input type="number" inputMode="numeric" min={0} max={l.maximo} step={1} value={cantidades[l.id] ?? ""}
                     onChange={(e) => setCantidades({ ...cantidades, [l.id]: e.target.value })}
                     className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Estado
              <select value={condiciones[l.id] ?? "buena"} onChange={(e) => setCondiciones({ ...condiciones, [l.id]: e.target.value })}
                      className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
                <option value="buena">Buen estado</option>
                <option value="danada">Dañada</option>
              </select>
            </label>
          </div>
        </fieldset>
      ))}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Motivo
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} required
               className="min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" placeholder="Ej.: talla equivocada" />
      </label>
      {valorDevuelto > 0 && <p className="text-sm">Valor de lo devuelto: <b className="cifra">{pesos(valorDevuelto)}</b></p>}
      {puedeReembolsar && maximoReembolso > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-morado-50 p-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={conReembolso} onChange={(e) => setConReembolso(e.target.checked)} className="mt-0.5 size-5 accent-morado" />
            <span><b>Devolver el dinero ahora</b> (máximo <span className="cifra">{pesos(maximoReembolso)}</span>). Si no, queda a favor del cliente.</span>
          </label>
          {conReembolso && (
            <>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Método
                <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className="min-h-11 rounded-xl border border-borde bg-white px-2 font-normal">
                  {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Valor a devolver
                <input type="number" inputMode="numeric" min={0} max={maximoReembolso} value={valorReembolso} onChange={(e) => setValor(e.target.value)}
                       className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 font-normal" />
              </label>
              {tipo !== "efectivo" && (
                <input aria-label="Referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={120}
                       placeholder="Referencia (opcional)" className="min-h-11 rounded-xl border border-borde bg-white px-3" />
              )}
            </>
          )}
        </div>
      )}
      {saldo > 0 && valorDevuelto > 0 && (
        <p className="text-sm text-suave">El cliente debía {pesos(saldo)}: lo devuelto primero reduce esa deuda.</p>
      )}
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="secundario" cargando={enviando} disabled={!valorDevuelto || !motivo.trim()}>Registrar devolución</Boton></div>
    </form>
  );
}

export function AutorizarDescuento({ ventaId }: { ventaId: string }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(autorizarDescuentoPuntual, {});
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="venta_id" value={ventaId} />
      <p className="text-sm text-suave">Solo para esta cotización. Quien vende lo elige al editarla; el sistema no deja pasar de lo autorizado.</p>
      <Campo etiqueta="Nombre" name="nombre" id="desc-nombre" placeholder="Ej.: Cliente frecuente" maxLength={120} />
      <div className="grid grid-cols-2 gap-3">
        <Selector etiqueta="Forma" name="forma" id="desc-forma" defaultValue="porcentaje">
          <option value="porcentaje">Porcentaje</option>
          <option value="unidad">Pesos por unidad</option>
          <option value="total">Pesos en total</option>
        </Selector>
        <Campo etiqueta="Valor" name="valor" id="desc-valor" type="number" inputMode="numeric" min={0} step="any" required className="cifra" />
      </div>
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="secundario" cargando={enviando}>Autorizar descuento</Boton></div>
    </form>
  );
}

export function NuevaPromocion({ productos }: { productos: { id: string; nombre: string }[] }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearPromocion, {});
  return (
    <form action={accion} key={estado.exito} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-morado">Nueva promoción</h2>
      <p className="text-sm text-suave">Las vendedoras la pueden aplicar mientras esté vigente y activa. No se aplica sola.</p>
      <Campo etiqueta="Nombre" name="nombre" id="promo-nombre" required maxLength={120} placeholder="Ej.: Navidad 10 %" />
      <div className="grid grid-cols-2 gap-3">
        <Selector etiqueta="Forma" name="forma" id="promo-forma" defaultValue="porcentaje">
          <option value="porcentaje">Porcentaje</option>
          <option value="unidad">Pesos por unidad</option>
        </Selector>
        <Campo etiqueta="Valor" name="valor" id="promo-valor" type="number" inputMode="numeric" min={0} step="any" required className="cifra" />
      </div>
      <Selector etiqueta="Aplica a" name="producto_id" id="promo-producto" defaultValue="">
        <option value="">Todos los productos</option>
        {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Selector>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Desde (opcional)" name="vigente_desde" id="promo-desde" type="date" />
        <Campo etiqueta="Hasta (opcional)" name="vigente_hasta" id="promo-hasta" type="date" />
      </div>
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Crear promoción</Boton></div>
    </form>
  );
}

export function CambiarDescuento({ id, activo }: { id: string; activo: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(cambiarDescuento, {});
  return (
    <form action={accion} className={cn("flex flex-col items-end gap-1")}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={activo ? "false" : "true"} />
      <Boton type="submit" variante={activo ? "fantasma" : "secundario"} cargando={enviando}>{activo ? "Desactivar" : "Activar"}</Boton>
      {estado.error && <p className="text-sm text-error">{estado.error}</p>}
    </form>
  );
}
