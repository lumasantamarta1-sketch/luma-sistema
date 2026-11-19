// Supabase mínimo para pruebas locales de punta a punta (solo en este equipo de trabajo):
// /rest/v1 → PostgREST real sobre la base local; /auth/v1 → un Auth simulado con JWT HS256.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const SECRETO = "secreto-local-de-pruebas-de-luma-0123456789";
const CLAVE = "clave-prueba-123";
const REST = "http://127.0.0.1:3001";
const db = new pg.Pool({ host: "/home/claude/pg", port: 54329, user: "postgres", database: "luma" });

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function firmar(claims) {
  const cabeza = b64({ alg: "HS256", typ: "JWT" });
  const cuerpo = b64(claims);
  const firma = crypto.createHmac("sha256", SECRETO).update(`${cabeza}.${cuerpo}`).digest("base64url");
  return `${cabeza}.${cuerpo}.${firma}`;
}
function verificar(token) {
  const [c, p, f] = (token ?? "").split(".");
  if (!f) return null;
  const esperada = crypto.createHmac("sha256", SECRETO).update(`${c}.${p}`).digest("base64url");
  if (esperada !== f) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const refrescos = new Map();
async function usuario(id) {
  const { rows } = await db.query("select id, email, raw_user_meta_data, created_at from auth.users where id = $1", [id]);
  const u = rows[0];
  return u && { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: { provider: "email" },
                user_metadata: u.raw_user_meta_data ?? {}, created_at: u.created_at, identities: [] };
}
async function sesion(id) {
  const u = await usuario(id);
  const ahora = Math.floor(Date.now() / 1000);
  const access_token = firmar({ sub: id, role: "authenticated", aud: "authenticated", email: u.email, iat: ahora,
                                exp: ahora + 3600, session_id: crypto.randomUUID(), aal: "aal1" });
  const refresh_token = crypto.randomUUID();
  refrescos.set(refresh_token, id);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: ahora + 3600, refresh_token, user: u };
}
const leer = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });
const json = (res, codigo, cuerpo) => { res.writeHead(codigo, { "content-type": "application/json" }); res.end(cuerpo === undefined ? "" : JSON.stringify(cuerpo)); };
const error = (res, codigo, msg) => json(res, codigo, { code: codigo, error_code: "invalid", msg, message: msg });

http.createServer(async (req, res) => {
  try {
    // CORS como el Supabase real: el navegador llama a /auth/v1 desde otra dirección (p. ej. /auth/sesion)
    res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
    res.setHeader("access-control-allow-headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-expose-headers", "content-range");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/rest/v1/")) {
      // El portero real de Supabase traduce la llave publicable; aquí: sin JWT válido → anónimo
      const cabeceras = { ...req.headers };
      delete cabeceras.host;
      const token = (cabeceras.authorization ?? "").replace(/^Bearer /i, "");
      if (!verificar(token)) delete cabeceras.authorization;
      const cuerpo = ["GET", "HEAD"].includes(req.method) ? undefined : await leer(req);
      const r = await fetch(REST + url.pathname.slice(8) + url.search, { method: req.method, headers: cabeceras, body: cuerpo });
      const texto = await r.text();
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json",
                                ...(r.headers.get("content-range") ? { "content-range": r.headers.get("content-range") } : {}) });
      return res.end(texto);
    }
    const ruta = url.pathname.replace(/^\/auth\/v1/, "");
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
    if (ruta === "/.well-known/jwks.json") return json(res, 200, { keys: [] });
    if (ruta === "/token" && url.searchParams.get("grant_type") === "password") {
      const { email, password } = JSON.parse(await leer(req));
      const { rows } = await db.query("select id, banned_until from auth.users where lower(email) = lower($1)", [email]);
      if (!rows[0] || password !== CLAVE && !(await db.query("select 1 from auth.pruebas_claves where id = $1 and clave = $2", [rows[0].id, password])).rowCount)
        return error(res, 400, "Invalid login credentials");
      if (rows[0].banned_until && new Date(rows[0].banned_until) > new Date()) return error(res, 400, "User is banned");
      return json(res, 200, await sesion(rows[0].id));
    }
    if (ruta === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const { refresh_token } = JSON.parse(await leer(req));
      const id = refrescos.get(refresh_token);
      return id ? json(res, 200, await sesion(id)) : error(res, 400, "Invalid Refresh Token");
    }
    if (ruta === "/user") {
      const claims = verificar(bearer);
      if (!claims) return error(res, 401, "invalid JWT");
      if (req.method === "PUT") {
        const cambios = JSON.parse(await leer(req));
        if (cambios.password) await db.query("insert into auth.pruebas_claves (id, clave) values ($1, $2) on conflict (id) do update set clave = excluded.clave", [claims.sub, cambios.password]);
      }
      return json(res, 200, await usuario(claims.sub));
    }
    if (ruta === "/logout") { res.writeHead(204); return res.end(); }
    if (ruta === "/recover") return json(res, 200, {});
    // Administración (llave secreta)
    if (ruta.startsWith("/admin/users")) {
      if (!(req.headers.apikey ?? "").startsWith("sb_secret_")) return error(res, 401, "This endpoint requires a valid secret key");
      const id = ruta.split("/")[3];
      const datos = JSON.parse((await leer(req)) || "{}");
      if (req.method === "POST") {
        const existe = await db.query("select 1 from auth.users where lower(email) = lower($1)", [datos.email]);
        if (existe.rowCount) return error(res, 422, "A user with this email address has already been registered");
        const { rows } = await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [datos.email, datos.user_metadata ?? {}]);
        if (datos.password) await db.query("insert into auth.pruebas_claves values ($1, $2)", [rows[0].id, datos.password]);
        return json(res, 200, await usuario(rows[0].id));
      }
      if (req.method === "PUT" && id) {
        if (datos.password) await db.query("insert into auth.pruebas_claves (id, clave) values ($1, $2) on conflict (id) do update set clave = excluded.clave", [id, datos.password]);
        if (datos.ban_duration) await db.query("update auth.users set banned_until = case when $2 = 'none' then null else now() + interval '100 years' end where id = $1", [id, datos.ban_duration]);
        return json(res, 200, await usuario(id));
      }
    }
    return error(res, 404, `Ruta simulada no disponible: ${req.method} ${url.pathname}`);
  } catch (e) {
    console.error(e);
    return error(res, 500, String(e));
  }
}).listen(54321, () => console.log("Supabase local en http://localhost:54321"));
