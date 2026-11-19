"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Boxes, ChartColumn, Ellipsis, Factory, History, House, LogOut, Paintbrush, Plus, Receipt, Settings, Shirt,
  ShoppingBag, Truck, UserCog, Users, Wallet, X, type LucideIcon,
} from "lucide-react";
import type { GrupoMenu } from "@/lib/menu";
import { salir } from "@/app/acciones-sesion";
import { cn } from "@/lib/utilidades";

const ICONOS: Record<string, LucideIcon> = {
  House, ShoppingBag, Paintbrush, Truck, Receipt, Wallet, Shirt, Boxes, Users, Factory, ChartColumn, UserCog, History, Settings,
};

type Props = {
  grupos: GrupoMenu[];
  nombre: string;
  rol: string;
  puedeVender: boolean;
  minutosInactividad: number;
  children: React.ReactNode;
};

function activo(ruta: string, actual: string) {
  return ruta === "/" ? actual === "/" : actual === ruta || actual.startsWith(`${ruta}/`);
}

export function Marco({ grupos, nombre, rol, puedeVender, minutosInactividad, children }: Props) {
  const actual = usePathname();
  // El menú «Más» queda abierto solo en la ruta donde se abrió: al navegar se cierra solo
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null);
  const masAbierto = abiertoEn === actual;
  const cerrarMas = () => setAbiertoEn(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cierre de sesión por inactividad (configurable en Configuración › Negocio)
  useEffect(() => {
    const limite = Math.max(minutosInactividad, 1) * 60_000;
    const reiniciar = () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => void salir("inactividad"), limite);
    };
    const eventos = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
    reiniciar();
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      eventos.forEach((e) => window.removeEventListener(e, reiniciar));
    };
  }, [minutosInactividad]);

  const enlaces = grupos.flatMap((g) => g.items);
  const tiene = (ruta: string) => enlaces.some((i) => i.ruta === ruta);

  const listaMenu = (
    <nav aria-label="Menú principal" className="flex flex-col gap-5">
      {grupos.map((g) => (
        <div key={g.titulo ?? "inicio"} className="flex flex-col gap-1">
          {g.titulo && <p className="px-3 text-xs font-bold uppercase tracking-wider text-white/60">{g.titulo}</p>}
          {g.items.map((i) => {
            const Icono = ICONOS[i.icono] ?? House;
            const esActivo = activo(i.ruta, actual);
            return (
              <Link key={i.ruta} href={i.ruta} aria-current={esActivo ? "page" : undefined}
                    className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold transition-colors",
                                  esActivo ? "bg-white text-morado" : "text-white/90 hover:bg-white/10")}>
                <Icono className="size-5 shrink-0" aria-hidden />
                {i.titulo}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const pieUsuario = (
    <div className="flex items-center gap-3 border-t border-white/15 pt-4">
      <Link href="/perfil" className="min-w-0 flex-1 rounded-xl px-2 py-1 hover:bg-white/10">
        <p className="truncate font-semibold text-white">{nombre}</p>
        <p className="truncate text-sm text-white/70">{rol}</p>
      </Link>
      <form action={() => salir()}>
        <button type="submit" className="flex size-11 items-center justify-center rounded-xl text-white/90 hover:bg-white/10"
                aria-label="Salir" title="Salir">
          <LogOut className="size-5" aria-hidden />
        </button>
      </form>
    </div>
  );

  const logo = (
    <Link href="/" className="block rounded-2xl bg-white px-4 py-3" aria-label="Inicio">
      <Image src="/marca/logo-luma.png" alt="LUMA · Ideas que cobran vida" width={900} height={549} priority className="h-auto w-full" />
    </Link>
  );

  return (
    <div className="min-h-dvh lg:pl-64 print:pl-0">
      {/* Computador: menú lateral fijo */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-6 overflow-y-auto bg-morado p-4 lg:flex print:hidden">
        {logo}
        <div className="flex-1">{listaMenu}</div>
        {pieUsuario}
      </aside>

      {/* Celular: barra superior */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-borde bg-white/95 px-4 py-2 backdrop-blur lg:hidden print:hidden">
        <Link href="/" aria-label="Inicio">
          <Image src="/marca/logo-luma.png" alt="LUMA" width={900} height={549} className="h-9 w-auto" />
        </Link>
        <span className="truncate pl-3 text-sm font-semibold text-suave">{nombre}</span>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8 print:max-w-none print:p-0">{children}</main>

      {/* Celular: barra inferior con lo más usado */}
      <nav aria-label="Accesos rápidos"
           className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-borde bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
        <AccesoInferior href="/" etiqueta="Inicio" Icono={House} activo={activo("/", actual)} />
        {tiene("/ventas") ? <AccesoInferior href="/ventas" etiqueta="Ventas" Icono={ShoppingBag} activo={activo("/ventas", actual)} /> : <span />}
        {puedeVender ? (
          <Link href="/ventas/nueva" className="-mt-5 flex flex-col items-center justify-center gap-1" aria-label="Nueva venta">
            <span className="flex size-14 items-center justify-center rounded-full bg-morado text-white shadow-lg">
              <Plus className="size-7" aria-hidden />
            </span>
            <span className="text-xs font-bold text-morado">Venta</span>
          </Link>
        ) : <span />}
        {tiene("/inventario") ? <AccesoInferior href="/inventario" etiqueta="Inventario" Icono={Boxes} activo={activo("/inventario", actual)} /> : <span />}
        <button type="button" onClick={() => setAbiertoEn(actual)} className="flex min-h-14 flex-col items-center justify-center gap-1 text-suave">
          <Ellipsis className="size-6" aria-hidden />
          <span className="text-xs font-bold">Más</span>
        </button>
      </nav>

      {/* Celular: «Más» abre el menú completo */}
      {masAbierto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" className="absolute inset-0 bg-tinta/40" aria-label="Cerrar menú" onClick={cerrarMas} />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col gap-6 overflow-y-auto bg-morado p-4">
            <div className="flex justify-end">
              <button type="button" onClick={cerrarMas} aria-label="Cerrar"
                      className="flex size-11 items-center justify-center rounded-xl text-white hover:bg-white/10">
                <X className="size-6" aria-hidden />
              </button>
            </div>
            <div className="flex-1">{listaMenu}</div>
            {pieUsuario}
          </div>
        </div>
      )}
    </div>
  );
}

function AccesoInferior({ href, etiqueta, Icono, activo }: { href: string; etiqueta: string; Icono: LucideIcon; activo: boolean }) {
  return (
    <Link href={href} aria-current={activo ? "page" : undefined}
          className={cn("flex min-h-14 flex-col items-center justify-center gap-1", activo ? "text-morado" : "text-suave")}>
      <Icono className="size-6" aria-hidden />
      <span className="text-xs font-bold">{etiqueta}</span>
    </Link>
  );
}
