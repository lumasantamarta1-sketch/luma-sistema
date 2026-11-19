"use client";

import { startTransition, useActionState, useState } from "react";
import {
  anularGasto, cambiarCategoria, cambiarRecurrente, crearCategoria, crearRecurrente, generarRecurrentes, pagarGasto,
  registrarGasto, type Estado,
} from "./acciones";
import { FRECUENCIAS } from "@/lib/gastos";
import { nuevaClave } from "@/lib/ventas";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";

type Opcion = { id: string; nombre: string };
type Metodo = { id: string; nombre: string; tipo: string };

function Resultado({ estado }: { estado: Estado }) {
  if (estado.error) return <Aviso>{estado.error}</Aviso>;
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return null;
}

export function NuevoGasto({ categorias, mercancia, puntos, proveedores, metodos, hoy, puedePagar }: {
  categorias: Opcion[]; mercancia: string[]; puntos: Opcion[]; proveedores: Opcion[]; metodos: Metodo[]; hoy: string; puedePagar: boolean;
}) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(registrarGasto, {});
  const [pagado, setPagado] = useState(true);
  const [metodo, setMetodo] = useState(metodos.find((m) => m.tipo === "efectivo")?.id ?? metodos[0]?.id ?? "");
  const [punto, setPunto] = useState(puntos.length === 1 ? puntos[0].id : "");
  const tipo = metodos.find((m) => m.id === metodo)?.tipo;
  const faltaPunto = pagado && tipo === "efectivo" && !punto;

  // Se envía a mano para que React no limpie lo escrito si el servidor responde con un error
  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("clave", nuevaClave());
    startTransition(() => accion(fd));
  }

  return (
    <form onSubmit={enviar} key={estado.exito} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={hoy} max={hoy} required />
        <Campo etiqueta="Valor ($)" name="valor" type="number" inputMode="numeric" min={1} step="any" required className="cifra" />
      </div>
      <Selector etiqueta="Categoría" name="categoria_id" defaultValue="" required>
        <option value="" disabled>Elige…</option>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Selector>
      {mercancia.length > 0 && (
        <p className="-mt-2 text-sm text-suave">La compra de mercancía ({mercancia.join(", ").toLowerCase()}) se registra en Compras, para que entre al inventario con su costo.</p>
      )}
      <Campo etiqueta="Descripción" name="descripcion" required maxLength={300} placeholder="Ej.: transporte de mercancía al centro comercial" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Selector etiqueta="Punto de venta" name="bodega_id" value={punto} onChange={(e) => setPunto(e.target.value)}>
          <option value="">General del negocio</option>
          {puntos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
        {proveedores.length > 0 ? (
          <Selector etiqueta="Proveedor (opcional)" name="proveedor_id" defaultValue="">
            <option value="">Ninguno</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>
        ) : (
          <Campo etiqueta="A quién se le pagó (opcional)" name="beneficiario" maxLength={160} />
        )}
      </div>
      {proveedores.length > 0 && <Campo etiqueta="A quién se le pagó, si no es proveedor (opcional)" name="beneficiario" maxLength={160} />}

      {puedePagar ? (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-borde p-3">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="pagado" checked={pagado} onChange={(e) => setPagado(e.target.checked)} className="mt-0.5 size-5 accent-morado" />
            <span><b>Ya se pagó.</b> El dinero sale ahora de la cuenta elegida. Si no, queda por pagar.</span>
          </label>
          {pagado && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Selector etiqueta="Pagado con" name="metodo_pago_id" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </Selector>
              <Campo etiqueta="Referencia (opcional)" name="referencia" maxLength={120} placeholder="Número de comprobante" />
            </div>
          )}
          {faltaPunto && <p className="text-sm font-semibold text-naranja">Para pagar en efectivo elige el punto de cuya caja sale el dinero.</p>}
        </fieldset>
      ) : (
        <p className="text-sm text-suave">Quedará por pagar; lo paga quien tenga ese permiso.</p>
      )}
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando} disabled={faltaPunto}>Registrar gasto</Boton></div>
    </form>
  );
}

export function PagarGasto({ gastoId, metodos, sinPunto }: { gastoId: string; metodos: Metodo[]; sinPunto: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(pagarGasto, {});
  const disponibles = sinPunto ? metodos.filter((m) => m.tipo !== "efectivo") : metodos;
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="gasto_id" value={gastoId} />
      <Selector etiqueta="Pagar con" name="metodo_pago_id" defaultValue={disponibles.find((m) => m.tipo === "efectivo")?.id ?? disponibles[0]?.id}>
        {disponibles.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
      </Selector>
      {sinPunto && <p className="text-sm text-suave">Es un gasto general: el efectivo solo se usa si el gasto es de un punto de venta.</p>}
      <Campo etiqueta="Referencia (opcional)" name="referencia" maxLength={120} placeholder="Número de comprobante" />
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Pagar</Boton></div>
    </form>
  );
}

export function AnularGasto({ gastoId, pagado }: { gastoId: string; pagado: boolean }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(anularGasto, {});
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="gasto_id" value={gastoId} />
      <p className="text-sm text-suave">{pagado ? "El dinero vuelve a la cuenta de la que salió, con un movimiento a la vista." : "El gasto queda anulado; no se borra."}</p>
      <Campo etiqueta="Motivo de la anulación" name="motivo" id="motivo-anulacion" required maxLength={300} />
      <Resultado estado={estado} />
      <div><Boton type="submit" variante="peligro" cargando={enviando}>Anular gasto</Boton></div>
    </form>
  );
}

export function GenerarRecurrentes() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(generarRecurrentes, {});
  return (
    <form action={accion} className="flex flex-col gap-2">
      <Boton type="submit" variante="secundario" cargando={enviando}>Crear gastos fijos de este periodo</Boton>
      <Resultado estado={estado} />
    </form>
  );
}

export function NuevaCategoria() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearCategoria, {});
  return (
    <form action={accion} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-morado">Nueva categoría</h2>
      <Campo etiqueta="Nombre" name="nombre" id="categoria-nombre" required maxLength={80} placeholder="Ej.: Publicidad" />
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Crear categoría</Boton></div>
    </form>
  );
}

export function CambiarActivo({ id, activo, tipo }: { id: string; activo: boolean; tipo: "categoria" | "recurrente" }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(tipo === "categoria" ? cambiarCategoria : cambiarRecurrente, {});
  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={activo ? "false" : "true"} />
      <Boton type="submit" variante={activo ? "fantasma" : "secundario"} cargando={enviando}>{activo ? "Desactivar" : "Activar"}</Boton>
      {estado.error && <p className="text-sm text-error">{estado.error}</p>}
    </form>
  );
}

export function CambiarValorRecurrente({ id, valor }: { id: string; valor: number }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(cambiarRecurrente, {});
  return (
    <form action={accion} className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Valor
        <input name="valor" type="number" inputMode="numeric" min={1} defaultValue={valor} aria-label="Valor del gasto fijo"
               className="cifra min-h-11 w-32 rounded-xl border border-borde bg-white px-3 text-base font-normal" />
      </label>
      <Boton type="submit" variante="fantasma" cargando={enviando}>Guardar</Boton>
      {estado.error && <p className="text-sm text-error">{estado.error}</p>}
    </form>
  );
}

export function NuevoRecurrente({ categorias, proveedores }: { categorias: Opcion[]; proveedores: Opcion[] }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearRecurrente, {});
  const [frecuencia, setFrecuencia] = useState("mensual");
  return (
    <form action={accion} key={estado.exito} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-morado">Nuevo gasto fijo</h2>
      <p className="text-sm text-suave">Arriendo, servicios, nómina… Cada periodo se crea como gasto por pagar con el botón «Crear gastos fijos».</p>
      <Campo etiqueta="Nombre" name="nombre" id="recurrente-nombre" required maxLength={120} placeholder="Ej.: Arriendo del local" />
      <Selector etiqueta="Categoría" name="categoria_id" id="recurrente-categoria" defaultValue="" required>
        <option value="" disabled>Elige…</option>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Selector>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Valor ($)" name="valor" id="recurrente-valor" type="number" inputMode="numeric" min={1} required className="cifra" />
        <Selector etiqueta="Frecuencia" name="frecuencia" id="recurrente-frecuencia" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)}>
          {Object.entries(FRECUENCIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selector>
      </div>
      {frecuencia === "mensual" && <Campo etiqueta="Día del mes en que se paga" name="dia" id="recurrente-dia" type="number" inputMode="numeric" min={1} max={31} placeholder="1" />}
      {proveedores.length > 0 && (
        <Selector etiqueta="Proveedor (opcional)" name="proveedor_id" id="recurrente-proveedor" defaultValue="">
          <option value="">Ninguno</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
      )}
      <Campo etiqueta="A quién se le paga (opcional)" name="beneficiario" id="recurrente-beneficiario" maxLength={160} />
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Crear gasto fijo</Boton></div>
    </form>
  );
}
