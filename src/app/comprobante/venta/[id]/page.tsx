import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { detalleVariante } from "@/lib/catalogo";
import { numeroVenta, pagadoNeto, saldoVenta } from "@/lib/ventas";
import { fecha, pesos } from "@/lib/utilidades";
import { BotonImprimir } from "./imprimir";

export const metadata: Metadata = { title: "Comprobante" };

type Variante = {
  sku: string; productos: { nombre: string } | null; tallas: { nombre: string } | null; colores: { nombre: string } | null;
  tipos_camiseta: { nombre: string } | null; disenos: { nombre: string } | null;
};
type Venta = {
  id: string; numero: string | null; numero_cotizacion: string | null; estado: string; estado_entrega: string;
  subtotal: number; descuentos: number; total: number; observaciones: string | null; creado_en: string; confirmada_en: string | null;
  entregada_en: string | null; bodegas: { nombre: string; direccion: string | null } | null;
  clientes: { nombre: string; documento: string | null; telefono: string | null } | null; perfiles: { nombre: string } | null;
  venta_lineas: { id: string; cantidad: number; precio_unitario: number; descuento: number; personalizacion: string | null; variantes: Variante | null }[];
  pagos_venta: { id: string; tipo: string; fecha: string; valor: number; metodos_pago: { nombre: string } | null }[];
  devoluciones_venta: { valor_total: number }[];
};

// Comprobante interno para el cliente. No es una factura electrónica.
export default async function Comprobante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await exigirPermiso("ventas.ver", "ventas.ver_propias", "ventas.crear", "ventas.entregar");
  const supabase = await crearClienteServidor();
  const [{ data }, { data: negocio }] = await Promise.all([
    supabase.from("ventas")
      .select(`id, numero, numero_cotizacion, estado, estado_entrega, subtotal, descuentos, total, observaciones, creado_en, confirmada_en, entregada_en,
        bodegas(nombre, direccion), clientes(nombre, documento, telefono), perfiles(nombre),
        venta_lineas(id, cantidad, precio_unitario, descuento, personalizacion, variantes(sku, productos(nombre), tallas(nombre), colores(nombre), tipos_camiseta(nombre), disenos(nombre))),
        pagos_venta(id, tipo, fecha, valor, metodos_pago(nombre)), devoluciones_venta(valor_total)`)
      .eq("id", id).maybeSingle(),
    supabase.from("configuracion_negocio").select("nombre_comercial, eslogan").eq("id", 1).maybeSingle(),
  ]);
  if (!data) notFound();
  const v = data as unknown as Venta;
  const esCotizacion = v.estado === "cotizacion";
  const anulada = v.estado === "cancelada";
  const pagado = pagadoNeto(v.pagos_venta);
  const saldo = saldoVenta(v);
  const devuelto = v.devoluciones_venta.reduce((s, d) => s + Number(d.valor_total), 0);

  return (
    <main className="min-h-dvh bg-fondo px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-xl flex-wrap justify-between gap-2 print:hidden">
        <Link href={`/ventas/${id}`} className="inline-flex min-h-11 items-center rounded-xl border border-borde bg-white px-4 font-semibold text-morado">Volver a la venta</Link>
        <BotonImprimir />
      </div>

      <article className="mx-auto max-w-xl rounded-2xl border border-borde bg-white p-6 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-borde pb-4">
          <div>
            <Image src="/marca/logo-luma.png" alt={negocio?.nombre_comercial ?? "LUMA"} width={900} height={549} className="h-14 w-auto" priority />
            {negocio?.eslogan && <p className="mt-1 text-sm text-suave">{negocio.eslogan}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold text-morado">{esCotizacion ? "Cotización" : "Comprobante de venta"}</h1>
            <p className="cifra text-xl font-semibold">{numeroVenta(v)}</p>
            <p className="text-sm text-suave">{fecha(v.confirmada_en ?? v.creado_en)}</p>
          </div>
        </header>

        {anulada && <p className="mt-4 rounded-xl border-2 border-error p-2 text-center text-lg font-bold text-error">ANULADA</p>}

        <section className="grid gap-1 border-b border-borde py-4 text-sm sm:grid-cols-2">
          <p><span className="text-suave">Cliente: </span><b>{v.clientes?.nombre ?? "Cliente mostrador"}</b></p>
          {v.clientes?.documento && <p><span className="text-suave">Documento: </span>{v.clientes.documento}</p>}
          {v.clientes?.telefono && <p><span className="text-suave">Teléfono: </span>{v.clientes.telefono}</p>}
          <p><span className="text-suave">Punto de venta: </span>{v.bodegas?.nombre}</p>
          {v.bodegas?.direccion && <p><span className="text-suave">Dirección: </span>{v.bodegas.direccion}</p>}
          {v.perfiles?.nombre && <p><span className="text-suave">Atendió: </span>{v.perfiles.nombre}</p>}
          {v.entregada_en && <p><span className="text-suave">Entregada: </span>{fecha(v.entregada_en)}</p>}
        </section>

        <table className="w-full border-b border-borde text-sm">
          <thead>
            <tr className="text-left text-suave">
              <th className="py-2 font-semibold">Producto</th>
              <th className="py-2 text-right font-semibold">Cant.</th>
              <th className="py-2 text-right font-semibold">Precio</th>
              <th className="py-2 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {v.venta_lineas.map((l) => (
              <tr key={l.id} className="border-t border-borde align-top">
                <td className="py-2 pr-2">
                  {l.variantes?.productos?.nombre}
                  {l.variantes && <span className="block text-xs text-suave">{detalleVariante(l.variantes) || l.variantes.sku}</span>}
                  {l.personalizacion && <span className="block text-xs">«{l.personalizacion}»</span>}
                  {Number(l.descuento) > 0 && <span className="block text-xs text-suave">Descuento: {pesos(l.descuento)}</span>}
                </td>
                <td className="cifra py-2 text-right">{Number(l.cantidad)}</td>
                <td className="cifra py-2 text-right">{pesos(l.precio_unitario)}</td>
                <td className="cifra py-2 text-right">{pesos(Number(l.cantidad) * Number(l.precio_unitario) - Number(l.descuento))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto flex max-w-sm flex-col gap-1 py-4 text-sm">
          <div className="flex justify-between"><dt className="text-suave">Subtotal</dt><dd className="cifra whitespace-nowrap">{pesos(v.subtotal)}</dd></div>
          {Number(v.descuentos) > 0 && <div className="flex justify-between"><dt className="text-suave">Descuentos</dt><dd className="cifra whitespace-nowrap">− {pesos(v.descuentos)}</dd></div>}
          <div className="flex justify-between text-lg font-semibold text-morado"><dt>Total</dt><dd className="cifra whitespace-nowrap">{pesos(v.total)}</dd></div>
          {!esCotizacion && (
            <>
              {v.pagos_venta.map((p) => (
                <div key={p.id} className="flex justify-between gap-3">
                  <dt className="text-suave">{p.tipo === "reembolso" ? "Devolución de dinero" : "Pago"} {p.metodos_pago?.nombre} · {fecha(p.fecha)}</dt>
                  <dd className="cifra whitespace-nowrap">{p.tipo === "reembolso" ? "− " : ""}{pesos(p.valor)}</dd>
                </div>
              ))}
              {devuelto > 0 && <div className="flex justify-between"><dt className="text-suave">Productos devueltos</dt><dd className="cifra whitespace-nowrap">− {pesos(devuelto)}</dd></div>}
              <div className="flex justify-between border-t border-borde pt-1 font-semibold">
                <dt>{saldo > 0 ? "Saldo pendiente" : saldo < 0 ? "Saldo a favor" : "Pagado"}</dt>
                <dd className="cifra whitespace-nowrap">{pesos(saldo === 0 ? pagado : Math.abs(saldo))}</dd>
              </div>
            </>
          )}
        </dl>

        {v.observaciones && <p className="border-t border-borde py-3 text-sm"><span className="text-suave">Observaciones: </span>{v.observaciones}</p>}

        <footer className="border-t border-borde pt-3 text-xs text-suave">
          {esCotizacion
            ? <p>Cotización sin reserva de productos: los precios y la disponibilidad se confirman al registrar la venta.</p>
            : <p>Gracias por tu compra.</p>}
          <p className="mt-1 font-semibold">
            Documento interno de control. No es una factura electrónica de venta ni reemplaza la facturación electrónica ante la DIAN.
          </p>
        </footer>
      </article>
    </main>
  );
}
