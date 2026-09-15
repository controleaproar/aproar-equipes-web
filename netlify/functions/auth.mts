import type { Config, Context } from "@netlify/functions";
import { createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const ROLE_HASH_KEY: Record<string, string> = {
  suprimentos: "AUTH_HASH_CONTROLADORIA",
  financeiro: "AUTH_HASH_FINANCEIRO",
  engenheiro: "AUTH_HASH_SUPERVISOR",
};

function b64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function verifyPassword(password: string, encoded: string) {
  const [scheme, iterationsRaw, saltRaw, digestRaw] = encoded.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsRaw || !saltRaw || !digestRaw) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;
  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(digestRaw, "base64url");
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signSession(role: string, secret: string) {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ role, exp: expiresAt }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405, headers: { "Cache-Control": "no-store" } });
  }

  let body: { role?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requisição inválida." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const role = String(body.role || "");
  const password = String(body.password || "");
  const hashKey = ROLE_HASH_KEY[role];
  if (!hashKey || !password) {
    return Response.json({ error: "Credenciais inválidas." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const encodedHash = Netlify.env.get(hashKey);
  const sessionSecret = Netlify.env.get("SESSION_SECRET");
  if (!encodedHash || !sessionSecret) {
    console.error("Variáveis de autenticação ausentes.");
    return Response.json({ error: "Autenticação indisponível." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  if (!verifyPassword(password, encodedHash)) {
    return Response.json({ error: "Senha incorreta." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const session = signSession(role, sessionSecret);
  return Response.json({ role, ...session }, { headers: { "Cache-Control": "no-store" } });
};

export const config: Config = { path: "/api/auth" };
