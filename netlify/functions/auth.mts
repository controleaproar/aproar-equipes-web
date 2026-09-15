import type { Config, Context } from "@netlify/functions";
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ROLE_HASH_KEY: Record<string, string> = {
  suprimentos: "AUTH_HASH_CONTROLADORIA",
  financeiro: "AUTH_HASH_FINANCEIRO",
};

/*
 * Fallback seguro para o bootstrap da aplicação.
 * Não contém as senhas em texto puro.
 * Se as variáveis do Netlify existirem, elas continuam tendo prioridade.
 */
const FALLBACK_HASH: Record<string, string> = {
  suprimentos:
    "pbkdf2_sha256$210000$mdf6GsUxYV5P5pw_jxYRKQ$1-XrgMpue3ZTag2ZtmaLoCeekX5ubUTkQWnjT1MUsCM",
  financeiro:
    "pbkdf2_sha256$210000$NahvNXlTs8wC0Gr61CFr7Q$hmE3JpZ5QVWjBA5uGcc05VRfEb3_jDd_w_pPOu0ZHQ8",
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
  if (!expected.length) return false;

  const actual = pbkdf2Sync(password, salt, iterations, expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function makeSession(role: string) {
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const sessionSecret = Netlify.env.get("SESSION_SECRET");

  // Quando há segredo configurado, gera token assinado.
  if (sessionSecret) {
    const payload = b64url(JSON.stringify({ role, exp: expiresAt }));
    const signature = createHmac("sha256", sessionSecret)
      .update(payload)
      .digest("base64url");
    return { token: `${payload}.${signature}`, expiresAt };
  }

  /*
   * Enquanto o sistema ainda usa o token apenas para a navegação do frontend,
   * um token aleatório mantém a sessão funcionando mesmo se o Netlify não
   * disponibilizar SESSION_SECRET. Nenhuma senha fica exposta.
   */
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt,
  };
}

export default async (req: Request, _context: Context) => {
  const headers = { "Cache-Control": "no-store" };

  // Diagnóstico seguro: informa apenas se a função está operacional.
  if (req.method === "GET") {
    return Response.json(
      {
        ok: true,
        auth: "ready",
        roles: ["suprimentos", "financeiro"],
        supervisorProtected: false,
      },
      { headers },
    );
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Método não permitido." },
      { status: 405, headers },
    );
  }

  let body: { role?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Requisição inválida." },
      { status: 400, headers },
    );
  }

  const role = String(body.role || "").trim();
  const password = String(body.password || "");
  const hashKey = ROLE_HASH_KEY[role];

  if (!hashKey || !password) {
    return Response.json(
      { error: "Credenciais inválidas." },
      { status: 401, headers },
    );
  }

  // Variável do Netlify tem prioridade; fallback impede indisponibilidade.
  const encodedHash =
    Netlify.env.get(hashKey) ||
    FALLBACK_HASH[role];

  if (!encodedHash || !verifyPassword(password, encodedHash)) {
    return Response.json(
      { error: "Senha incorreta." },
      { status: 401, headers },
    );
  }

  const session = makeSession(role);
  return Response.json(
    { ok: true, role, ...session },
    { headers },
  );
};

export const config: Config = {
  path: "/api/auth",
};
