import type { Metadata } from "next";
import Link from "next/link";
import { exigirSesion, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Plus } from "lucide-react";
import { Encabezado, Tarjeta } from "@/components/ui/tarjeta";
import { pesos } from "@/lib/utilidades";
import { hoyBogota } from "@/lib/ventas";

export const metadata: Metadata = { title: "Inicio" };

export default async function Inicio() {
  const sesion = await exigirSesion();
  const supabase = await crearClienteServidor();
  const hoy = hoyBogota();
  const { data } = await supabase.rpc("resumen_operacion", { p_desde: hoy, p_hasta: hoy });
  const ventas = (data?.ventas ?? null) as Record<string, number> | null;
  const inventario = (data?.inventario ?? null) as Record<string, number> | null;
  const sinPuntos = sesion.bodegas.length === 0;

  return (
    <>
      <Encabezado titulo={`Hola, ${sesion.nombre.split(" ")[0] || "bienvenido"}`}
                  descripcion={`${sesion.rolNombre ?? ""}${sesion.bodegas.length ? " · " + sesion.bodegas.map((b) => b.nombre).join(", ") : ""}`}
                  acciones={tiene(sesion, "ventas.crear") && sesion.bodegas.some((b) => b.tipo === "punto_venta") ? (
                    <Link href="/ventas/nueva" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-morado px-4 font-semibold text-white hover:bg-morado-700">
                      <Plus className="size-5" aria-hidden /> Nueva venta
                    </Link>
                  ) : undefined} />

      {sinPuntos && (
        <Tarjeta className="mb-5 border-amarillo bg-amarillo/10">
          <h2 className="text-lg font-semibold text-morado">Siguiente paso</h2>
          {tiene(sesion, "configuracion.gestionar") ? (
            <p className="mt-1">Crea tu primer punto de venta en{" "}
              <Link href="/configuracion" className="font-bold text-morado underline">Configuración</Link>.</p>
          ) : (
            <p className="mt-1">El administrador aún no te asigna un punto de venta.</p>
          )}
        </Tarjeta>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ventas && (
          <>
            <Cifra titulo="Ventas de hoy" valor={pesos(ventas.ventas_netas_entregadas)} etiqueta="Calculado"
                   detalle={`Recibido hoy: ${pesos(ventas.recibido)} · Dinero real`} />
            <Cifra titulo="Pedidos pendientes" valor={String(ventas.pedidos_pendientes ?? 0)} etiqueta="Conteo"
                   detalle={`Anticipos: ${pesos(ventas.anticipos_pedidos_pendientes)}`} />
            <Cifra titulo="Por estampar" valor={String(ventas.por_estampar ?? 0)} etiqueta="Conteo" />
          </>
        )}
        {inventario && (
          <>
            <Cifra titulo="Camisetas terminadas" valor={String(Number(inventario.unidades_terminadas ?? 0))} etiqueta="Conteo"
                   detalle={`Camisetas base: ${Number(inventario.unidades_base ?? 0)}`} />
            <Cifra titulo="Agotados" valor={String(inventario.agotados ?? 0)} etiqueta="Conteo" />
            <Cifra titulo="Stock bajo" valor={String(inventario.stock_bajo ?? 0)} etiqueta="Conteo" />
          </>
        )}
      </div>

      <p className="mt-6 text-sm text-suave">
        El panel completo, con gráficos y la pestaña de finanzas, llega en la fase 8.
      </p>
    </>
  );
}

function Cifra({ titulo, valor, etiqueta, detalle }: { titulo: string; valor: string; etiqueta: string; detalle?: string }) {
  return (
    <Tarjeta className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-suave">{titulo}</p>
      <p className="cifra font-titulo text-2xl font-semibold text-morado">{valor}</p>
      <p className="text-xs text-suave">{etiqueta}</p>
      {detalle && <p className="text-xs text-suave">{detalle}</p>}
    </Tarjeta>
  );
}
