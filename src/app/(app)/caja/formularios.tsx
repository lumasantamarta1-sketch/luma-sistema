"use client";

import { startTransition, useActionState, useState } from "react";
import { cambiarCuenta, cerrarCaja, crearCuenta, registrarMovimiento, type Estado } from "./acciones";
import { TIPOS_MOVIMIENTO } from "@/lib/caja";
import { nuevaClave } from "@/lib/ventas";
import { pesos } from "@/lib/utilidades";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";

type Cuenta = { id: string; nombre: string; tipo: string };

function Resultado({ estado }: { estado: Estado }) {
  if (estado.error) return <Aviso>{estado.error}</Aviso>;
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;
  return null;
}

// Se envía a mano para conservar lo escrito si hay un error; tras registrarlo, el formulario queda limpio
export function NuevoMovimiento({ cuentas }: { cuentas: Cuenta[] }) {
  const [estado, despachar, enviando] = useActionState<Estado, FormData>(registrarMovimiento, {});
  const [tipo, setTipo] = useState("traslado");
  const [cuenta, setCuenta] = useState(cuentas[0]?.id ?? "");
  const ayuda = TIPOS_MOVIMIENTO.find((t) => t.valor === tipo)?.ayuda;

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("clave", nuevaClave());
    startTransition(() => despachar(fd));
  }

  return (
    <form onSubmit={enviar} key={estado.exito} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-morado">Registrar movimiento</h2>
      <Selector etiqueta="Tipo" name="tipo" id="mov-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
        {TIPOS_MOVIMIENTO.map((t) => <option key={t.valor} value={t.valor}>{t.titulo}</option>)}
      </Selector>
      {ayuda && <p className="-mt-1 text-sm text-suave">{ayuda}</p>}
      <Selector etiqueta={tipo === "traslado" ? "Sale de" : "Cuenta"} name="cuenta_id" id="mov-cuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
        {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Selector>
      {tipo === "traslado" && (
        <Selector etiqueta="Entra a" name="cuenta_destino" id="mov-destino" defaultValue={cuentas.find((c) => c.id !== cuenta)?.id}>
          {cuentas.filter((c) => c.id !== cuenta).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </Selector>
      )}
      <Campo etiqueta="Valor ($)" name="valor" id="mov-valor" type="number" inputMode="numeric" min={1} step="any" required className="cifra" />
      <Campo etiqueta="Descripción" name="descripcion" id="mov-descripcion" required maxLength={300}
             placeholder={tipo === "traslado" ? "Ej.: consignación del efectivo del día" : "¿Por qué?"} />
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Registrar</Boton></div>
    </form>
  );
}

// Cierre del día de una caja de efectivo. Quien no ve saldos cuenta "a ciegas".
export function CierreCaja({ cuenta, esperado }: { cuenta: Cuenta; esperado: number | null }) {
  const [estado, despachar, enviando] = useActionState<Estado, FormData>(cerrarCaja, {});
  const [contado, setContado] = useState("");
  const diferencia = esperado !== null && contado !== "" ? Math.round((Number(contado) - esperado) * 100) / 100 : null;
  if (estado.exito) return <Aviso tipo="exito">{estado.exito}</Aviso>;

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(() => despachar(new FormData(e.currentTarget)));
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <input type="hidden" name="cuenta_id" value={cuenta.id} />
      {esperado !== null && <p className="text-sm">Según el sistema debe haber <b className="cifra">{pesos(esperado)}</b>.</p>}
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Efectivo contado en {cuenta.nombre}
        <input name="contado" type="number" inputMode="numeric" min={0} step="any" required value={contado}
               onChange={(e) => setContado(e.target.value)} aria-label={`Efectivo contado en ${cuenta.nombre}`}
               className="cifra min-h-11 rounded-xl border border-borde bg-white px-3 text-base font-normal" />
      </label>
      {diferencia !== null && diferencia !== 0 && (
        <p className="rounded-xl bg-naranja/10 p-3 text-sm font-semibold text-morado">
          {diferencia > 0 ? "Sobran" : "Faltan"} <span className="cifra">{pesos(Math.abs(diferencia))}</span>. Explica la diferencia: quedará registrada.
        </p>
      )}
      {(esperado === null || diferencia !== 0) && (
        <Campo etiqueta={esperado === null ? "Observación (si algo no cuadra)" : "Justificación de la diferencia"} name="justificacion"
               id={`justificacion-${cuenta.id}`} maxLength={300} required={diferencia !== null && diferencia !== 0} />
      )}
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Cerrar caja</Boton></div>
    </form>
  );
}

export function NuevaCuenta() {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(crearCuenta, {});
  return (
    <form action={accion} key={estado.exito} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-morado">Nueva cuenta</h2>
      <p className="text-sm text-suave">Solo el nombre: el sistema nunca guarda números de cuenta ni claves.</p>
      <Campo etiqueta="Nombre" name="nombre" id="cuenta-nombre" required maxLength={80} placeholder="Ej.: Daviplata" />
      <Selector etiqueta="Tipo" name="tipo" id="cuenta-tipo" defaultValue="banco">
        <option value="nequi">Nequi</option>
        <option value="banco">Banco</option>
        <option value="otro">Otra</option>
      </Selector>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="con_metodo" defaultChecked className="mt-0.5 size-5 accent-morado" />
        <span>Usarla también como método de pago en ventas y gastos</span>
      </label>
      <Resultado estado={estado} />
      <div><Boton type="submit" cargando={enviando}>Crear cuenta</Boton></div>
    </form>
  );
}

export function CambiarCuenta({ id, activo, tabla }: { id: string; activo: boolean; tabla: "cuenta" | "metodo" }) {
  const [estado, accion, enviando] = useActionState<Estado, FormData>(cambiarCuenta, {});
  return (
    <form action={accion} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tabla" value={tabla} />
      <input type="hidden" name="activo" value={activo ? "false" : "true"} />
      <Boton type="submit" variante={activo ? "fantasma" : "secundario"} cargando={enviando}>{activo ? "Desactivar" : "Activar"}</Boton>
      {estado.error && <p className="max-w-56 text-right text-sm text-error">{estado.error}</p>}
    </form>
  );
}
