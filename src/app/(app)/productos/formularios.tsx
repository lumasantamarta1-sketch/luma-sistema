"use client";

import { useActionState, useState } from "react";
import { actualizarProducto, actualizarVariante, crearProducto, generarVariantes, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

type Opcion = { id: string; nombre: string };
type Producto = {
  id?: string; codigo: string; nombre: string; clase: string; categoria_id: string | null; unidad_medida: string;
  se_vende: boolean; por_pedido: boolean; descripcion: string | null; activo: boolean;
};

export function FormularioProducto({ producto, categorias }: { producto?: Producto; categorias: Opcion[] }) {
  const nuevo = !producto?.id;
  const [estado, accion, enviando] = useActionState<Estado, FormData>(nuevo ? crearProducto : actualizarProducto, {});
  const [clase, setClase] = useState(producto?.clase ?? "terminado");
  return (
    <form action={accion} className="flex flex-col gap-4">
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      {producto?.id && <><input type="hidden" name="id" value={producto.id} /><input type="hidden" name="con_estado" value="1" /></>}
      {nuevo ? (
        <Selector etiqueta="Clase" name="clase" value={clase} onChange={(e) => setClase(e.target.value)}>
          <option value="terminado">Camiseta terminada (se vende)</option>
          <option value="base">Camiseta base (lisa, para estampar)</option>
          <option value="material">Material de estampado</option>
        </Selector>
      ) : (
        <input type="hidden" name="clase" value={clase} />
      )}
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Campo etiqueta="Código" name="codigo" defaultValue={producto?.codigo} maxLength={20} required
               ayuda={clase === "material" ? "Es también su SKU." : undefined} />
        <Campo etiqueta="Nombre" name="nombre" defaultValue={producto?.nombre} required />
      </div>
      <Selector etiqueta="Categoría" name="categoria_id" defaultValue={producto?.categoria_id ?? ""}>
        <option value="">Sin categoría</option>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Selector>
      {clase === "material" && (
        <Selector etiqueta="Unidad de medida" name="unidad_medida" defaultValue={producto?.unidad_medida ?? "unidad"} disabled={!nuevo}>
          <option value="unidad">Unidad</option><option value="hoja">Hoja</option><option value="metro">Metro</option>
          <option value="gramo">Gramo</option><option value="mililitro">Mililitro</option>
        </Selector>
      )}
      {!nuevo && clase === "material" && <input type="hidden" name="unidad_medida" value={producto?.unidad_medida} />}
      {clase === "base" && (
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="se_vende" defaultChecked={producto?.se_vende}
               className="size-5 accent-morado" />También se vende lisa</label>
      )}
      {clase === "terminado" && (
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="por_pedido" defaultChecked={producto?.por_pedido}
               className="size-5 accent-morado" />Personalizada: se vende sin existencias y se estampa por pedido</label>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Descripción
        <textarea name="descripcion" defaultValue={producto?.descripcion ?? ""} rows={3}
                  className="rounded-xl border border-borde bg-white px-3 py-2 text-base font-normal" />
      </label>
      {!nuevo && (
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="activo" defaultChecked={producto?.activo}
               className="size-5 accent-morado" />Producto activo</label>
      )}
      <div><Boton type="submit" cargando={enviando}>{nuevo ? "Crear producto" : "Guardar"}</Boton></div>
    </form>
  );
}

type Catalogos = { tipos: Opcion[]; tallas: Opcion[]; colores: Opcion[]; disenos: Opcion[] };

function Casillas({ titulo, nombre, opciones }: { titulo: string; nombre: string; opciones: Opcion[] }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{titulo}</legend>
      {opciones.length === 0 && <p className="text-sm text-suave">Créalos primero en Catálogos.</p>}
      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-borde px-3 has-[:checked]:border-morado has-[:checked]:bg-morado-50">
            <input type="checkbox" name={nombre} value={o.id} className="size-4 accent-morado" />{o.nombre}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function GeneradorVariantes({ productoId, clase, seVende, porPedido, catalogos }: {
  productoId: string; clase: string; seVende: boolean; porPedido: boolean; catalogos: Catalogos;
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(generarVariantes, {});
  return (
    <form id="generar-variantes" action={accion} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-morado">Generar variantes</h2>
      <p className="text-sm text-suave">Elige las combinaciones: el sistema crea cada una con su SKU y omite las que ya existen.</p>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <input type="hidden" name="producto_id" value={productoId} />
      {clase === "terminado" && !porPedido && (
        <Selector etiqueta="Diseño" name="diseno_id" defaultValue="">
          <option value="">Elige el diseño…</option>
          {catalogos.disenos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </Selector>
      )}
      <Casillas titulo="Tipos de camiseta" nombre="tipos" opciones={catalogos.tipos} />
      <Casillas titulo="Tallas" nombre="tallas" opciones={catalogos.tallas} />
      <Casillas titulo="Colores" nombre="colores" opciones={catalogos.colores} />
      <div className="grid gap-4 sm:grid-cols-2">
        {seVende && <Campo etiqueta="Precio de venta" name="precio_venta" type="number" inputMode="numeric" min={0} required />}
        <Campo etiqueta="Stock mínimo" name="stock_minimo" type="number" inputMode="numeric" min={0} defaultValue={0} />
      </div>
      <div><Boton type="submit" cargando={enviando}>Generar</Boton></div>
    </form>
  );
}

export function FilaVariante({ variante, puedePrecio, puedeCatalogo }: {
  variante: { id: string; precio_venta: number | null; stock_minimo: number; activo: boolean };
  puedePrecio: boolean; puedeCatalogo: boolean;
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(actualizarVariante, {});
  if (!puedePrecio && !puedeCatalogo) return null;
  return (
    <form action={accion} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={variante.id} />
      {puedePrecio && (
        <label className="flex flex-col gap-1 text-xs font-semibold">Precio
          <input name="precio_venta" type="number" inputMode="numeric" min={0} defaultValue={variante.precio_venta ?? ""}
                 className="cifra min-h-11 w-28 rounded-xl border border-borde px-2 text-base font-normal" />
        </label>
      )}
      {puedeCatalogo && (
        <>
          <label className="flex flex-col gap-1 text-xs font-semibold">Mínimo
            <input name="stock_minimo" type="number" inputMode="numeric" min={0} defaultValue={variante.stock_minimo}
                   className="cifra min-h-11 w-20 rounded-xl border border-borde px-2 text-base font-normal" />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="activo" defaultChecked={variante.activo}
                 className="size-4 accent-morado" />Activa</label>
        </>
      )}
      <Boton type="submit" variante="secundario" cargando={enviando}>Guardar</Boton>
      {estado.error && <span className="w-full text-sm text-error">{estado.error}</span>}
      {estado.exito && <span className="w-full text-sm text-morado">{estado.exito}</span>}
    </form>
  );
}
