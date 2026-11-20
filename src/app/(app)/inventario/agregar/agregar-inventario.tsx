"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, PackagePlus, Plus } from "lucide-react";
import { agregarInventario, crearOpcion, type EntradaHecha } from "./acciones";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { nuevaClave } from "@/lib/ventas";
import { cn, pesos } from "@/lib/utilidades";

// Agregar inventario: 1) la camiseta, 2) tallas y colores, 3) cuántas de cada una, 4) costo y origen.

export type DatosAgregar = {
  productos: { id: string; codigo: string; nombre: string; clase: "terminado" | "base"; se_vende: boolean }[];
  variantes: {
    id: string; producto_id: string; sku: string; tipo_id: string | null; talla_id: string | null; color_id: string | null;
    diseno_id: string | null; precio_venta: number | null; activo: boolean;
  }[];
  existencias: { variante_id: string; bodega_id: string; cantidad: number }[];
  tipos: { id: string; nombre: string }[];
  tallas: { id: string; nombre: string; orden: number }[];
  colores: { id: string; nombre: string; hex: string | null }[];
  disenos: { id: string; codigo: string; nombre: string }[];
  puntos: { id: string; nombre: string }[];
  proveedores: { id: string; nombre: string }[];
  cuentas: { id: string; nombre: string; tipo: string; bodega_id: string | null }[];
  permisos: { catalogo: boolean; directo: boolean; compra: boolean; pagar: boolean; proveedores: boolean };
  productoInicial: string | null;
};
type Opcion = { id: string; nombre: string; hex?: string | null; orden?: number };

const NUEVO = "__nuevo__";
const campo = "min-h-11 w-full rounded-xl border border-borde bg-white px-3 outline-none focus:border-morado";
const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const llave = (tipo: string | null, talla: string | null, color: string | null, diseno: string | null) => `${tipo}|${talla}|${color}|${diseno ?? ""}`;
const unir = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];

function masComun<T>(lista: T[]): T | null {
  const conteo = new Map<T, number>();
  for (const x of lista) if (x !== null && x !== undefined) conteo.set(x, (conteo.get(x) ?? 0) + 1);
  let mejor: T | null = null;
  let n = 0;
  for (const [x, c] of conteo) if (c > n) { mejor = x; n = c; }
  return mejor;
}

// Lo que ya tiene la camiseta: su tipo, diseño, tallas, colores y precio más usados
function preseleccion(datos: DatosAgregar, productoId: string) {
  const vs = datos.variantes.filter((v) => v.producto_id === productoId && v.activo);
  const tipo = masComun(vs.map((v) => v.tipo_id)) ?? (datos.tipos.length === 1 ? datos.tipos[0].id : "");
  const diseno = masComun(vs.map((v) => v.diseno_id));
  const deEse = vs.filter((v) => v.tipo_id === tipo && v.diseno_id === diseno);
  const precio = masComun(deEse.map((v) => v.precio_venta));
  return {
    tipo, diseno: diseno ?? "",
    tallas: [...new Set(deEse.map((v) => v.talla_id).filter(Boolean))] as string[],
    colores: [...new Set(deEse.map((v) => v.color_id).filter(Boolean))] as string[],
    precio: precio === null ? "" : String(Number(precio)),
  };
}

export function AgregarInventario({ datos }: { datos: DatosAgregar }) {
  const { permisos } = datos;
  const [extras, setExtras] = useState<{ tipos: Opcion[]; tallas: Opcion[]; colores: Opcion[] }>({ tipos: [], tallas: [], colores: [] });
  const tipos = useMemo(() => unir(datos.tipos, extras.tipos), [datos.tipos, extras.tipos]);
  const tallas = useMemo(() => unir<Opcion>(datos.tallas, extras.tallas)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)), [datos.tallas, extras.tallas]);
  const colores = useMemo(() => unir<Opcion>(datos.colores, extras.colores)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [datos.colores, extras.colores]);

  const inicial = datos.productoInicial ? preseleccion(datos, datos.productoInicial) : null;
  const [modo, setModo] = useState<"existente" | "nuevo">(datos.productos.length || !permisos.catalogo ? "existente" : "nuevo");
  const [productoId, setProductoId] = useState(datos.productoInicial ?? "");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevaClase, setNuevaClase] = useState<"terminado" | "base">("terminado");
  const [disenoId, setDisenoId] = useState(inicial?.diseno ?? "");
  const [disenoNuevo, setDisenoNuevo] = useState("");
  const [tipoId, setTipoId] = useState(inicial?.tipo ?? (datos.tipos.length === 1 ? datos.tipos[0].id : ""));
  const [tallasSel, setTallasSel] = useState<string[]>(inicial?.tallas ?? []);
  const [coloresSel, setColoresSel] = useState<string[]>(inicial?.colores ?? []);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [todas, setTodas] = useState("");
  const [bodegaId, setBodegaId] = useState(datos.puntos[0]?.id ?? "");
  const [costo, setCosto] = useState("");
  const [precio, setPrecio] = useState(inicial?.precio ?? "");
  const [minimo, setMinimo] = useState("");
  const [origen, setOrigen] = useState<"tenia" | "compra">(permisos.directo ? "tenia" : "compra");
  const [proveedorId, setProveedorId] = useState(datos.proveedores.length ? "" : NUEVO);
  const [proveedorNuevo, setProveedorNuevo] = useState("");
  const [pagada, setPagada] = useState(permisos.pagar);
  const [cuentaId, setCuentaId] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<EntradaHecha | null>(null);
  const [enviando, iniciar] = useTransition();
  const clave = useRef<string | null>(null);

  const producto = modo === "existente" ? datos.productos.find((p) => p.id === productoId) ?? null : null;
  const clase = producto?.clase ?? nuevaClase;
  const seVende = producto ? producto.se_vende : nuevaClase === "terminado";
  const disenoReal = clase === "terminado" && disenoId && disenoId !== NUEVO ? disenoId : null;
  const variantePor = useMemo(() => new Map(datos.variantes.filter((v) => v.producto_id === productoId)
    .map((v) => [llave(v.tipo_id, v.talla_id, v.color_id, v.diseno_id), v])), [datos.variantes, productoId]);
  const stock = useMemo(() => new Map(datos.existencias.filter((e) => e.bodega_id === bodegaId)
    .map((e) => [e.variante_id, e.cantidad])), [datos.existencias, bodegaId]);
  const varianteDe = (tallaId: string, colorId: string) =>
    producto && (clase !== "terminado" || disenoReal) ? variantePor.get(llave(tipoId, tallaId, colorId, disenoReal)) : undefined;

  const filas = tallas.filter((t) => tallasSel.includes(t.id));
  const columnas = colores.filter((c) => coloresSel.includes(c.id));
  const cant = (t: string, c: string) => cantidades[`${t}|${c}`] ?? "";
  const celdas = filas.flatMap((t) => columnas.map((c) => ({ talla_id: t.id, color_id: c.id, texto: cant(t.id, c.id) })))
    .filter((x) => x.texto.trim() !== "" && Number(x.texto) !== 0);
  const invalidas = celdas.some((x) => !Number.isInteger(Number(x.texto)) || Number(x.texto) < 0);
  const unidades = invalidas ? 0 : celdas.reduce((s, x) => s + Number(x.texto), 0);
  const nuevas = celdas.filter((x) => !varianteDe(x.talla_id, x.color_id)).length;
  const valor = Math.round(unidades * (Number(costo) || 0));
  const parecido = modo === "nuevo" && nuevoNombre.trim().length >= 2
    ? datos.productos.find((p) => normalizar(p.nombre) === normalizar(nuevoNombre) && p.clase === nuevaClase) : undefined;
  const cuentasPunto = datos.cuentas.filter((c) => c.tipo !== "efectivo" || c.bodega_id === bodegaId);

  const problemas: string[] = [];
  if (modo === "existente" && !producto) problemas.push("Elige la camiseta.");
  if (modo === "nuevo" && nuevoNombre.trim().length < 2) problemas.push("Escribe el nombre de la camiseta nueva.");
  if (clase === "terminado" && !disenoReal && !(disenoId === NUEVO && disenoNuevo.trim())) problemas.push("Elige el diseño o escribe el nombre del diseño nuevo.");
  if (!tipoId) problemas.push("Elige el tipo de camiseta.");
  if (!filas.length || !columnas.length) problemas.push("Marca al menos una talla y un color.");
  if (invalidas) problemas.push("Las cantidades son números enteros, sin decimales.");
  else if (!unidades) problemas.push("Escribe cuántas llegan de cada talla y color.");
  if (costo.trim() === "" || Number(costo) < 0) problemas.push("Escribe cuánto costó cada camiseta.");
  if (nuevas > 0 && !permisos.catalogo) problemas.push("Hay tallas o colores nuevos para esta camiseta y tu rol no puede crearlos.");
  if (nuevas > 0 && seVende && precio.trim() === "") problemas.push("Escribe el precio de venta de las tallas y colores nuevos.");
  if (origen === "compra" && !(proveedorId && proveedorId !== NUEVO) && !proveedorNuevo.trim()) problemas.push("Elige el proveedor o escribe su nombre.");
  if (origen === "compra" && pagada && !cuentaId) problemas.push("Elige de qué cuenta salió el pago.");

  function elegirProducto(id: string) {
    setProductoId(id);
    setCantidades({});
    setError("");
    clave.current = null;
    if (!id) return;
    const p = preseleccion(datos, id);
    setTipoId(p.tipo);
    setDisenoId(p.diseno);
    setDisenoNuevo("");
    setTallasSel(p.tallas);
    setColoresSel(p.colores);
    setPrecio(p.precio);
  }
  const alternar = (lista: string[], id: string) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  function ponerEnTodas() {
    const n = todas.trim();
    if (n === "") return;
    const siguiente: Record<string, string> = { ...cantidades };
    for (const t of filas) for (const c of columnas) siguiente[`${t.id}|${c.id}`] = n;
    setCantidades(siguiente);
  }

  function registrar() {
    if (problemas.length || enviando) return;
    if (!clave.current) clave.current = nuevaClave();
    const entrada = {
      producto_id: producto?.id ?? null,
      nuevo: modo === "nuevo" ? { nombre: nuevoNombre.trim(), clase: nuevaClase } : null,
      diseno_id: disenoReal,
      diseno_nuevo: clase === "terminado" && disenoId === NUEVO ? disenoNuevo.trim() : "",
      tipo_id: tipoId,
      celdas: celdas.map((x) => ({ talla_id: x.talla_id, color_id: x.color_id, cantidad: Number(x.texto) })),
      bodega_id: bodegaId,
      costo: Number(costo),
      precio: precio.trim() === "" ? null : Number(precio),
      minimo: Math.max(0, Math.trunc(Number(minimo) || 0)),
      origen,
      proveedor_id: origen === "compra" && proveedorId && proveedorId !== NUEVO ? proveedorId : null,
      proveedor_nuevo: origen === "compra" && (!proveedorId || proveedorId === NUEVO) ? proveedorNuevo.trim() : "",
      pagada: origen === "compra" && pagada,
      cuenta_id: origen === "compra" && pagada ? cuentaId || null : null,
      nota: nota.trim(),
      clave: clave.current,
    };
    setError("");
    iniciar(async () => {
      try {
        const r = await agregarInventario(entrada);
        if (r.hecho) {
          setHecho(r.hecho);
          window.scrollTo({ top: 0 });
          return;
        }
        setError(r.error ?? "No se pudo agregar el inventario.");
        // La camiseta nueva ya quedó creada: el reintento la usa en vez de crear otra
        if (r.productoId && modo === "nuevo") { setModo("existente"); setProductoId(r.productoId); }
      } catch {
        setError("No hubo conexión. Revisa el internet y vuelve a tocar «Agregar al inventario»: no se registrará dos veces.");
      }
    });
  }

  function otraVez(mismaCamiseta: boolean) {
    const id = hecho?.productoId ?? "";
    clave.current = null;
    setHecho(null); setError(""); setCantidades({}); setTodas(""); setNota(""); setCosto(""); setMinimo("");
    // Con la misma camiseta vuelven marcados su tipo, diseño, tallas y colores (ya con lo recién creado)
    if (mismaCamiseta) { setModo("existente"); elegirProducto(id); }
    else { setModo(datos.productos.length ? "existente" : "nuevo"); elegirProducto(""); setNuevoNombre(""); setTallasSel([]); setColoresSel([]); }
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------
  // Listo
  // ---------------------------------------------------------------
  if (hecho) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-4 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-turquesa/15 text-turquesa">
          <Check className="size-11" strokeWidth={3} aria-hidden />
        </span>
        <h2 className="font-titulo text-3xl font-semibold text-morado">¡Inventario agregado!</h2>
        <p className="text-lg">
          <strong className="cifra">{hecho.unidades}</strong> {hecho.unidades === 1 ? "camiseta" : "camisetas"} de «{hecho.producto}» en <strong>{hecho.punto}</strong>.
        </p>
        <div className="w-full text-left">
          {hecho.tipo === "ajuste" ? (
            hecho.pendiente
              ? <Aviso tipo="info">El ingreso {hecho.numero} quedó <strong>pendiente de aprobación</strong> del administrador porque supera el valor permitido. Cuando lo apruebe, las camisetas aparecen en el inventario.</Aviso>
              : <Aviso tipo="exito">Quedaron como inventario que ya tenías (ingreso {hecho.numero}), valorado en <span className="cifra">{pesos(hecho.valor)}</span>.</Aviso>
          ) : (
            <Aviso tipo={hecho.saldo > 0 ? "info" : "exito"}>
              Compra {hecho.numero} a {hecho.proveedor} por <span className="cifra">{pesos(hecho.valor)}</span>, recibida
              {hecho.saldo > 0 ? <>. Le debes <strong className="cifra">{pesos(hecho.saldo)}</strong>; regístralo cuando pagues desde la compra.</> : " y pagada."}
            </Aviso>
          )}
        </div>
        {hecho.nuevas > 0 && <p className="text-sm text-suave">Se crearon {hecho.nuevas} combinación(es) nuevas de talla y color.</p>}
        <div className="grid w-full gap-2 sm:grid-cols-2">
          <Boton type="button" onClick={() => otraVez(true)} className="min-h-12">
            <Plus className="size-5" aria-hidden /> Agregar más de esta camiseta
          </Boton>
          <Boton type="button" variante="secundario" onClick={() => otraVez(false)} className="min-h-12">Agregar otra camiseta</Boton>
          <Link href="/inventario" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-borde bg-white px-3 font-semibold text-morado hover:bg-morado-50">Ver el inventario</Link>
          <Link href={hecho.tipo === "compra" ? `/compras/${hecho.id}` : "/inventario/ajustes"}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-borde bg-white px-3 font-semibold text-morado hover:bg-morado-50">
            {hecho.tipo === "compra" ? `Ver la compra ${hecho.numero}` : `Ver el ingreso ${hecho.numero}`}
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Formulario
  // ---------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      <Paso numero={1} titulo="¿Qué camiseta?">
        {permisos.catalogo && datos.productos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Opcion activa={modo === "existente"} onClick={() => { setModo("existente"); clave.current = null; }}>Una que ya tengo</Opcion>
            <Opcion activa={modo === "nuevo"} onClick={() => { setModo("nuevo"); setProductoId(""); setCantidades({}); clave.current = null; }}>Una nueva</Opcion>
          </div>
        )}
        {modo === "existente" ? (
          datos.productos.length ? (
            <select value={productoId} onChange={(e) => elegirProducto(e.target.value)} aria-label="Camiseta" className={cn(campo, "sm:max-w-md")}>
              <option value="">Elige la camiseta…</option>
              {(["terminado", "base"] as const).map((k) => {
                const lista = datos.productos.filter((p) => p.clase === k);
                return lista.length ? (
                  <optgroup key={k} label={k === "terminado" ? "Estampadas (listas para vender)" : "Sin estampar (base)"}>
                    {lista.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.codigo})</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          ) : <p className="text-suave">Todavía no hay camisetas creadas.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:max-w-md">
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} maxLength={80} placeholder="Nombre, por ejemplo: Camiseta Navidad"
                   aria-label="Nombre de la camiseta nueva" className={campo} />
            <div className="grid grid-cols-2 gap-2">
              <Opcion activa={nuevaClase === "terminado"} onClick={() => setNuevaClase("terminado")}>Estampada</Opcion>
              <Opcion activa={nuevaClase === "base"} onClick={() => { setNuevaClase("base"); setDisenoId(""); }}>Sin estampar</Opcion>
            </div>
            <p className="text-xs text-suave">
              {nuevaClase === "terminado" ? "Lista para vender, con su diseño." : "Camiseta lisa para estampar después; no se vende sola."}
            </p>
            {parecido && (
              <Aviso tipo="info">
                Ya existe «{parecido.nombre}».{" "}
                <button type="button" onClick={() => { setModo("existente"); elegirProducto(parecido.id); }} className="font-semibold underline">
                  Usar esa camiseta
                </button>
              </Aviso>
            )}
          </div>
        )}

        {clase === "terminado" && (modo === "nuevo" || producto) && (
          <div className="flex flex-col gap-2 sm:max-w-md">
            <label className="flex flex-col gap-1 text-sm font-semibold">Diseño o estampado
              <select value={disenoId} onChange={(e) => { setDisenoId(e.target.value); setCantidades({}); clave.current = null; }} aria-label="Diseño" className={cn(campo, "font-normal")}>
                <option value="">Elige el diseño…</option>
                {datos.disenos.map((d) => <option key={d.id} value={d.id}>{d.nombre} ({d.codigo})</option>)}
                {permisos.catalogo && <option value={NUEVO}>Un diseño nuevo…</option>}
              </select>
            </label>
            {disenoId === NUEVO && (
              <input value={disenoNuevo} onChange={(e) => setDisenoNuevo(e.target.value)} maxLength={60} placeholder="Nombre del diseño, por ejemplo: Reno feliz"
                     aria-label="Nombre del diseño nuevo" className={campo} />
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Tipo de camiseta</p>
          <div className="flex flex-wrap gap-2">
            {tipos.map((t) => <Ficha key={t.id} activa={tipoId === t.id} onClick={() => { setTipoId(t.id); clave.current = null; }}>{t.nombre}</Ficha>)}
            {permisos.catalogo && <NuevaOpcion tabla="tipos_camiseta" texto="Otro tipo"
                                               alCrear={(o) => { setExtras((x) => ({ ...x, tipos: [...x.tipos, o] })); setTipoId(o.id); }} />}
          </div>
          {!tipos.length && <p className="text-sm text-suave">Agrega al menos un tipo, por ejemplo «Cuello redondo».</p>}
        </div>
      </Paso>

      <Paso numero={2} titulo="Tallas y colores">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Tallas</p>
          <div className="flex flex-wrap gap-2">
            {tallas.map((t) => (
              <Ficha key={t.id} activa={tallasSel.includes(t.id)} etiqueta={`Talla ${t.nombre}`}
                     onClick={() => setTallasSel((l) => alternar(l, t.id))}>{t.nombre}</Ficha>
            ))}
            {permisos.catalogo && <NuevaOpcion tabla="tallas" texto="Otra talla"
                                               alCrear={(o) => { setExtras((x) => ({ ...x, tallas: [...x.tallas, o] })); setTallasSel((l) => [...l, o.id]); }} />}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Colores</p>
          <div className="flex flex-wrap gap-2">
            {colores.map((c) => (
              <Ficha key={c.id} activa={coloresSel.includes(c.id)} etiqueta={`Color ${c.nombre}`}
                     onClick={() => setColoresSel((l) => alternar(l, c.id))}>
                <Muestra hex={c.hex ?? null} /> {c.nombre}
              </Ficha>
            ))}
            {permisos.catalogo && <NuevaOpcion tabla="colores" texto="Otro color" conColor
                                               alCrear={(o) => { setExtras((x) => ({ ...x, colores: [...x.colores, o] })); setColoresSel((l) => [...l, o.id]); }} />}
          </div>
        </div>
      </Paso>

      <Paso numero={3} titulo="¿Cuántas llegan de cada una?">
        {!filas.length || !columnas.length ? (
          <p className="text-suave">Marca arriba las tallas y los colores; aquí aparece una cuadrícula para escribir las cantidades.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-1 text-sm">
                <thead>
                  <tr>
                    <th className="px-2 text-left font-semibold text-suave">Talla</th>
                    {columnas.map((c) => (
                      <th key={c.id} className="min-w-20 px-1 text-center font-semibold">
                        <span className="inline-flex items-center gap-1"><Muestra hex={c.hex ?? null} />{c.nombre}</span>
                      </th>
                    ))}
                    <th className="px-2 text-right font-semibold text-suave">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((t) => {
                    const totalFila = columnas.reduce((s, c) => s + (Number(cant(t.id, c.id)) || 0), 0);
                    return (
                      <tr key={t.id}>
                        <th scope="row" className="px-2 text-left font-titulo text-lg">{t.nombre}</th>
                        {columnas.map((c) => {
                          const v = varianteDe(t.id, c.id);
                          const hay = v ? stock.get(v.id) ?? 0 : null;
                          return (
                            <td key={c.id} className="align-top">
                              <input type="number" inputMode="numeric" min={0} step={1} value={cant(t.id, c.id)} placeholder="0"
                                     aria-label={`Cantidad ${t.nombre} ${c.nombre}`}
                                     onChange={(e) => setCantidades((x) => ({ ...x, [`${t.id}|${c.id}`]: e.target.value }))}
                                     className="cifra min-h-11 w-20 rounded-xl border border-borde bg-white px-2 text-center text-lg outline-none focus:border-morado" />
                              <span className={cn("block text-center text-[11px]", hay === null ? "text-rosa" : "text-suave")}>
                                {hay === null ? "nueva" : `hay ${hay}`}
                              </span>
                            </td>
                          );
                        })}
                        <td className="cifra px-2 text-right font-semibold">{totalFila || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Poner</span>
              <input type="number" inputMode="numeric" min={0} step={1} value={todas} onChange={(e) => setTodas(e.target.value)}
                     aria-label="Cantidad para todas" className="cifra min-h-10 w-20 rounded-xl border border-borde px-2 text-center" />
              <button type="button" onClick={ponerEnTodas} className="min-h-10 rounded-xl border border-borde bg-white px-3 font-semibold text-morado hover:bg-morado-50">
                en todas las casillas
              </button>
            </div>
            <p className="text-xs text-suave">«hay» es lo que ya existe en el punto elegido; «nueva» es una talla y color que se crea al guardar.</p>
          </>
        )}
      </Paso>

      <Paso numero={4} titulo="Costo y de dónde vienen">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {datos.puntos.length > 1 && (
            <label className="flex flex-col gap-1 text-sm font-semibold">Llegan a
              <select value={bodegaId} onChange={(e) => { setBodegaId(e.target.value); setCuentaId(""); }} aria-label="Punto" className={cn(campo, "font-normal")}>
                {datos.puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-semibold">Costo por camiseta
            <input type="number" inputMode="numeric" min={0} step={100} value={costo} onChange={(e) => setCosto(e.target.value)}
                   placeholder="Lo que te costó cada una" aria-label="Costo por camiseta" className={cn(campo, "cifra font-normal")} />
            <span className="text-xs font-normal text-suave">Con este costo se calcula la utilidad de cada venta.</span>
          </label>
          {nuevas > 0 && seVende && (
            <label className="flex flex-col gap-1 text-sm font-semibold">Precio de venta
              <input type="number" inputMode="numeric" min={0} step={1000} value={precio} onChange={(e) => setPrecio(e.target.value)}
                     placeholder="Precio al público" aria-label="Precio de venta" className={cn(campo, "cifra font-normal")} />
              <span className="text-xs font-normal text-suave">Para las {nuevas} talla(s) y color(es) nuevas. Las que ya existen conservan su precio.</span>
            </label>
          )}
          {nuevas > 0 && (
            <label className="flex flex-col gap-1 text-sm font-semibold">Avisarme cuando queden menos de
              <input type="number" inputMode="numeric" min={0} step={1} value={minimo} onChange={(e) => setMinimo(e.target.value)}
                     placeholder="Opcional, por ejemplo 2" aria-label="Stock mínimo" className={cn(campo, "cifra font-normal")} />
            </label>
          )}
        </div>

        {permisos.directo && permisos.compra && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">¿De dónde vienen?</p>
            <div className="grid gap-2 sm:max-w-xl sm:grid-cols-2">
              <Opcion activa={origen === "tenia"} onClick={() => { setOrigen("tenia"); clave.current = null; }}>Ya las tenía</Opcion>
              <Opcion activa={origen === "compra"} onClick={() => { setOrigen("compra"); clave.current = null; }}>Las compré a un proveedor</Opcion>
            </div>
            <p className="text-xs text-suave">
              {origen === "tenia"
                ? "Inventario que ya estaba en el local (por ejemplo, al empezar a usar el sistema o tras un conteo). No mueve dinero."
                : "Queda la compra recibida a nombre del proveedor; si ya pagaste, sale el dinero de la cuenta que elijas."}
            </p>
          </div>
        )}

        {origen === "compra" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">Proveedor
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} aria-label="Proveedor" className={cn(campo, "font-normal")}>
                <option value="">Elige el proveedor…</option>
                {datos.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                {permisos.proveedores && <option value={NUEVO}>Un proveedor nuevo…</option>}
              </select>
            </label>
            {proveedorId === NUEVO && (
              <label className="flex flex-col gap-1 text-sm font-semibold">Nombre del proveedor
                <input value={proveedorNuevo} onChange={(e) => setProveedorNuevo(e.target.value)} maxLength={120}
                       aria-label="Nombre del proveedor nuevo" className={cn(campo, "font-normal")} />
              </label>
            )}
            <div className="flex flex-col gap-1 text-sm font-semibold">
              ¿Ya le pagaste?
              <div className="grid grid-cols-2 gap-2">
                <Opcion activa={pagada} onClick={() => setPagada(true)} deshabilitada={!permisos.pagar}>Sí, ya pagué</Opcion>
                <Opcion activa={!pagada} onClick={() => setPagada(false)}>No, le debo</Opcion>
              </div>
            </div>
            {pagada && (
              <label className="flex flex-col gap-1 text-sm font-semibold">Pagué desde
                <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} aria-label="Cuenta del pago" className={cn(campo, "font-normal")}>
                  <option value="">Elige la cuenta…</option>
                  {cuentasPunto.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm font-semibold sm:max-w-xl">Nota <span className="font-normal text-suave">(opcional)</span>
          <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Por ejemplo: conteo de noviembre"
                 aria-label="Nota" className={cn(campo, "font-normal")} />
        </label>
      </Paso>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-2xl border border-borde bg-white/95 p-3 shadow-xl backdrop-blur lg:bottom-4">
        {error && <Aviso>{error}</Aviso>}
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1">
            <span className="cifra font-titulo text-2xl font-bold text-morado">{unidades}</span> {unidades === 1 ? "camiseta" : "camisetas"}
            {unidades > 0 && costo !== "" && <span className="cifra text-suave"> · costo total {pesos(valor)}</span>}
          </p>
          <Boton type="button" onClick={registrar} cargando={enviando} disabled={problemas.length > 0} className="min-h-12 text-lg">
            <PackagePlus className="size-5" aria-hidden /> Agregar al inventario
          </Boton>
        </div>
        {problemas.length > 0 && <p className="text-sm font-semibold text-naranja" role="status">{problemas[0]}</p>}
      </div>
    </div>
  );
}

function Paso({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`paso-${numero}`} className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-4 sm:p-5">
      <h2 id={`paso-${numero}`} className="flex items-center gap-2 font-titulo text-xl font-semibold text-morado">
        <span className="flex size-8 items-center justify-center rounded-full bg-morado text-base text-white">{numero}</span> {titulo}
      </h2>
      {children}
    </section>
  );
}

function Opcion({ activa, onClick, children, deshabilitada }: { activa: boolean; onClick: () => void; children: React.ReactNode; deshabilitada?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa} disabled={deshabilitada}
            className={cn("min-h-11 rounded-xl border-2 px-3 font-bold transition-colors disabled:opacity-40",
                          activa ? "border-morado bg-morado text-white" : "border-borde bg-white text-morado hover:border-morado-100")}>
      {children}
    </button>
  );
}

function Ficha({ activa, onClick, children, etiqueta }: { activa: boolean; onClick: () => void; children: React.ReactNode; etiqueta?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activa} aria-label={etiqueta}
            className={cn("inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border-2 px-4 font-semibold transition-colors",
                          activa ? "border-morado bg-morado text-white" : "border-borde bg-white text-tinta hover:border-morado-100")}>
      {children}
    </button>
  );
}

function Muestra({ hex }: { hex: string | null }) {
  return (
    <span aria-hidden className="inline-block size-4 shrink-0 rounded-full border border-borde"
          style={{ background: hex ?? "repeating-linear-gradient(45deg,#eee,#eee 3px,#fff 3px,#fff 6px)" }} />
  );
}

// Agregar una talla, un color o un tipo sin salir de la pantalla
function NuevaOpcion({ tabla, texto, conColor, alCrear }: {
  tabla: "tallas" | "colores" | "tipos_camiseta"; texto: string; conColor?: boolean; alCrear: (o: Opcion) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [nombre, setNombre] = useState("");
  const [hex, setHex] = useState("#ffffff");
  const [error, setError] = useState("");
  const [enviando, iniciar] = useTransition();
  if (!abierta) {
    return (
      <button type="button" onClick={() => setAbierta(true)}
              className="inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-dashed border-borde px-4 font-semibold text-suave hover:border-morado hover:text-morado">
        <Plus className="size-4" aria-hidden /> {texto}
      </button>
    );
  }
  function guardar() {
    if (!nombre.trim()) return;
    setError("");
    iniciar(async () => {
      const r = await crearOpcion({ tabla, nombre: nombre.trim(), hex: conColor ? hex : null });
      if (r.opcion) { alCrear(r.opcion); setNombre(""); setAbierta(false); }
      else setError(r.error ?? "No se pudo agregar.");
    });
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-borde p-1.5">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} autoFocus
             onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } }}
             placeholder={tabla === "tallas" ? "Ej.: 3XL" : tabla === "colores" ? "Ej.: Verde menta" : "Ej.: Oversize"}
             aria-label={`Nombre: ${texto.toLowerCase()}`} className="min-h-10 w-36 rounded-xl border border-borde px-2" />
      {conColor && <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label="Color" className="size-10 rounded-lg border border-borde" />}
      <button type="button" onClick={guardar} disabled={enviando}
              className="min-h-10 rounded-xl bg-morado px-3 font-semibold text-white disabled:opacity-60">{enviando ? "…" : "Agregar"}</button>
      <button type="button" onClick={() => setAbierta(false)} className="min-h-10 rounded-xl px-2 text-suave">Cancelar</button>
      {error && <span className="basis-full text-sm text-error">{error}</span>}
    </span>
  );
}
