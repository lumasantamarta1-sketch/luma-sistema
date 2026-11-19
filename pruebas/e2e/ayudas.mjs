// Ayudas compartidas por las pruebas de punta a punta (puppeteer-core + Chrome del equipo)
import fs from "node:fs";
import puppeteer from "puppeteer-core";

export async function iniciar(carpeta) {
  const BASE = process.env.BASE ?? "http://localhost:3100";
  fs.mkdirSync(`/tmp/${carpeta}`, { recursive: true });
  const navegador = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
  const p = await navegador.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  const errores = [];
  p.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errores.push(`consola: ${m.text()}`); });
  let pasos = 0;

  const t = {
    p, errores,
    ok: (m) => console.log(`ok · ${m}`),
    foto: (n) => p.screenshot({ path: `/tmp/${carpeta}/${String(++pasos).padStart(2, "0")}-${n}.png`, fullPage: true }),
    texto: () => p.evaluate(() => document.body.innerText),
    async falla(m) {
      await t.foto("fallo");
      console.log(`FALLÓ: ${m}\n--- página (${p.url()}) ---\n${(await t.texto()).slice(0, 2500)}`);
      await navegador.close(); process.exit(1);
    },
    ir: async (ruta) => { await p.goto(BASE + ruta, { waitUntil: "networkidle0" }); },
    async esperarTexto(x, ms = 15000) {
      try { await p.waitForFunction((y) => document.body.innerText.includes(y), { timeout: ms }, x); }
      catch { await t.falla(`no apareció «${x}»`); }
    },
    async llenar(sel, valor) {
      const e = await p.$(sel); if (!e) await t.falla(`no existe ${sel}`);
      await e.click({ clickCount: 3 }); await p.keyboard.press("Backspace"); if (String(valor) !== "") await e.type(String(valor));
    },
    async elegir(sel, textoOpcion) {
      const valor = await p.$eval(sel, (s, x) => [...s.options].find((o) => o.textContent.includes(x))?.value, textoOpcion).catch(() => undefined);
      if (valor === undefined) await t.falla(`no hay opción «${textoOpcion}» en ${sel}`);
      await p.select(sel, valor);
    },
    async clic(x, dentro = "body") {
      const hecho = await p.evaluate((y, d) => {
        const todos = [...document.querySelector(d).querySelectorAll("button, summary")];
        const b = todos.find((e) => e.innerText.trim() === y || e.getAttribute("aria-label") === y) ?? todos.find((e) => e.innerText.includes(y));
        if (b && !b.disabled) { b.click(); return true; } return false;
      }, x, dentro);
      if (!hecho) await t.falla(`no encontré el botón «${x}» (o está deshabilitado)`);
    },
    async casilla(x, valor = true) {
      const hecho = await p.evaluate((y, v) => {
        const l = [...document.querySelectorAll("label")].find((e) => e.innerText.includes(y));
        const i = l?.querySelector("input[type=checkbox]"); if (i && i.checked !== v) i.click(); return Boolean(i);
      }, x, valor);
      if (!hecho) await t.falla(`no encontré la casilla «${x}»`);
    },
    async clicHacia(x, patron) {
      await t.clic(x);
      try { await p.waitForFunction((y) => new RegExp(y).test(location.pathname), { timeout: 20000 }, patron); }
      catch { await t.falla(`tras «${x}» no se llegó a ${patron}`); }
      await p.waitForNetworkIdle({ idleTime: 500 });
    },
    async ingresar(correo, clave) {
      await p.deleteCookie(...(await p.cookies()));
      await t.ir("/ingresar");
      await t.llenar("input[name=correo]", correo); await t.llenar("input[name=clave]", clave);
      await t.clicHacia("Ingresar", "^/(?!ingresar)");
    },
    async terminar() {
      console.log(errores.length ? `Errores del navegador (${errores.length}):\n${JSON.stringify(errores, null, 1)}` : "Sin errores en el navegador");
      await navegador.close();
    },
  };
  return t;
}
