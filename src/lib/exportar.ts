import "server-only";
import { strToU8, zipSync } from "fflate";

// Archivos descargables: CSV para Excel en español y libros de Excel (.xlsx) de una o varias hojas.

export type Celda = string | number | boolean | null | undefined;
export type Hoja = { nombre: string; filas: Celda[][] };
export type Formato = "csv" | "xlsx";

export const formatoPedido = (valor: string | null): Formato => (valor === "xlsx" ? "xlsx" : "csv");

// CSV: separador «;», coma decimal y BOM para las tildes.
// Un texto que empiece por = + - @ se marca como texto para que Excel no lo ejecute como fórmula.
export function csv(filas: Celda[][]) {
  const celda = (v: Celda) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "Sí" : "No";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100).replace(".", ",");
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n");
}

// ---------------------------------------------------------------------
// Excel (.xlsx): textos en línea (nunca fórmulas), números como números, encabezado en negrilla y fijo
// ---------------------------------------------------------------------
const xml = (t: string) => t
  // Caracteres de control que XML no admite
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columna(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function nombresDeHoja(hojas: Hoja[]) {
  const usados = new Set<string>();
  return hojas.map((h, i) => {
    const base = (h.nombre.replace(/[[\]:*?/\\]/g, " ").trim() || `Hoja ${i + 1}`).slice(0, 31);
    let nombre = base;
    for (let k = 2; usados.has(nombre.toLowerCase()); k++) nombre = `${base.slice(0, 27)} (${k})`;
    usados.add(nombre.toLowerCase());
    return nombre;
  });
}

function hojaXml(filas: Celda[][]) {
  const anchos: number[] = [];
  const cuerpo = filas.map((fila, r) => {
    const celdas = fila.map((v, c) => {
      const ref = `${columna(c)}${r + 1}`;
      if (v === null || v === undefined || v === "") return "";
      const texto = typeof v === "boolean" ? (v ? "Sí" : "No") : String(v);
      anchos[c] = Math.max(anchos[c] ?? 0, Math.min(texto.length, 60));
      if (typeof v === "number" && Number.isFinite(v)) {
        const estilo = r === 0 ? 1 : Number.isInteger(v) ? 2 : 3;
        return `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(texto)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join("");
  const cols = anchos.length
    ? `<cols>${anchos.map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, (a ?? 8) + 2)}" customWidth="1"/>`).join("")}</cols>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${filas.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews>${cols}<sheetData>${cuerpo}</sheetData></worksheet>`;
}

export function xlsx(hojas: Hoja[]): Uint8Array {
  const lista = hojas.length ? hojas : [{ nombre: "Hoja 1", filas: [] }];
  const nombres = nombresDeHoja(lista);
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${lista.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${lista.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${lista.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  lista.forEach((h, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(hojaXml(h.filas)); });
  return zipSync(archivos, { level: 6 });
}

// Respuesta de descarga. En CSV va la primera hoja; en Excel, todas.
export function descarga(nombre: string, hojas: Hoja[], formato: Formato) {
  const limpio = nombre.replace(/[^\w.-]+/g, "-");
  if (formato === "xlsx") {
    return new Response(new Blob([xlsx(hojas) as BlobPart]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${limpio}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(csv(hojas[0]?.filas ?? []), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${limpio}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// Supabase entrega como máximo 1.000 filas por consulta: se piden por páginas hasta traerlas todas.
// La consulta debe tener un orden estable.
export async function todasLasFilas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maximo = 100000,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; desde < maximo; desde += 1000) {
    const { data, error } = await pagina(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

// Fecha y hora de Colombia en texto ordenable: 2026-11-19 14:05
export function fechaHora(t: string | null | undefined) {
  if (!t) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(t));
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour") === "24" ? "00" : v("hour")}:${v("minute")}`;
}

export function dia(t: string | null | undefined) {
  return t ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(t)) : "";
}
