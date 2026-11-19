"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Search, Trash2, X } from "lucide-react";
import { guardarCompra, type Estado } from "./acciones";
import type { DatosFormularioCompra, ProductoCompra } from "@/lib/compras-datos";
import { nuevaClave } from "@/lib/ventas";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { cn, pesos } from "@/lib/utilidades";

type Linea = { clave: number; varianteId: string; cantidad: string; costo: string; descuento: string; iva: string };
type Adicional = { clave: number; concepto: string; valor: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const campo = "min-h-11 w-full rounded-xl border border-borde bg-white px-3 text-base outline-none focus:border-morado";
const CLASES: Record<string, string> = { terminado: "Camiseta terminada", base: "Camiseta base", material: "Material" };

// Compra nueva o edición de un borrador. Los totales son una vista previa: la base de datos los recalcula.
export function FormularioCompra({ datos }: { datos: DatosFormularioCompra }) {
  const { inicial } = datos;
  const [estado, accion, enviando] = useActionState<Estado, FormData>(guardarCompra, {});
  const compraId = estado.compraId ?? inicial?.compraId ?? null;
  const porId = useMemo(() => new Map(datos.productos.map((p) => [p.id, p])), [datos.productos]);
  const [proveedor, setProveedor] = useState(inicial?.proveedorId ?? "");
  const [bodega, setBodega] = useState(inicial?.bodegaId ?? datos.puntos[0]?.id ?? "");
  const [fecha, setFecha] = useState(inicial?.fecha ?? datos.hoy);
  const [formaPago, setFormaPago] = useState(inicial?.formaPago ?? "Contado");
  const [observaciones, setObservaciones] = useState(inicial?.observaciones ?? "");
  const [lineas, setLineas] = useState<Linea[]>(() => (inicial?.lineas ?? []).map((l, i) => ({
    clave: i + 1, varianteId: l.varianteId, cantidad: String(l.cantidad), costo: String(l.costo),
    descuento: l.descuento ? String(l.descuento) : "", iva: String(l.iva),
  })));
  const [adicionales, setAdicionales] = useState<Adicional[]>(() => (inicial?.adicionales ?? []).map((a, i) => ({ clave: i + 1, concepto: a.concepto, valor: String(a.valor) })));
  const claveConfirmacion = useRef("");

  const calculo = useMemo(() => {
    let subtotal = 0, descuentos = 0, impuestos = 0;
    const filas = [];
    for (const l of lineas) {
      const p = porId.get(l.varianteId);
      const cant = Number(l.cantidad) || 0;
      const costo = Number(l.costo) || 0;
      const bruto = r2(cant * costo);
      const desc = Math.min(Math.max(Number(l.descuento) || 0, 0), bruto);
      const iva = r2(((bruto - desc) * (Number(l.iva) || 0)) / 100);
      subtotal += bruto; descuentos += desc; impuestos += iva;
      filas.push({ l, p, cant, costo, bruto, desc, iva });
    }
    const extra = adicionales.reduce((s, a) => s + (Number(a.valor) || 0), 0);
    return { filas, subtotal: r2(subtotal), descuentos: r2(descuentos), impuestos: r2(impuestos), extra: r2(extra),
             total: r2(subtotal - descuentos + impuestos + extra) };
  }, [lineas, adicionales, porId]);

  const problemas: string[] = [];
  if (!proveedor) problemas.push("Elige el proveedor.");
  if (!bodega) problemas.push("Elige a qué punto llega la mercancía.");
  if (!calculo.filas.length) problemas.push("Agrega al menos un producto.");
  for (const f of calculo.filas) {
    if (!f.p) problemas.push("Un producto ya no está activo: quítalo.");
    else if (!(f.cant > 0)) problemas.push(`Revisa la cantidad de ${f.p.sku}.`);
    else if (f.p.unidad === "unidad" && !Number.isInteger(f.cant)) problemas.push(`${f.p.sku} se compra en unidades enteras.`);
    else if (f.l.costo.trim() === "") problemas.push(`Escribe el costo unitario de ${f.p.sku}.`);
  }
  for (const a of adicionales) if (!a.concepto.trim() || !(Number(a.valor) > 0)) problemas.push("Completa o quita el costo adicional vacío.");

  const json = JSON.stringify({
    compra_id: compraId, proveedor_id: proveedor, bodega_id: bodega, fecha, forma_pago: formaPago, observaciones,
    lineas: calculo.filas.filter((f) => f.p).map((f) => ({
      variante_id: f.l.varianteId, cantidad: f.cant, costo_unitario: f.costo, descuento: f.desc, impuesto_pct: Number(f.l.iva) || 0,
    })),
    costos_adicionales: adicionales.filter((a) => a.concepto.trim() && Number(a.valor) > 0).map((a) => ({ concepto: a.concepto.trim(), valor: Number(a.valor) })),
  });

  function cambiar(clave: number, cambios: Partial<Linea>) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  }
  function agregar(p: ProductoCompra) {
    setLineas((ls) => ls.some((l) => l.varianteId === p.id) ? ls : [...ls, {
      clave: Math.max(0, ...ls.map((l) => l.clave)) + 1, varianteId: p.id, cantidad: "1", costo: p.costo !== null ? String(Math.round(p.costo)) : "",
      descuento: "", iva: "0",
    }]);
  }
  function enviar(tipo: "guardar" | "confirmar" | "recibir") {
    const fd = new FormData();
    fd.set("datos", json);
    fd.set("accion", tipo);
    if (tipo === "recibir") {
      if (!claveConfirmacion.current) claveConfirmacion.current = nuevaClave();
      fd.set("clave", claveConfirmacion.current);
    }
    startTransition(() => accion(fd));
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-4 xl:grid-cols-[1fr_380px]" aria-label="Compra">
      <div className="flex min-w-0 flex-col gap-4">
        <Tarjeta className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Proveedor
            <select value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={cn(campo, "font-normal")} aria-label="Proveedor">
              <option value="" disabled>Elige…</option>
              {datos.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {datos.proveedores.length === 0 && <span className="font-normal text-suave">Primero registra el proveedor en <Link href="/proveedores" className="font-semibold text-morado underline">Proveedores</Link>.</span>}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Llega a
            <select value={bodega} onChange={(e) => setBodega(e.target.value)} className={cn(campo, "font-normal")} aria-label="Punto de llegada">
              {datos.puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Fecha de la compra
            <input type="date" value={fecha} max={datos.hoy} onChange={(e) => setFecha(e.target.value)} className={cn(campo, "font-normal")} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Forma de pago
            <input value={formaPago} onChange={(e) => setFormaPago(e.target.value)} list="formas-pago" maxLength={80} className={cn(campo, "font-normal")} />
            <datalist id="formas-pago"><option value="Contado" /><option value="Crédito 15 días" /><option value="Crédito 30 días" /></datalist>
          </label>
        </Tarjeta>

        <Tarjeta className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-morado">Productos</h2>
          <BuscadorCompra productos={datos.productos} onAgregar={agregar} />
          {calculo.filas.length === 0 && <p className="rounded-xl bg-morado-50 p-3 text-sm text-suave">Busca camisetas base, materiales o camisetas terminadas y tócalas para agregarlas.</p>}
          <ul className="flex flex-col gap-3" aria-label="Productos de la compra">
            {calculo.filas.map((f) => (
              <li key={f.l.clave} className="flex flex-col gap-3 rounded-xl border border-borde p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{f.p ? `${f.p.producto}${f.p.detalle ? ` · ${f.p.detalle}` : ""}` : "Producto no disponible"}</p>
                    {f.p && <p className="text-sm text-suave">{f.p.sku} · {CLASES[f.p.clase] ?? f.p.clase}{f.p.costo !== null ? ` · costo promedio ${pesos(f.p.costo)}` : ""}</p>}
                  </div>
                  <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== f.l.clave))}
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-error hover:bg-error/5" aria-label={`Quitar ${f.p?.sku ?? "producto"}`}>
                    <Trash2 className="size-5" aria-hidden />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    Cantidad{f.p && f.p.unidad !== "unidad" ? ` (${f.p.unidad})` : ""}
                    <input type="number" inputMode="decimal" min={0} step={f.p?.unidad === "unidad" ? 1 : "any"} value={f.l.cantidad}
                           aria-label={`Cantidad de ${f.p?.sku ?? ""}`} onChange={(e) => cambiar(f.l.clave, { cantidad: e.target.value })} className={cn(campo, "cifra font-normal")} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    Costo unitario
                    <input type="number" inputMode="decimal" min={0} step="any" value={f.l.costo} aria-label={`Costo unitario de ${f.p?.sku ?? ""}`}
                           onChange={(e) => cambiar(f.l.clave, { costo: e.target.value })} className={cn(campo, "cifra font-normal")} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    Descuento ($)
                    <input type="number" inputMode="numeric" min={0} value={f.l.descuento} placeholder="0"
                           onChange={(e) => cambiar(f.l.clave, { descuento: e.target.value })} className={cn(campo, "cifra font-normal")} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    IVA
                    <select value={f.l.iva} onChange={(e) => cambiar(f.l.clave, { iva: e.target.value })} className={cn(campo, "font-normal")}>
                      <option value="0">Sin IVA</option><option value="5">5 %</option><option value="19">19 %</option>
                    </select>
                  </label>
                </div>
                <p className="text-right text-sm">Valor de la línea: <b className="cifra">{pesos(f.bruto - f.desc + f.iva)}</b></p>
              </li>
            ))}
          </ul>
        </Tarjeta>

        <Tarjeta className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-morado">Costos adicionales</h2>
          <p className="text-sm text-suave">Flete, envío o acarreo de esta compra: se reparten en el costo de cada producto según su valor.</p>
          {adicionales.map((a) => (
            <div key={a.clave} className="flex gap-2">
              <input aria-label="Concepto del costo adicional" value={a.concepto} maxLength={120} placeholder="Ej.: flete"
                     onChange={(e) => setAdicionales((as) => as.map((x) => (x.clave === a.clave ? { ...x, concepto: e.target.value } : x)))} className={campo} />
              <input aria-label="Valor del costo adicional" type="number" inputMode="numeric" min={0} value={a.valor} placeholder="Valor"
                     onChange={(e) => setAdicionales((as) => as.map((x) => (x.clave === a.clave ? { ...x, valor: e.target.value } : x)))} className={cn(campo, "cifra w-36")} />
              <button type="button" aria-label="Quitar costo adicional" onClick={() => setAdicionales((as) => as.filter((x) => x.clave !== a.clave))}
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-error hover:bg-error/5"><X className="size-5" aria-hidden /></button>
            </div>
          ))}
          <button type="button" onClick={() => setAdicionales((as) => [...as, { clave: Math.max(0, ...as.map((x) => x.clave)) + 1, concepto: "", valor: "" }])}
                  className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-2 font-semibold text-morado hover:bg-morado-50">
            <Plus className="size-5" aria-hidden /> Agregar costo adicional
          </button>
        </Tarjeta>
      </div>

      <div className="flex flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <Tarjeta className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-morado">Resumen</h2>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><dt className="text-suave">Subtotal</dt><dd className="cifra">{pesos(calculo.subtotal)}</dd></div>
            {calculo.descuentos > 0 && <div className="flex justify-between"><dt className="text-suave">Descuentos</dt><dd className="cifra">− {pesos(calculo.descuentos)}</dd></div>}
            {calculo.impuestos > 0 && <div className="flex justify-between"><dt className="text-suave">IVA</dt><dd className="cifra">{pesos(calculo.impuestos)}</dd></div>}
            {calculo.extra > 0 && <div className="flex justify-between"><dt className="text-suave">Costos adicionales</dt><dd className="cifra">{pesos(calculo.extra)}</dd></div>}
            <div className="flex justify-between border-t border-borde pt-2 text-lg font-semibold text-morado"><dt>Total</dt><dd className="cifra">{pesos(calculo.total)}</dd></div>
          </dl>
          {calculo.impuestos > 0 && !datos.ivaDescontable && <p className="text-xs text-suave">Como no eres responsable de IVA, el IVA pagado se suma al costo de los productos.</p>}
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Observaciones
            <textarea value={observaciones} maxLength={500} rows={2} onChange={(e) => setObservaciones(e.target.value)}
                      className="rounded-xl border border-borde bg-white px-3 py-2 text-base font-normal outline-none focus:border-morado" placeholder="Número de factura del proveedor, fecha de entrega…" />
          </label>
          {estado.error && <Aviso>{estado.error}</Aviso>}
          {problemas.length > 0 && calculo.filas.length > 0 && (
            <ul className="list-inside list-disc text-sm text-error">{[...new Set(problemas)].map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex flex-col gap-2">
            <Boton type="button" onClick={() => enviar("recibir")} cargando={enviando} disabled={problemas.length > 0}>Confirmar y recibir todo</Boton>
            <Boton type="button" variante="secundario" onClick={() => enviar("confirmar")} disabled={enviando || problemas.length > 0}>Confirmar pedido (llega después)</Boton>
            <Boton type="button" variante="fantasma" onClick={() => enviar("guardar")} disabled={enviando || problemas.length > 0}>
              {compraId ? "Guardar cambios del borrador" : "Guardar borrador"}
            </Boton>
          </div>
          <p className="text-xs text-suave">Al recibir, la mercancía entra al inventario del punto con su costo y actualiza el costo promedio.</p>
        </Tarjeta>
      </div>
    </form>
  );
}

function BuscadorCompra({ productos, onAgregar }: { productos: ProductoCompra[]; onAgregar: (p: ProductoCompra) => void }) {
  const [texto, setTexto] = useState("");
  const palabras = normalizar(texto.trim()).split(/\s+/).filter(Boolean);
  const indice = useMemo(() => productos.map((p) => ({ p, clave: normalizar(`${p.producto} ${p.detalle} ${p.sku} ${CLASES[p.clase] ?? ""}`) })), [productos]);
  const resultados = palabras.length ? indice.filter((x) => palabras.every((w) => x.clave.includes(w))).map((x) => x.p).slice(0, 24) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-suave" aria-hidden />
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar producto para comprar"
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (resultados[0]) { onAgregar(resultados[0]); setTexto(""); } } }}
               placeholder="Buscar por nombre, talla, color o SKU" className={cn(campo, "pl-10")} />
      </div>
      {palabras.length > 0 && !resultados.length && <p className="text-sm text-suave">No hay productos que coincidan. Créalo primero en Productos.</p>}
      <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
        {resultados.map((p) => (
          <button key={p.id} type="button" onClick={() => { onAgregar(p); }}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-borde bg-white p-2.5 text-left hover:border-morado">
            <Plus className="size-5 shrink-0 text-morado" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{p.producto}{p.detalle ? ` · ${p.detalle}` : ""}</span>
              <span className="block truncate text-xs text-suave">{p.sku} · {CLASES[p.clase] ?? p.clase}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
