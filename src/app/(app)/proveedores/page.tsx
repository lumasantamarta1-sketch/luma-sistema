import type { Metadata } from "next";
import Link from "next/link";
import { exigirPermiso, tiene } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { saldoCompra } from "@/lib/compras";
import { pesos } from "@/lib/utilidades";
import { Encabezado, Insignia, Tarjeta } from "@/components/ui/tarjeta";
import { EditarProveedor, NuevoProveedor, type Proveedor } from "./formularios";

export const metadata: Metadata = { title: "Proveedores" };

export default async function PaginaProveedores({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: texto } = await searchParams;
  const sesion = await exigirPermiso("proveedores.ver", "proveedores.gestionar", "compras.ver");
  const supabase = await crearClienteServidor();
  const gestiona = tiene(sesion, "proveedores.gestionar");
  const veCompras = tiene(sesion, "compras.ver");
  const q = (texto ?? "").replace(/[^\p{L}\p{N}\s.-]/gu, "").trim().slice(0, 60);

  let consulta = supabase.from("proveedores")
    .select("id, nombre, identificacion_tributaria, contacto, telefono, correo, direccion, observaciones, activo")
    .order("activo", { ascending: false }).order("nombre").limit(500);
  if (q) consulta = consulta.or(`nombre.ilike.%${q}%,identificacion_tributaria.ilike.%${q}%,contacto.ilike.%${q}%,telefono.ilike.%${q}%`);
  const [{ data }, { data: compras }] = await Promise.all([
    consulta,
    veCompras ? supabase.from("compras").select("proveedor_id, estado, total, pagos_compra(tipo, valor), devoluciones_proveedor(valor_total)")
      .in("estado", ["confirmada", "recibida_parcial", "recibida"]) : Promise.resolve({ data: [] }),
  ]);
  const proveedores = (data ?? []) as Proveedor[];
  // Lo que se debe a cada proveedor por mercancía ya recibida, y sus pedidos aún sin recibir
  const deuda = new Map<string, number>();
  const pedidos = new Map<string, number>();
  for (const c of (compras ?? []) as { proveedor_id: string; estado: string; total: number; pagos_compra: { tipo: string; valor: number }[]; devoluciones_proveedor: { valor_total: number }[] }[]) {
    if (c.estado === "confirmada") pedidos.set(c.proveedor_id, (pedidos.get(c.proveedor_id) ?? 0) + 1);
    else deuda.set(c.proveedor_id, (deuda.get(c.proveedor_id) ?? 0) + Math.max(saldoCompra(c), 0));
  }

  return (
    <>
      <Encabezado titulo="Proveedores" descripcion="A quién le compras camisetas, materiales y servicios." />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-3">
          <form className="flex gap-2">
            <input type="search" name="q" defaultValue={q} placeholder="Buscar por nombre, NIT, contacto o teléfono" aria-label="Buscar proveedor"
                   className="min-h-11 flex-1 rounded-xl border border-borde bg-white px-3" />
            <button type="submit" className="min-h-11 rounded-xl bg-morado px-4 font-semibold text-white">Buscar</button>
          </form>
          {proveedores.length === 0 && (
            <Tarjeta className="text-center text-suave">{q ? "No hay proveedores que coincidan." : "Aún no hay proveedores registrados."}</Tarjeta>
          )}
          {proveedores.map((p) => (
            <Tarjeta key={p.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 font-semibold">{p.nombre}</h2>
                {!p.activo && <Insignia>Inactivo</Insignia>}
                {veCompras && (deuda.get(p.id) ?? 0) > 0 && <Insignia tono="alerta">Por pagar {pesos(deuda.get(p.id))}</Insignia>}
                {veCompras && (pedidos.get(p.id) ?? 0) > 0 && <Insignia tono="marca">{pedidos.get(p.id)} pedido(s) por recibir</Insignia>}
              </div>
              <p className="mt-1 text-sm text-suave">
                {[p.identificacion_tributaria && `NIT/CC ${p.identificacion_tributaria}`, p.contacto, p.telefono, p.correo].filter(Boolean).join(" · ") || "Sin datos de contacto"}
              </p>
              {p.observaciones && <p className="mt-1 text-sm">{p.observaciones}</p>}
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {veCompras && <Link href={`/compras?proveedor=${p.id}`} className="font-semibold text-morado underline">Ver compras</Link>}
              </div>
              {gestiona && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-morado">Editar</summary>
                  <EditarProveedor proveedor={p} />
                </details>
              )}
            </Tarjeta>
          ))}
        </div>
        {gestiona && <Tarjeta className="h-fit"><NuevoProveedor /></Tarjeta>}
      </div>
    </>
  );
}
