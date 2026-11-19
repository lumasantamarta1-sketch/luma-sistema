"use client";

import { startTransition, useActionState, useMemo, useRef, useState, useTransition } from "react";
import { Minus, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { guardarVenta, type Estado } from "./acciones";
import { crearClienteRapido } from "../clientes/acciones";
import type { ClienteOpcion, DatosFormularioVenta, ProductoVenta } from "@/lib/ventas-datos";
import { describirDescuento, descuentoAplica, nuevaClave } from "@/lib/ventas";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { cn, pesos } from "@/lib/utilidades";

type Linea = {
  clave: number; varianteId: string; cantidad: string; precio: string;
  descuento: string; descuentoId: string; personalizacion: string; conNota: boolean;
};
type Pago = { clave: string; metodoId: string; valor: string; referencia: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const campo = "min-h-11 w-full rounded-xl border border-borde bg-white px-3 text-base outline-none focus:border-morado";

// Venta nueva o edición de una cotización. Todo se recalcula en el servidor al guardar:
// los totales de aquí son una vista previa para quien vende.
export function FormularioVenta({ datos }: { datos: DatosFormularioVenta }) {
  const { permisos, config, inicial, metodos } = datos;
  const [estado, accion, enviando] = useActionState<Estado, FormData>(guardarVenta, {});
  const ventaId = estado.ventaId ?? inicial?.ventaId ?? null;
  const porId = useMemo(() => new Map(datos.productos.map((p) => [p.id, p])), [datos.productos]);

  const [bodegaId, setBodegaId] = useState(inicial?.bodegaId ?? datos.puntos[0]?.id ?? "");
  const [clientes, setClientes] = useState<ClienteOpcion[]>(datos.clientes);
  const [clienteId, setClienteId] = useState<string | null>(inicial?.clienteId ?? null);
  const [lineas, setLineas] = useState<Linea[]>(() => (inicial?.lineas ?? []).map((l, i) => ({
    clave: i + 1, varianteId: l.varianteId, cantidad: String(l.cantidad), precio: String(l.precio),
    descuento: !l.descuentoId && l.descuento ? String(l.descuento) : "", descuentoId: l.descuentoId ?? "",
    personalizacion: l.personalizacion, conNota: Boolean(l.personalizacion),
  })));
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [observaciones, setObservaciones] = useState(inicial?.observaciones ?? "");
  const [entregarAhora, setEntregarAhora] = useState(true);
  const [efectivoRecibido, setEfectivoRecibido] = useState("");
  const claveConfirmacion = useRef("");

  const punto = datos.puntos.find((p) => p.id === bodegaId);
  const disponibleEn = (p: ProductoVenta) => p.disponible[bodegaId] ?? 0;

  // Vista previa de los totales, con las mismas reglas que aplica la base de datos
  const calculo = useMemo(() => {
    const restante = new Map<string, number>();
    const pedidas = new Map<string, number>();
    let subtotal = 0;
    let descuentos = 0;
    const filas = [];
    for (const l of lineas) {
      const producto = porId.get(l.varianteId);
      const cant = Number(l.cantidad) || 0;
      const precio = permisos.cambiaPrecio && l.precio.trim() !== "" ? Number(l.precio) || 0 : producto?.precio ?? 0;
      const bruto = r2(cant * precio);
      const opciones = producto ? datos.descuentos.filter((d) => descuentoAplica(d, producto.id, producto.productoId, ventaId)) : [];
      let desc = 0;
      const d = opciones.find((x) => x.id === l.descuentoId);
      if (d) {
        const max = d.porcentaje !== null ? r2((bruto * d.porcentaje) / 100)
          : d.valor_por_unidad !== null ? r2(cant * d.valor_por_unidad)
          : restante.get(d.id) ?? d.valor_total ?? 0;
        desc = Math.min(max, bruto);
        if (d.valor_total !== null) restante.set(d.id, r2(max - desc));
      } else if (permisos.descuentoDirecto) {
        desc = Math.min(Math.max(Number(l.descuento) || 0, 0), bruto);
      }
      subtotal += bruto;
      descuentos += desc;
      if (producto && !producto.porPedido) pedidas.set(producto.id, (pedidas.get(producto.id) ?? 0) + cant);
      filas.push({ l, producto, cant, precio, bruto, desc, opciones, descuentoElegido: d ?? null });
    }
    const faltan = new Map<string, number>();
    for (const [id, n] of pedidas) {
      const hay = porId.get(id)?.disponible[bodegaId] ?? 0;
      if (n > hay) faltan.set(id, n - hay);
    }
    const porPedido = filas.some((f) => f.producto?.porPedido);
    return {
      filas, faltan, porPedido, subtotal: r2(subtotal), descuentos: r2(descuentos), total: r2(subtotal - descuentos),
      completo: filas.length > 0 && !porPedido && faltan.size === 0,
    };
  }, [lineas, porId, permisos, datos.descuentos, ventaId, bodegaId]);

  const recibido = r2(pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0));
  const saldo = r2(calculo.total - recibido);
  const efectivo = metodos.find((m) => m.tipo === "efectivo") ?? metodos[0];
  const enEfectivo = r2(pagos.filter((p) => metodos.find((m) => m.id === p.metodoId)?.tipo === "efectivo")
    .reduce((s, p) => s + (Number(p.valor) || 0), 0));
  const cambio = r2((Number(efectivoRecibido) || 0) - enEfectivo);
  const anticipoMinimo = config.anticipoPct > 0 && !calculo.completo && calculo.filas.length
    ? r2((calculo.total * config.anticipoPct) / 100) : 0;
  const puedeEntregarYa = permisos.entrega && calculo.completo && (saldo <= 0 || permisos.credito);

  const problemas: string[] = [];
  if (!bodegaId) problemas.push("Elige el punto de venta.");
  if (!calculo.filas.length) problemas.push("Agrega al menos un producto.");
  for (const f of calculo.filas) {
    if (!f.producto) problemas.push("Un producto ya no está disponible para la venta: quítalo.");
    else if (!(f.cant > 0)) problemas.push(`Revisa la cantidad de ${f.producto.sku}.`);
    else if (f.producto.unidad === "unidad" && !Number.isInteger(f.cant)) problemas.push(`${f.producto.sku} se vende en unidades enteras.`);
    else if (f.producto.precio === null && !permisos.cambiaPrecio) problemas.push(`${f.producto.sku} no tiene precio de venta: pide al administrador que lo configure.`);
  }
  if (recibido > calculo.total) problemas.push("Los pagos suman más que el total de la venta.");
  if (!config.bajoPedido && calculo.faltan.size) problemas.push("Hay productos sin existencias suficientes en este punto.");

  const json = JSON.stringify({
    venta_id: ventaId, bodega_id: bodegaId, cliente_id: clienteId, observaciones,
    entregar: puedeEntregarYa && entregarAhora,
    lineas: calculo.filas.filter((f) => f.producto).map((f) => ({
      variante_id: f.l.varianteId, cantidad: f.cant,
      ...(permisos.cambiaPrecio ? { precio_unitario: f.precio } : {}),
      ...(f.descuentoElegido ? { descuento_autorizado_id: f.descuentoElegido.id } : {}),
      ...(!f.descuentoElegido && permisos.descuentoDirecto && f.desc > 0 ? { descuento: f.desc } : {}),
      ...(f.l.personalizacion.trim() ? { personalizacion: f.l.personalizacion.trim() } : {}),
    })),
    pagos: permisos.cobra ? pagos.filter((p) => Number(p.valor) > 0).map((p) => ({
      metodo_pago_id: p.metodoId, valor: Number(p.valor), clave: p.clave,
      ...(p.referencia.trim() ? { referencia: p.referencia.trim() } : {}),
    })) : [],
  });

  function cambiar(clave: number, cambios: Partial<Linea>) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  }
  function agregar(p: ProductoVenta) {
    setLineas((ls) => {
      const igual = ls.find((l) => l.varianteId === p.id && !l.personalizacion);
      if (igual && !p.porPedido) return ls.map((l) => (l === igual ? { ...l, cantidad: String((Number(l.cantidad) || 0) + 1) } : l));
      return [...ls, {
        clave: Math.max(0, ...ls.map((l) => l.clave)) + 1, varianteId: p.id, cantidad: "1",
        precio: p.precio === null ? "" : String(p.precio), descuento: "", descuentoId: "", personalizacion: "", conNota: p.porPedido,
      }];
    });
  }
  function pagoTotal() {
    setPagos((ps) => [{ clave: ps[0]?.clave ?? nuevaClave(), metodoId: ps[0]?.metodoId ?? efectivo?.id ?? "", valor: String(calculo.total), referencia: ps[0]?.referencia ?? "" }]);
  }
  function otroPago() {
    setPagos((ps) => [...ps, { clave: nuevaClave(), metodoId: efectivo?.id ?? "", valor: saldo > 0 ? String(saldo) : "", referencia: "" }]);
  }
  // Se envía a mano (no como acción del formulario) para que React no limpie los campos si hay un error.
  // La clave de confirmación se crea una sola vez: si se reintenta, la venta no se duplica.
  function enviar(tipo: "guardar" | "confirmar") {
    const fd = new FormData();
    fd.set("datos", json);
    fd.set("accion", tipo);
    if (tipo === "confirmar") {
      if (!claveConfirmacion.current) claveConfirmacion.current = nuevaClave();
      fd.set("clave", claveConfirmacion.current);
    }
    startTransition(() => accion(fd));
  }

  if (!datos.puntos.length) {
    return <Aviso tipo="info">No tienes un punto de venta asignado. Pide al administrador que te asigne uno en Usuarios.</Aviso>;
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 xl:grid-cols-[1fr_400px]" aria-label="Venta">

      <div className="flex min-w-0 flex-col gap-4">
        <Tarjeta className="flex flex-col gap-4">
          {datos.puntos.length > 1 ? (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Punto de venta
              <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className={cn(campo, "font-normal")}>
                {datos.puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          ) : (
            <p className="text-sm text-suave">Punto de venta: <b className="text-tinta">{punto?.nombre}</b></p>
          )}
          <SelectorCliente clientes={clientes} clienteId={clienteId} onElegir={setClienteId} puedeCrear={permisos.creaClientes}
                           onCreado={(c) => { setClientes((cs) => [c, ...cs]); setClienteId(c.id); }} />
        </Tarjeta>

        <Tarjeta className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-morado">Productos</h2>
          <BuscadorProductos productos={datos.productos} disponibleEn={disponibleEn} onAgregar={agregar} />
          {calculo.filas.length === 0 && <p className="rounded-xl bg-morado-50 p-3 text-sm text-suave">Busca un producto y tócalo para agregarlo a la venta.</p>}
          <ul className="flex flex-col gap-3" aria-label="Productos de la venta">
            {calculo.filas.map((f) => {
              const { l, producto: p } = f;
              const falta = p ? calculo.faltan.get(p.id) ?? 0 : 0;
              const unidadEntera = (p?.unidad ?? "unidad") === "unidad";
              return (
                <li key={l.clave} className="flex flex-col gap-3 rounded-xl border border-borde p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{p ? `${p.producto}${p.detalle ? ` · ${p.detalle}` : ""}` : "Producto no disponible"}</p>
                      {p && (
                        <p className="text-sm text-suave">
                          {p.sku} · {p.porPedido ? "Se estampa por pedido" : `${disponibleEn(p)} disponible(s) en ${punto?.nombre ?? "el punto"}`}
                        </p>
                      )}
                    </div>
                    <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-error hover:bg-error/5" aria-label={`Quitar ${p?.sku ?? "producto"}`}>
                      <Trash2 className="size-5" aria-hidden />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold" id={`cant-${l.clave}`}>Cantidad{p && !unidadEntera ? ` (${p.unidad})` : ""}</span>
                      <div className="flex items-center">
                        <button type="button" aria-label="Quitar una" onClick={() => cambiar(l.clave, { cantidad: String(Math.max(1, (Number(l.cantidad) || 0) - 1)) })}
                                className="flex size-11 items-center justify-center rounded-l-xl border border-borde bg-white text-morado hover:bg-morado-50">
                          <Minus className="size-4" aria-hidden />
                        </button>
                        <input aria-labelledby={`cant-${l.clave}`} type="number" inputMode={unidadEntera ? "numeric" : "decimal"} min={0}
                               step={unidadEntera ? 1 : "any"} value={l.cantidad} onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })}
                               className="cifra h-11 w-16 border-y border-borde bg-white text-center text-base outline-none focus:border-morado" />
                        <button type="button" aria-label="Agregar una" onClick={() => cambiar(l.clave, { cantidad: String((Number(l.cantidad) || 0) + 1) })}
                                className="flex size-11 items-center justify-center rounded-r-xl border border-borde bg-white text-morado hover:bg-morado-50">
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                    {permisos.cambiaPrecio ? (
                      <label className="flex w-36 flex-col gap-1 text-sm font-semibold">
                        Precio unitario
                        <input type="number" inputMode="numeric" min={0} value={l.precio} placeholder={p?.precio !== null && p ? String(p.precio) : "0"}
                               onChange={(e) => cambiar(l.clave, { precio: e.target.value })} className={cn(campo, "cifra font-normal")} />
                      </label>
                    ) : (
                      <p className="pb-2.5 text-sm text-suave">× <span className="cifra">{p?.precio === null ? "Sin precio" : pesos(f.precio)}</span></p>
                    )}
                    <p className="ml-auto pb-2.5 text-right">
                      {f.desc > 0 && <span className="cifra block text-sm text-suave line-through">{pesos(f.bruto)}</span>}
                      <span className="cifra text-lg font-semibold text-morado">{pesos(f.bruto - f.desc)}</span>
                    </p>
                  </div>

                  {(f.opciones.length > 0 || permisos.descuentoDirecto) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {f.opciones.length > 0 && (
                        <label className="flex flex-col gap-1 text-sm font-semibold">
                          <span>Descuento autorizado{!l.descuentoId && <span className="ml-2 rounded-full bg-amarillo/30 px-2 py-0.5 text-xs font-bold text-morado">Disponible</span>}</span>
                          <select value={l.descuentoId} onChange={(e) => cambiar(l.clave, { descuentoId: e.target.value })} className={cn(campo, "font-normal")}>
                            <option value="">Sin descuento</option>
                            {f.opciones.map((d) => <option key={d.id} value={d.id}>{d.nombre} ({describirDescuento(d)})</option>)}
                          </select>
                        </label>
                      )}
                      {permisos.descuentoDirecto && !l.descuentoId && (
                        <label className="flex flex-col gap-1 text-sm font-semibold">
                          Descuento en pesos
                          <input type="number" inputMode="numeric" min={0} value={l.descuento} placeholder="0"
                                 onChange={(e) => cambiar(l.clave, { descuento: e.target.value })} className={cn(campo, "cifra font-normal")} />
                        </label>
                      )}
                    </div>
                  )}

                  {l.conNota ? (
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      {p?.porPedido ? "Personalización (nombre, número, frase…)" : "Nota del producto"}
                      <input value={l.personalizacion} maxLength={500} onChange={(e) => cambiar(l.clave, { personalizacion: e.target.value })}
                             className={cn(campo, "font-normal")} placeholder={p?.porPedido ? "Ej.: «MARÍA 10» en la espalda" : "Opcional"} />
                    </label>
                  ) : (
                    <button type="button" onClick={() => cambiar(l.clave, { conNota: true })} className="self-start text-sm font-semibold text-morado underline">
                      Agregar nota o personalización
                    </button>
                  )}

                  {falta > 0 && (
                    <p className="rounded-lg bg-naranja/10 px-3 py-2 text-sm font-semibold text-morado">
                      Faltan {falta} en este punto.{" "}
                      {config.bajoPedido ? "Se aparta lo que hay y el resto queda pendiente hasta que llegue." : "No se puede confirmar hasta que haya existencias."}
                    </p>
                  )}
                  {p?.porPedido && <p className="text-sm text-suave">Al confirmar se crea la orden de estampado.</p>}
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <Tarjeta className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-morado">Resumen</h2>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-suave">Subtotal</dt><dd className="cifra">{pesos(calculo.subtotal)}</dd></div>
            {calculo.descuentos > 0 && <div className="flex justify-between"><dt className="text-suave">Descuentos</dt><dd className="cifra">− {pesos(calculo.descuentos)}</dd></div>}
            <div className="flex justify-between border-t border-borde pt-2 text-lg font-semibold text-morado">
              <dt>Total</dt><dd className="cifra">{pesos(calculo.total)}</dd>
            </div>
          </dl>

          {permisos.cobra && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 font-semibold text-morado">Pagos recibidos</legend>
              {pagos.map((pg) => {
                const tipo = metodos.find((m) => m.id === pg.metodoId)?.tipo;
                return (
                  <div key={pg.clave} className="flex flex-col gap-2 rounded-xl border border-borde p-3">
                    <div className="flex gap-2">
                      <select aria-label="Método de pago" value={pg.metodoId} className={cn(campo, "font-normal")}
                              onChange={(e) => setPagos((ps) => ps.map((x) => (x.clave === pg.clave ? { ...x, metodoId: e.target.value } : x)))}>
                        {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                      </select>
                      <button type="button" aria-label="Quitar pago" onClick={() => setPagos((ps) => ps.filter((x) => x.clave !== pg.clave))}
                              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-error hover:bg-error/5">
                        <X className="size-5" aria-hidden />
                      </button>
                    </div>
                    <input aria-label="Valor del pago" type="number" inputMode="numeric" min={0} value={pg.valor} placeholder="Valor"
                           onChange={(e) => setPagos((ps) => ps.map((x) => (x.clave === pg.clave ? { ...x, valor: e.target.value } : x)))}
                           className={cn(campo, "cifra")} />
                    {tipo && tipo !== "efectivo" && (
                      <input aria-label="Referencia del pago" value={pg.referencia} maxLength={120} placeholder="Referencia o número de comprobante (opcional)"
                             onChange={(e) => setPagos((ps) => ps.map((x) => (x.clave === pg.clave ? { ...x, referencia: e.target.value } : x)))}
                             className={campo} />
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Boton type="button" variante="secundario" onClick={pagoTotal} disabled={!calculo.total}>Pagó el total</Boton>
                <Boton type="button" variante="fantasma" onClick={otroPago}><Plus className="size-4" aria-hidden /> Otro pago</Boton>
              </div>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between"><dt className="text-suave">Recibido</dt><dd className="cifra">{pesos(recibido)}</dd></div>
                <div className={cn("flex justify-between font-semibold", saldo > 0 ? "text-naranja" : "text-morado")}>
                  <dt>{saldo > 0 ? "Saldo pendiente" : saldo < 0 ? "Sobra" : "Saldo"}</dt><dd className="cifra">{pesos(Math.abs(saldo))}</dd>
                </div>
              </dl>
              {enEfectivo > 0 && (
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  ¿Con cuánto paga en efectivo? (para calcular el cambio)
                  <input type="number" inputMode="numeric" min={0} value={efectivoRecibido} onChange={(e) => setEfectivoRecibido(e.target.value)}
                         className={cn(campo, "cifra font-normal")} placeholder={String(enEfectivo)} />
                  {cambio > 0 && <span className="text-base text-morado">Cambio: <b className="cifra">{pesos(cambio)}</b></span>}
                </label>
              )}
              {anticipoMinimo > 0 && (
                <p className="text-sm text-suave">Este pedido exige un anticipo mínimo de <b className="cifra">{pesos(anticipoMinimo)}</b>.</p>
              )}
            </fieldset>
          )}

          <label className="flex flex-col gap-1 text-sm font-semibold">
            Observaciones
            <textarea value={observaciones} maxLength={500} rows={2} onChange={(e) => setObservaciones(e.target.value)}
                      className="rounded-xl border border-borde bg-white px-3 py-2 text-base font-normal outline-none focus:border-morado"
                      placeholder="Fecha de entrega, indicaciones…" />
          </label>

          {permisos.entrega && calculo.completo && (
            puedeEntregarYa ? (
              <label className="flex items-start gap-3 rounded-xl bg-morado-50 p-3 text-sm">
                <input type="checkbox" checked={entregarAhora} onChange={(e) => setEntregarAhora(e.target.checked)} className="mt-0.5 size-5 accent-morado" />
                <span><b>El cliente se lleva los productos ahora.</b> Al confirmar, la venta queda entregada.</span>
              </label>
            ) : (
              <p className="rounded-xl bg-naranja/10 p-3 text-sm text-morado">
                Con saldo pendiente la venta se confirma pero no se entrega: el administrador debe autorizar el crédito.
              </p>
            )
          )}

          {estado.error && <Aviso>{estado.error}</Aviso>}
          {problemas.length > 0 && calculo.filas.length > 0 && (
            <ul className="list-inside list-disc text-sm text-error">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex flex-col gap-2">
            <Boton type="button" onClick={() => enviar("confirmar")} cargando={enviando} disabled={problemas.length > 0}>
              {puedeEntregarYa && entregarAhora ? "Confirmar y entregar" : "Confirmar venta"}
            </Boton>
            <Boton type="button" variante="secundario" onClick={() => enviar("guardar")} disabled={enviando || !calculo.filas.length || !bodegaId}>
              {ventaId ? "Guardar cambios de la cotización" : "Guardar como cotización"}
            </Boton>
          </div>
          <p className="text-xs text-suave">Los precios, descuentos y existencias se vuelven a verificar al guardar.</p>
        </Tarjeta>
      </div>
    </form>
  );
}

function BuscadorProductos({ productos, disponibleEn, onAgregar }: {
  productos: ProductoVenta[]; disponibleEn: (p: ProductoVenta) => number; onAgregar: (p: ProductoVenta) => void;
}) {
  const [texto, setTexto] = useState("");
  const t = normalizar(texto.trim());
  const indice = useMemo(() => productos.map((p) => ({ p, clave: normalizar(`${p.producto} ${p.detalle} ${p.sku}`) })), [productos]);
  const palabras = t.split(/\s+/).filter(Boolean);
  const resultados = (palabras.length
    ? indice.filter((x) => palabras.every((w) => x.clave.includes(w))).map((x) => x.p)
    : productos.filter((p) => p.porPedido || disponibleEn(p) > 0)
  ).slice(0, 24);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-suave" aria-hidden />
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar producto"
               onKeyDown={(e) => {
                 if (e.key !== "Enter") return;
                 e.preventDefault();
                 if (palabras.length && resultados[0]) { onAgregar(resultados[0]); setTexto(""); }
               }}
               placeholder="Buscar por diseño, talla, color o SKU" className={cn(campo, "pl-10")} />
      </div>
      {!palabras.length && <p className="text-xs text-suave">Con existencias en este punto. Escribe para buscar entre los {productos.length} productos.</p>}
      {palabras.length > 0 && !resultados.length && <p className="text-sm text-suave">No hay productos que coincidan con «{texto}».</p>}
      <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
        {resultados.map((p) => {
          const hay = disponibleEn(p);
          return (
            <button key={p.id} type="button" onClick={() => onAgregar(p)}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-borde bg-white p-2.5 text-left hover:border-morado">
              <Plus className="size-5 shrink-0 text-morado" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.producto}{p.detalle ? ` · ${p.detalle}` : ""}</span>
                <span className="block truncate text-xs text-suave">
                  {p.sku} · <span className="cifra">{p.precio === null ? "Sin precio" : pesos(p.precio)}</span> ·{" "}
                  {p.porPedido ? "Por pedido" : hay > 0 ? `${hay} disponible(s)` : <span className="font-bold text-error">Agotado</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectorCliente({ clientes, clienteId, onElegir, puedeCrear, onCreado }: {
  clientes: ClienteOpcion[]; clienteId: string | null; onElegir: (id: string | null) => void;
  puedeCrear: boolean; onCreado: (c: ClienteOpcion) => void;
}) {
  const [texto, setTexto] = useState("");
  const [nuevo, setNuevo] = useState<null | { nombre: string; telefono: string; documento: string }>(null);
  const [error, setError] = useState("");
  const [creando, iniciar] = useTransition();
  const elegido = clientes.find((c) => c.id === clienteId);
  const t = normalizar(texto.trim());
  const resultados = t
    ? clientes.filter((c) => normalizar(`${c.nombre} ${c.documento ?? ""} ${c.telefono ?? ""}`).includes(t)).slice(0, 6)
    : [];

  function guardar() {
    if (!nuevo) return;
    setError("");
    iniciar(async () => {
      const r = await crearClienteRapido(nuevo);
      if (r.error || !r.cliente) { setError(r.error ?? "No se pudo crear el cliente."); return; }
      onCreado(r.cliente);
      setNuevo(null);
      setTexto("");
    });
  }
  const sinEnviar = (e: React.KeyboardEvent, alPresionar?: () => void) => {
    if (e.key === "Enter") { e.preventDefault(); alPresionar?.(); }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Cliente</span>
      <div className="flex items-center gap-2 rounded-xl bg-morado-50 px-3 py-2">
        <span className="min-w-0 flex-1 truncate">
          {elegido ? <><b>{elegido.nombre}</b>{elegido.documento ? ` · ${elegido.documento}` : ""}{elegido.telefono ? ` · ${elegido.telefono}` : ""}</>
            : <><b>Cliente mostrador</b> <span className="text-sm text-suave">(sin datos)</span></>}
        </span>
        {elegido && (
          <button type="button" onClick={() => onElegir(null)} className="flex size-9 items-center justify-center rounded-lg text-suave hover:bg-white" aria-label="Quitar cliente">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {!nuevo && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-suave" aria-hidden />
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => sinEnviar(e, () => {
            if (resultados[0]) { onElegir(resultados[0].id); setTexto(""); }
          })} aria-label="Buscar cliente" placeholder="Buscar cliente por nombre, documento o teléfono" className={cn(campo, "pl-10")} />
        </div>
      )}
      {resultados.length > 0 && (
        <ul className="flex flex-col gap-1">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onElegir(c.id); setTexto(""); }}
                      className="w-full rounded-xl border border-borde bg-white px-3 py-2 text-left hover:border-morado">
                <b>{c.nombre}</b> <span className="text-sm text-suave">{[c.documento, c.telefono].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {t && !resultados.length && !nuevo && <p className="text-sm text-suave">No hay clientes que coincidan.</p>}
      {puedeCrear && !nuevo && (
        <button type="button" onClick={() => setNuevo({ nombre: texto.trim(), telefono: "", documento: "" })}
                className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-2 font-semibold text-morado hover:bg-morado-50">
          <UserPlus className="size-5" aria-hidden /> Cliente nuevo
        </button>
      )}
      {nuevo && (
        <div className="flex flex-col gap-2 rounded-xl border border-morado-100 p-3">
          <p className="text-sm text-suave">Solo el nombre es obligatorio. Pide únicamente los datos que necesitas para la venta.</p>
          <input aria-label="Nombre del cliente" value={nuevo.nombre} placeholder="Nombre *" maxLength={160} autoFocus
                 onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} onKeyDown={(e) => sinEnviar(e, guardar)} className={campo} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Teléfono del cliente" value={nuevo.telefono} placeholder="Teléfono" inputMode="tel" maxLength={40}
                   onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} onKeyDown={(e) => sinEnviar(e, guardar)} className={campo} />
            <input aria-label="Documento del cliente" value={nuevo.documento} placeholder="Cédula o NIT" maxLength={40}
                   onChange={(e) => setNuevo({ ...nuevo, documento: e.target.value })} onKeyDown={(e) => sinEnviar(e, guardar)} className={campo} />
          </div>
          {error && <Aviso>{error}</Aviso>}
          <div className="flex gap-2">
            <Boton type="button" onClick={guardar} cargando={creando}>Guardar cliente</Boton>
            <Boton type="button" variante="fantasma" onClick={() => { setNuevo(null); setError(""); }}>Cancelar</Boton>
          </div>
        </div>
      )}
    </div>
  );
}
