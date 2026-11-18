"use client";

import { useActionState } from "react";
import { crearPunto, guardarNegocio, type Estado } from "./acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";

type Negocio = {
  nombre_comercial: string; eslogan: string; permite_venta_bajo_pedido: boolean; anticipo_minimo_pct: number;
  umbral_aprobacion_ajuste: number; umbral_pocas_unidades: number; dias_sin_movimiento: number; minutos_inactividad: number;
};

export function FormularioNegocio({ negocio }: { negocio: Negocio }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(guardarNegocio, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-morado">Negocio</h2>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre comercial" name="nombre_comercial" defaultValue={negocio.nombre_comercial} required />
        <Campo etiqueta="Eslogan" name="eslogan" defaultValue={negocio.eslogan} />
      </div>
      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-borde px-3">
        <input type="checkbox" name="permite_venta_bajo_pedido" defaultChecked={negocio.permite_venta_bajo_pedido} className="size-5 accent-morado" />
        Permitir venta bajo pedido (confirmar aunque falten unidades)
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Anticipo mínimo de pedidos (%)" name="anticipo_minimo_pct" type="number" inputMode="decimal" min={0} max={100}
               defaultValue={negocio.anticipo_minimo_pct} ayuda="Para personalizados y bajo pedido. 0 = sin anticipo." />
        <Campo etiqueta="Ajustes que requieren aprobación desde ($)" name="umbral_aprobacion_ajuste" type="number" inputMode="numeric" min={0}
               defaultValue={negocio.umbral_aprobacion_ajuste} ayuda="Con 0, todo ajuste de otro usuario espera aprobación." />
        <Campo etiqueta="Alerta de pocas unidades" name="umbral_pocas_unidades" type="number" inputMode="numeric" min={0}
               defaultValue={negocio.umbral_pocas_unidades} />
        <Campo etiqueta="Días sin movimiento para alertar" name="dias_sin_movimiento" type="number" inputMode="numeric" min={1}
               defaultValue={negocio.dias_sin_movimiento} />
        <Campo etiqueta="Cerrar sesión tras minutos sin uso" name="minutos_inactividad" type="number" inputMode="numeric" min={1}
               defaultValue={negocio.minutos_inactividad} />
      </div>
      <div><Boton type="submit" cargando={enviando}>Guardar</Boton></div>
    </form>
  );
}

export function NuevoPunto() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearPunto, {});
  return (
    <form id="nuevo-punto" action={accion} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-morado">Nuevo punto</h2>
      {estado.error && <Aviso>{estado.error}</Aviso>}
      {estado.exito && <Aviso tipo="exito">{estado.exito}</Aviso>}
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <Campo etiqueta="Código" name="codigo" placeholder="CEN" maxLength={12} required />
        <Campo etiqueta="Nombre" name="nombre" placeholder="Tienda Centro" required />
      </div>
      <Selector etiqueta="Tipo" name="tipo" defaultValue="punto_venta">
        <option value="punto_venta">Punto de venta (tiene caja)</option>
        <option value="taller">Taller de estampado</option>
        <option value="bodega">Bodega</option>
      </Selector>
      <Campo etiqueta="Dirección" name="direccion" />
      <div><Boton type="submit" cargando={enviando}>Crear punto</Boton></div>
    </form>
  );
}
