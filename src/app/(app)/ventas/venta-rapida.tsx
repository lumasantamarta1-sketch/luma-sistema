"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, MessageCircle, Minus, Plus, Printer, Search, ShoppingBag, Trash2, UserRound, X } from "lucide-react";
import { registrarVentaRapida, type VentaHecha } from "./acciones";
import type { ClienteOpcion, DatosFormularioVenta, ProductoVenta } from "@/lib/ventas-datos";
import { describirDescuento, descuentoAplica, nuevaClave, type DescuentoOpcion } from "@/lib/ventas";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { cn, pesos } from "@/lib/utilidades";

// Venta rápida para quien atiende el mostrador: 1) tocar las camisetas, 2) cobrar, 3) listo.
// Los totales de aquí son una vista previa; la base de datos recalcula todo al registrar.

type Linea = { varianteId: string; cantidad: number; personalizacion: string; descuentoId: string | null };
type Paso = "elegir" | "cobrar" | "listo";
type Hecho = VentaHecha & { cambio: number; cliente: string; telefono: string; resumen: string[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digitos = (t: string) => t.replace(/\D/g, "");
const campo = "min-h-12 w-full rounded-xl border border-borde bg-white px-3 text-lg outline-none focus:border-morado";

// Billetes con los que suele pagar el cliente (para calcular el cambio con un toque)
function billetes(valor: number) {
  const opciones = new Set<number>();
  for (const b of [10000, 20000, 50000, 100000]) {
    const v = Math.ceil(valor / b) * b;
    if (v > valor) opciones.add(v);
  }
  return [...opciones].sort((a, b) => a - b).slice(0, 3);
}

function enlaceWhatsApp(telefono: string, texto: string) {
  let d = digitos(telefono);
  if (d.length === 10 && d.startsWith("3")) d = `57${d}`;
  return `https://wa.me/${d.length >= 10 ? d : ""}?text=${encodeURIComponent(texto)}`;
}

// La promoción que más descuenta en esa línea (se aplica sola; quien vende la puede quitar)
function mejorPromocion(p: ProductoVenta, promociones: DescuentoOpcion[]) {
  const precio = p.precio ?? 0;
  let mejor: DescuentoOpcion | null = null;
  let mayor = 0;
  for (const d of promociones) {
    if (!descuentoAplica(d, p.id, p.productoId, null)) continue;
    const valor = d.porcentaje !== null ? (precio * d.porcentaje) / 100 : d.valor_por_unidad ?? d.valor_total ?? 0;
    if (valor > mayor) { mayor = valor; mejor = d; }
  }
  return mejor;
}

export function VentaRapida({ datos }: { datos: DatosFormularioVenta }) {
  const { permisos, config } = datos;
  // El efectivo primero: es lo más común en el mostrador
  const metodos = useMemo(() => [...datos.metodos].sort((a, b) => Number(b.tipo === "efectivo") - Number(a.tipo === "efectivo")), [datos.metodos]);
  const porId = useMemo(() => new Map(datos.productos.map((p) => [p.id, p])), [datos.productos]);
  const promociones = useMemo(() => datos.descuentos.filter((d) => d.tipo === "promocion"), [datos.descuentos]);
  const efectivo = metodos.find((m) => m.tipo === "efectivo") ?? metodos[0];

  const [paso, setPaso] = useState<Paso>("elegir");
  const [bodegaId, setBodegaId] = useState(datos.puntos[0]?.id ?? "");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [grupo, setGrupo] = useState<string | null>(null);
  const [metodoId, setMetodoId] = useState(efectivo?.id ?? "");
  const [modo, setModo] = useState<"todo" | "parte">("todo");
  const [abono, setAbono] = useState("");
  const [recibido, setRecibido] = useState("");
  const [referencia, setReferencia] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [verCliente, setVerCliente] = useState(false);
  const [ventaId, setVentaId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const [enviando, iniciar] = useTransition();
  const claves = useRef<{ venta: string; pago: string } | null>(null);

  const enCarrito = useMemo(() => new Map(lineas.map((l) => [l.varianteId, l.cantidad])), [lineas]);
  const hay = (p: ProductoVenta) => p.disponible[bodegaId] ?? 0;

  // ¿Se puede agregar una más de esta camiseta en este punto?
  function estadoDe(p: ProductoVenta) {
    const queda = hay(p) - (enCarrito.get(p.id) ?? 0);
    if (p.precio === null) return { puede: false, texto: "Sin precio", tono: "gris" as const };
    if (p.porPedido) return { puede: true, texto: "Se hace por pedido", tono: "marca" as const };
    if (queda > 0) return { puede: true, texto: queda === 1 ? "Queda 1" : `Quedan ${queda}`, tono: queda <= 2 ? "alerta" as const : "ok" as const };
    if (config.bajoPedido) return { puede: true, texto: "Agotada: se encarga", tono: "alerta" as const };
    return { puede: false, texto: "Agotada", tono: "gris" as const };
  }

  const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
  const grupos = useMemo(() => {
    const mapa = new Map<string, { id: string; nombre: string; items: ProductoVenta[] }>();
    for (const p of datos.productos) {
      const g = mapa.get(p.productoId) ?? { id: p.productoId, nombre: p.producto, items: [] };
      g.items.push(p);
      mapa.set(p.productoId, g);
    }
    return [...mapa.values()];
  }, [datos.productos]);
  const visibles = grupos
    .filter((g) => !grupo || g.id === grupo)
    .map((g) => ({
      ...g,
      items: g.items.filter((p) => {
        if (!palabras.length) return true;
        const texto = normalizar([p.producto, p.diseno, p.tipo, p.talla, p.color, p.sku].filter(Boolean).join(" "));
        return palabras.every((w) => texto.includes(w));
      }),
    }))
    .filter((g) => g.items.length);

  // Vista previa de los totales con las mismas reglas de la base de datos
  const calculo = useMemo(() => {
    const restante = new Map<string, number>();
    const filas = [];
    let subtotal = 0;
    let descuentos = 0;
    let unidades = 0;
    let pendiente = false;
    for (const l of lineas) {
      const p = porId.get(l.varianteId);
      if (!p) continue;
      const bruto = r2(l.cantidad * (p.precio ?? 0));
      const opciones = promociones.filter((d) => descuentoAplica(d, p.id, p.productoId, null));
      const d = opciones.find((x) => x.id === l.descuentoId) ?? null;
      let desc = 0;
      if (d) {
        const max = d.porcentaje !== null ? r2((bruto * d.porcentaje) / 100)
          : d.valor_por_unidad !== null ? r2(l.cantidad * d.valor_por_unidad)
          : restante.get(d.id) ?? d.valor_total ?? 0;
        desc = Math.min(max, bruto);
        if (d.valor_total !== null) restante.set(d.id, r2(max - desc));
      }
      const falta = p.porPedido ? 0 : Math.max(0, l.cantidad - (p.disponible[bodegaId] ?? 0));
      if (p.porPedido || falta > 0) pendiente = true;
      subtotal += bruto;
      descuentos += desc;
      unidades += l.cantidad;
      filas.push({ l, p, bruto, desc, total: r2(bruto - desc), opciones, promo: d, falta });
    }
    return { filas, subtotal: r2(subtotal), descuentos: r2(descuentos), total: r2(subtotal - descuentos), unidades, pendiente };
  }, [lineas, porId, promociones, bodegaId]);

  const metodo = metodos.find((m) => m.id === metodoId);
  const valorPago = !permisos.cobra ? 0
    : modo === "todo" ? calculo.total
    : r2(Math.min(Math.max(Number(abono) || 0, 0), calculo.total));
  const saldo = r2(calculo.total - valorPago);
  const enEfectivo = metodo?.tipo === "efectivo" && valorPago > 0;
  const conReferencia = (metodo?.tipo === "nequi" || metodo?.tipo === "transferencia") && valorPago > 0;
  const recibidoNum = Number(recibido) || 0;
  const cambio = enEfectivo && recibido !== "" ? r2(recibidoNum - valorPago) : 0;
  const anticipoMinimo = config.anticipoPct > 0 && calculo.pendiente ? r2((calculo.total * config.anticipoPct) / 100) : 0;
  const quedaPendiente = calculo.pendiente || saldo > 0;
  const cliente = clienteId ? datos.clientes.find((c) => c.id === clienteId) ?? null : null;
  const mostrarCliente = quedaPendiente || verCliente;

  const sugerencias = useMemo(() => {
    if (clienteId) return [];
    const n = normalizar(nombre.trim());
    const t = digitos(telefono);
    if (n.length < 2 && t.length < 4) return [];
    return datos.clientes.filter((c) =>
      (n.length >= 2 && normalizar(c.nombre).includes(n)) || (t.length >= 4 && digitos(c.telefono ?? "").includes(t)),
    ).slice(0, 4);
  }, [datos.clientes, clienteId, nombre, telefono]);

  const problemas: string[] = [];
  if (!bodegaId) problemas.push("No tienes un punto de venta asignado.");
  if (!calculo.filas.length) problemas.push("Agrega al menos una camiseta.");
  if (calculo.filas.length !== lineas.length) problemas.push("Una camiseta ya no está a la venta: quítala.");
  if (!config.bajoPedido && calculo.filas.some((f) => f.falta > 0)) problemas.push("No hay tantas unidades en este punto: baja la cantidad.");
  if (permisos.cobra && valorPago > 0 && !metodo) problemas.push("Elige cómo paga el cliente.");
  if (modo === "parte" && abono.trim() === "") problemas.push("Escribe cuánto paga ahora el cliente (puede ser 0).");
  if (modo === "parte" && Number(abono) > calculo.total) problemas.push("El abono no puede ser mayor que el total.");
  if (anticipoMinimo > 0 && valorPago < anticipoMinimo) problemas.push(`Este pedido necesita un abono de al menos ${pesos(anticipoMinimo)}.`);
  if (enEfectivo && recibido !== "" && recibidoNum < valorPago) problemas.push(`Con ${pesos(recibidoNum)} no alcanza: faltan ${pesos(valorPago - recibidoNum)}.`);
  if (quedaPendiente && !cliente && !nombre.trim()) problemas.push("Escribe el nombre del cliente: la venta queda pendiente y hay que avisarle.");
  if (quedaPendiente && !cliente && digitos(telefono).length < 7) problemas.push("Escribe el teléfono del cliente para avisarle.");
  if (!cliente && !nombre.trim() && telefono.trim()) problemas.push("Escribe también el nombre del cliente.");

  function agregar(p: ProductoVenta) {
    if (!estadoDe(p).puede) return;
    setError("");
    setLineas((ls) => {
      const igual = ls.find((l) => l.varianteId === p.id);
      if (igual) return ls.map((l) => (l === igual ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...ls, { varianteId: p.id, cantidad: 1, personalizacion: "", descuentoId: mejorPromocion(p, promociones)?.id ?? null }];
    });
  }
  function cambiar(varianteId: string, cambios: Partial<Linea>) {
    setLineas((ls) => ls.map((l) => (l.varianteId === varianteId ? { ...l, ...cambios } : l)));
  }
  function quitarUna(varianteId: string) {
    setLineas((ls) => ls.flatMap((l) => (l.varianteId !== varianteId ? [l] : l.cantidad > 1 ? [{ ...l, cantidad: l.cantidad - 1 }] : [])));
  }
  function quitar(varianteId: string) {
    setLineas((ls) => ls.filter((l) => l.varianteId !== varianteId));
  }
  function elegirCliente(c: ClienteOpcion) {
    setClienteId(c.id);
    setNombre(c.nombre);
    setTelefono(c.telefono ?? "");
  }

  function registrar() {
    if (problemas.length || enviando) return;
    if (!claves.current) claves.current = { venta: nuevaClave(), pago: nuevaClave() };
    const c = claves.current;
    const entrada = {
      venta_id: ventaId,
      bodega_id: bodegaId,
      cliente_id: cliente?.id ?? null,
      cliente_nuevo: !cliente && nombre.trim() ? { nombre: nombre.trim(), telefono: telefono.trim() } : null,
      lineas: calculo.filas.map((f) => ({
        variante_id: f.l.varianteId, cantidad: f.l.cantidad,
        descuento_autorizado_id: f.promo?.id ?? null, personalizacion: f.l.personalizacion.trim(),
      })),
      pago: permisos.cobra && valorPago > 0 && metodo ? {
        metodo_pago_id: metodo.id, completo: modo === "todo", valor: modo === "todo" ? null : valorPago, referencia: referencia.trim(),
      } : null,
      clave: c.venta,
      clave_pago: c.pago,
    };
    const extra = {
      cambio: cambio > 0 ? cambio : 0,
      cliente: cliente?.nombre ?? nombre.trim(),
      telefono: cliente?.telefono ?? telefono.trim(),
      resumen: calculo.filas.map((f) => `${f.l.cantidad} × ${f.p.producto}${f.p.detalle ? ` (${f.p.detalle})` : ""}${f.l.personalizacion.trim() ? ` · ${f.l.personalizacion.trim()}` : ""}`),
    };
    setError("");
    iniciar(async () => {
      try {
        const r = await registrarVentaRapida(entrada);
        if (r.hecho) {
          setHecho({ ...r.hecho, ...extra });
          setPaso("listo");
          window.scrollTo({ top: 0 });
        } else {
          setError(r.error ?? "No se pudo registrar la venta.");
          if (r.ventaId) setVentaId(r.ventaId);
        }
      } catch {
        setError("No hubo conexión. Revisa el internet y vuelve a tocar «Registrar venta»: no se registrará dos veces.");
      }
    });
  }

  function nuevaVenta() {
    claves.current = null;
    setVentaId(null); setLineas([]); setHecho(null); setError(""); setPaso("elegir");
    setModo("todo"); setAbono(""); setRecibido(""); setReferencia(""); setMetodoId(efectivo?.id ?? "");
    setClienteId(null); setNombre(""); setTelefono(""); setVerCliente(false); setBusqueda(""); setGrupo(null);
    window.scrollTo({ top: 0 });
  }

  if (!datos.puntos.length) {
    return <Aviso>No tienes un punto de venta asignado. Pide al administrador que te asigne uno en Usuarios.</Aviso>;
  }

  // -------------------------------------------------------------------
  // 3. Listo
  // -------------------------------------------------------------------
  if (paso === "listo" && hecho) {
    const textoWhatsApp = [
      `¡Hola${hecho.cliente ? ` ${hecho.cliente.split(" ")[0]}` : ""}! Gracias por tu compra en LUMA.`,
      `Venta ${hecho.numero}`,
      ...hecho.resumen.map((r) => `• ${r}`),
      `Total: ${pesos(hecho.total)}`,
      `Pagado: ${pesos(hecho.pagado)}`,
      ...(hecho.saldo > 0 ? [`Saldo pendiente: ${pesos(hecho.saldo)}`] : []),
      ...(hecho.porEstampar ? ["Te avisamos cuando tu camiseta esté lista."] : []),
    ].join("\n");
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-4 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-turquesa/15 text-turquesa">
          <Check className="size-11" strokeWidth={3} aria-hidden />
        </span>
        <div>
          <h2 className="font-titulo text-3xl font-semibold text-morado">¡Venta registrada!</h2>
          <p className="mt-1 text-lg text-suave">Venta <strong className="text-tinta">{hecho.numero}</strong> · <span className="cifra">{pesos(hecho.total)}</span></p>
        </div>

        {hecho.cambio > 0 && (
          <div className="w-full rounded-2xl border-2 border-amarillo bg-amarillo/20 p-4">
            <p className="font-semibold text-tinta">Devuelve al cliente</p>
            <p className="cifra font-titulo text-5xl font-bold text-morado">{pesos(hecho.cambio)}</p>
          </div>
        )}

        <div className="w-full text-left">
          {hecho.entregada ? (
            <Aviso tipo="exito">Entregada: el cliente se lleva sus camisetas. El inventario ya se descontó.</Aviso>
          ) : hecho.porEstampar ? (
            <Aviso tipo="info">El pedido pasó a <strong>Estampado</strong>. Avísale al cliente cuando esté listo
              {hecho.saldo > 0 ? <> y cóbrale el saldo de <strong className="cifra">{pesos(hecho.saldo)}</strong></> : null}.</Aviso>
          ) : hecho.faltanUnidades ? (
            <Aviso tipo="info">Faltan unidades en este punto: la venta quedó separada y se entrega cuando lleguen.
              {hecho.saldo > 0 ? <> El cliente debe <strong className="cifra">{pesos(hecho.saldo)}</strong>.</> : null}</Aviso>
          ) : hecho.saldo > 0 ? (
            <Aviso tipo="info">El cliente debe <strong className="cifra">{pesos(hecho.saldo)}</strong>. Las camisetas quedan separadas:
              entrégalas cuando termine de pagar (desde la venta, botón «Registrar pago»).</Aviso>
          ) : (
            <Aviso tipo="info">Pagada. Falta registrar la entrega desde el detalle de la venta.</Aviso>
          )}
        </div>

        <Boton type="button" onClick={nuevaVenta} className="min-h-14 w-full text-lg">
          <Plus className="size-5" aria-hidden /> Nueva venta
        </Boton>
        <div className="grid w-full gap-2 sm:grid-cols-3">
          <a href={enlaceWhatsApp(hecho.telefono, textoWhatsApp)} target="_blank" rel="noopener noreferrer"
             className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-borde bg-white px-3 font-semibold text-morado hover:bg-morado-50">
            <MessageCircle className="size-4" aria-hidden /> WhatsApp
          </a>
          <a href={`/comprobante/venta/${hecho.ventaId}`} target="_blank" rel="noopener noreferrer"
             className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-borde bg-white px-3 font-semibold text-morado hover:bg-morado-50">
            <Printer className="size-4" aria-hidden /> Comprobante
          </a>
          <Link href={`/ventas/${hecho.ventaId}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-borde bg-white px-3 font-semibold text-morado hover:bg-morado-50">
            Ver la venta
          </Link>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // 2. Cobrar
  // -------------------------------------------------------------------
  if (paso === "cobrar") {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => setPaso("elegir")}
                className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-2 font-semibold text-morado hover:bg-morado-50">
          <ArrowLeft className="size-5" aria-hidden /> Agregar más camisetas
        </button>

        <div className="grid items-start gap-4 lg:grid-cols-[1fr_24rem]">
          <section aria-labelledby="titulo-lleva" className="rounded-2xl border border-borde bg-white p-4">
            <h2 id="titulo-lleva" className="font-titulo text-xl font-semibold text-morado">Lo que se lleva</h2>
            {!calculo.filas.length && <p className="mt-3 text-suave">No hay camisetas. Toca «Agregar más camisetas».</p>}
            <ul className="mt-2 divide-y divide-borde">
              {calculo.filas.map((f) => {
                const tope = !f.p.porPedido && !config.bajoPedido && f.l.cantidad >= hay(f.p);
                return (
                  <li key={f.l.varianteId} className="flex flex-col gap-2 py-3">
                    <div className="flex items-start gap-3">
                      <Muestra hex={f.p.colorHex} />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold leading-tight">{f.p.producto}</p>
                        <p className="text-sm text-suave">{f.p.detalle || f.p.sku}</p>
                      </div>
                      <div className="text-right">
                        <p className="cifra font-bold">{pesos(f.total)}</p>
                        {f.desc > 0 && <p className="cifra text-sm text-suave line-through">{pesos(f.bruto)}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center rounded-xl border border-borde">
                        <button type="button" onClick={() => quitarUna(f.l.varianteId)} aria-label="Quitar una"
                                className="flex size-11 items-center justify-center text-morado hover:bg-morado-50">
                          <Minus className="size-5" aria-hidden />
                        </button>
                        <span className="cifra min-w-10 text-center text-lg font-bold" aria-label={`Cantidad: ${f.l.cantidad}`}>{f.l.cantidad}</span>
                        <button type="button" onClick={() => agregar(f.p)} aria-label="Agregar una" disabled={tope || !estadoDe(f.p).puede}
                                className="flex size-11 items-center justify-center text-morado hover:bg-morado-50 disabled:opacity-40">
                          <Plus className="size-5" aria-hidden />
                        </button>
                      </div>
                      <span className="cifra text-sm text-suave">{pesos(f.p.precio)} c/u</span>
                      <button type="button" onClick={() => quitar(f.l.varianteId)} aria-label={`Quitar ${f.p.producto} ${f.p.detalle}`}
                              className="ml-auto flex size-11 items-center justify-center rounded-xl text-suave hover:bg-error/5 hover:text-error">
                        <Trash2 className="size-5" aria-hidden />
                      </button>
                    </div>
                    {f.opciones.map((d) => {
                      const puesta = f.promo?.id === d.id;
                      return (
                        <button key={d.id} type="button" aria-pressed={puesta}
                                onClick={() => cambiar(f.l.varianteId, { descuentoId: puesta ? null : d.id })}
                                className={cn("self-start rounded-full border px-3 py-1.5 text-sm font-semibold",
                                              puesta ? "border-rosa bg-rosa/10 text-rosa" : "border-borde text-suave hover:border-rosa")}>
                          {puesta ? "✓ Promoción: " : "Aplicar promoción: "}{d.nombre}
                          {d.nombre.replace(/\s/g, "").includes(describirDescuento(d).replace(/\s/g, "")) ? "" : ` (${describirDescuento(d)})`}
                          {puesta ? " · tocar para quitar" : ""}
                        </button>
                      );
                    })}
                    {f.p.porPedido && (
                      <label className="flex flex-col gap-1 text-sm font-semibold">
                        ¿Qué lleva estampado?
                        <input value={f.l.personalizacion} maxLength={500} placeholder="Nombre, número, frase o diseño"
                               onChange={(e) => cambiar(f.l.varianteId, { personalizacion: e.target.value })} className={campo} />
                      </label>
                    )}
                    {f.falta > 0 && (
                      <p className="text-sm font-semibold text-naranja">
                        {config.bajoPedido ? `Faltan ${f.falta} en este punto: se entrega cuando lleguen.` : `Solo hay ${hay(f.p)} en este punto.`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {calculo.descuentos > 0 && (
              <p className="cifra mt-2 text-right text-sm text-rosa">Ahorra {pesos(calculo.descuentos)} con la promoción</p>
            )}
          </section>

          <section aria-labelledby="titulo-cobrar" className="flex flex-col gap-4 rounded-2xl border border-borde bg-white p-4 lg:sticky lg:top-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="titulo-cobrar" className="font-titulo text-xl font-semibold text-morado">Total</h2>
              <p className="cifra font-titulo text-4xl font-bold text-morado">{pesos(calculo.total)}</p>
            </div>

            {permisos.cobra ? (
              <>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 font-bold">¿Cuánto paga ahora?</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <Opcion activa={modo === "todo"} onClick={() => setModo("todo")}>Todo</Opcion>
                    <Opcion activa={modo === "parte"} onClick={() => setModo("parte")}>Una parte (abono)</Opcion>
                  </div>
                  {modo === "parte" && (
                    <div className="flex flex-col gap-2">
                      <input type="number" inputMode="numeric" min={0} step={1000} value={abono} aria-label="Valor del abono"
                             placeholder="¿Cuánto abona?" onChange={(e) => setAbono(e.target.value)} className={cn(campo, "cifra")} />
                      <div className="flex flex-wrap gap-2">
                        {[...new Set([anticipoMinimo, r2(Math.round(calculo.total / 2 / 1000) * 1000), 0])].filter((v) => v >= 0 && v < calculo.total).map((v) => (
                          <button key={v} type="button" onClick={() => setAbono(String(v))}
                                  className="cifra rounded-full border border-borde px-3 py-1.5 text-sm font-semibold text-morado hover:bg-morado-50">
                            {v === 0 ? "No paga ahora" : v === anticipoMinimo ? `Mínimo ${pesos(v)}` : pesos(v)}
                          </button>
                        ))}
                      </div>
                      {abono !== "" && <p className="cifra text-sm text-suave">Quedará debiendo <strong className="text-tinta">{pesos(saldo)}</strong></p>}
                    </div>
                  )}
                </fieldset>

                {valorPago > 0 && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 font-bold">¿Cómo paga?</legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                      {metodos.map((m) => (
                        <Opcion key={m.id} activa={m.id === metodoId} onClick={() => setMetodoId(m.id)}>{m.nombre}</Opcion>
                      ))}
                    </div>
                  </fieldset>
                )}

                {enEfectivo && (
                  <div className="flex flex-col gap-2">
                    <p className="font-bold">¿Con cuánto paga? <span className="font-normal text-suave">(para saber el cambio)</span></p>
                    <div className="flex flex-wrap gap-2">
                      {[valorPago, ...billetes(valorPago)].map((v, i) => (
                        <button key={v} type="button" onClick={() => setRecibido(String(v))} aria-pressed={recibidoNum === v && recibido !== ""}
                                className={cn("cifra rounded-full border px-3 py-1.5 font-semibold",
                                              recibidoNum === v && recibido !== "" ? "border-morado bg-morado text-white" : "border-borde text-morado hover:bg-morado-50")}>
                          {i === 0 ? "Exacto" : pesos(v)}
                        </button>
                      ))}
                    </div>
                    <input type="number" inputMode="numeric" min={0} step={1000} value={recibido} aria-label="Con cuánto paga"
                           placeholder="Otro valor" onChange={(e) => setRecibido(e.target.value)} className={cn(campo, "cifra")} />
                    {recibido !== "" && recibidoNum >= valorPago && (
                      <div className="rounded-2xl bg-amarillo/25 px-4 py-3">
                        <p className="text-sm font-semibold">Devuelve</p>
                        <p className="cifra font-titulo text-3xl font-bold text-morado">{pesos(cambio)}</p>
                      </div>
                    )}
                  </div>
                )}

                {conReferencia && (
                  <label className="flex flex-col gap-1 font-bold">
                    Número del comprobante <span className="text-sm font-normal text-suave">(opcional, ayuda a cuadrar la caja)</span>
                    <input value={referencia} maxLength={120} onChange={(e) => setReferencia(e.target.value)} className={campo} aria-label="Número del comprobante" />
                  </label>
                )}
              </>
            ) : (
              <Aviso tipo="info">Tu usuario no recibe pagos: la venta queda pendiente de cobro.</Aviso>
            )}

            {modo === "parte" && abono !== "" && valorPago === 0 && (
              <p className="text-sm text-suave">No recibe dinero ahora: las camisetas quedan separadas a nombre del cliente.</p>
            )}

            {mostrarCliente ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 font-bold">{quedaPendiente ? "¿A nombre de quién queda?" : "Cliente (opcional)"}</legend>
                {cliente ? (
                  <div className="flex items-center gap-3 rounded-xl border border-morado-100 bg-morado-50 px-3 py-2">
                    <UserRound className="size-5 text-morado" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{cliente.nombre}</p>
                      {cliente.telefono && <p className="text-sm text-suave">{cliente.telefono}</p>}
                    </div>
                    <button type="button" onClick={() => { setClienteId(null); setNombre(""); setTelefono(""); }} aria-label="Cambiar cliente"
                            className="flex size-11 items-center justify-center rounded-xl text-suave hover:bg-white">
                      <X className="size-5" aria-hidden />
                    </button>
                  </div>
                ) : (
                  <>
                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={160} placeholder="Nombre"
                           aria-label="Nombre del cliente" autoComplete="off" className={campo} />
                    <input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} placeholder="Celular"
                           aria-label="Teléfono del cliente" inputMode="tel" autoComplete="off" className={campo} />
                    {sugerencias.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="text-sm text-suave">¿Es alguno de estos clientes?</p>
                        {sugerencias.map((c) => (
                          <button key={c.id} type="button" onClick={() => elegirCliente(c)}
                                  className="flex min-h-11 items-center gap-2 rounded-xl border border-borde px-3 text-left hover:bg-morado-50">
                            <UserRound className="size-4 shrink-0 text-morado" aria-hidden />
                            <span className="truncate font-semibold">{c.nombre}</span>
                            {c.telefono && <span className="ml-auto shrink-0 text-sm text-suave">{c.telefono}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </fieldset>
            ) : (
              <button type="button" onClick={() => setVerCliente(true)}
                      className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-2 font-semibold text-morado hover:bg-morado-50">
                <UserRound className="size-5" aria-hidden /> Agregar el nombre del cliente (opcional)
              </button>
            )}

            {error && <Aviso>{error}</Aviso>}
            <Boton type="button" onClick={registrar} cargando={enviando} disabled={problemas.length > 0} className="min-h-14 text-lg">
              <Check className="size-5" aria-hidden /> Registrar venta
            </Boton>
            {problemas.length > 0 && <p className="text-sm font-semibold text-naranja" role="status">{problemas[0]}</p>}
          </section>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // 1. Elegir las camisetas
  // -------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {datos.puntos.length > 1 && (
          <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} aria-label="Punto de venta"
                  className="min-h-12 rounded-xl border border-borde bg-white px-3 font-semibold text-morado">
            {datos.puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        )}
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-suave" aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar: nombre, talla o color"
                 aria-label="Buscar camiseta" className={cn(campo, "pl-10")} />
          {busqueda && (
            <button type="button" onClick={() => setBusqueda("")} aria-label="Borrar búsqueda"
                    className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-suave">
              <X className="size-5" aria-hidden />
            </button>
          )}
        </label>
      </div>

      {grupos.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Productos">
          <Ficha activa={!grupo} onClick={() => setGrupo(null)}>Todas</Ficha>
          {grupos.map((g) => <Ficha key={g.id} activa={grupo === g.id} onClick={() => setGrupo(grupo === g.id ? null : g.id)}>{g.nombre}</Ficha>)}
        </div>
      )}

      {!datos.productos.length && <Aviso tipo="info">Todavía no hay camisetas a la venta. El administrador las crea en Productos.</Aviso>}
      {datos.productos.length > 0 && !visibles.length && <p className="py-6 text-center text-suave">No hay camisetas con «{busqueda}».</p>}

      {visibles.map((g) => (
        <section key={g.id} aria-label={g.nombre} className="flex flex-col gap-2">
          <h2 className="font-titulo text-lg font-semibold text-morado">{g.nombre}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {g.items.map((p) => {
              const e = estadoDe(p);
              const n = enCarrito.get(p.id) ?? 0;
              const extra = [p.diseno, p.tipo].filter(Boolean).join(" · ");
              return (
                <div key={p.id} className="relative">
                  <button type="button" onClick={() => agregar(p)} disabled={!e.puede} data-sku={p.sku}
                          aria-label={`Agregar ${p.producto} ${p.detalle}, ${p.precio === null ? "sin precio" : pesos(p.precio)}, ${e.texto}`}
                          className={cn("flex min-h-32 w-full flex-col items-start gap-1 rounded-2xl border-2 bg-white p-3 text-left transition-colors",
                                        n > 0 ? "border-morado bg-morado-50" : "border-borde hover:border-morado-100",
                                        !e.puede && "cursor-not-allowed opacity-50")}>
                    <span className="font-titulo text-2xl font-bold leading-none text-tinta">{p.talla ?? "Única"}</span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Muestra hex={p.colorHex} pequena /> {p.color ?? "Sin color"}
                    </span>
                    {extra && <span className="line-clamp-2 text-xs text-suave">{extra}</span>}
                    <span className="cifra mt-auto font-bold text-morado">{p.precio === null ? "—" : pesos(p.precio)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold",
                                        e.tono === "ok" && "bg-turquesa/15 text-morado",
                                        e.tono === "alerta" && "bg-naranja/15 text-naranja",
                                        e.tono === "marca" && "bg-rosa/10 text-rosa",
                                        e.tono === "gris" && "bg-borde text-suave")}>{e.texto}</span>
                  </button>
                  {n > 0 && (
                    <>
                      <span className="cifra pointer-events-none absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-morado text-sm font-bold text-white" aria-hidden>
                        {n}
                      </span>
                      <button type="button" onClick={() => quitarUna(p.id)} aria-label={`Quitar una ${p.producto} ${p.detalle}`}
                              className="absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-full border border-borde bg-white text-morado shadow-sm">
                        <Minus className="size-5" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mt-2 lg:bottom-4">
        {lineas.length > 0 ? (
          <button type="button" onClick={() => { setPaso("cobrar"); window.scrollTo({ top: 0 }); }}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-morado px-5 text-left text-white shadow-xl hover:bg-morado-700">
            <ShoppingBag className="size-6 shrink-0" aria-hidden />
            <span className="flex-1">
              <span className="block text-sm text-white/80">{calculo.unidades} {calculo.unidades === 1 ? "camiseta" : "camisetas"}</span>
              <span className="cifra block font-titulo text-2xl font-bold">{pesos(calculo.total)}</span>
            </span>
            <span className="flex items-center gap-1 rounded-xl bg-white px-4 py-2 text-lg font-bold text-morado">
              Cobrar <ChevronRight className="size-5" aria-hidden />
            </span>
          </button>
        ) : (
          <p className="rounded-2xl border border-dashed border-borde bg-white/90 px-4 py-3 text-center text-suave backdrop-blur">
            Toca una camiseta para agregarla. Cada toque suma una.
          </p>
        )}
      </div>
    </div>
  );
}

function Muestra({ hex, pequena }: { hex: string | null; pequena?: boolean }) {
  return (
    <span aria-hidden className={cn("inline-block shrink-0 rounded-full border border-borde", pequena ? "size-4" : "mt-1 size-6")}
          style={{ background: hex ?? "repeating-linear-gradient(45deg,#eee,#eee 3px,#fff 3px,#fff 6px)" }} />
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn("min-h-12 rounded-xl border-2 px-3 font-bold transition-colors",
                          activa ? "border-morado bg-morado text-white" : "border-borde bg-white text-morado hover:border-morado-100")}>
      {children}
    </button>
  );
}

function Ficha({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn("min-h-10 shrink-0 whitespace-nowrap rounded-full border px-4 font-semibold",
                          activa ? "border-morado bg-morado text-white" : "border-borde bg-white text-morado")}>
      {children}
    </button>
  );
}
