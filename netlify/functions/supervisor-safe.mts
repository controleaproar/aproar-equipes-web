import type { Config, Context } from "@netlify/functions";
import postgres from "postgres";
import supervisorHandler from "./supervisor.mts";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function validateSameUnit(body: any) {
  if (String(body?.action || "") !== "add_direct") return null;

  const services = Array.isArray(body?.services)
    ? body.services.slice(0, 2).filter((item: any) => Number(item?.workId || 0) > 0)
    : [];

  if (services.length < 2) return null;

  const firstId = Number(services[0].workId);
  const secondId = Number(services[1].workId);
  if (firstId === secondId) {
    return "O 2º serviço deve ser diferente do 1º.";
  }

  const databaseUrl = Netlify.env.get("DATABASE_URL");
  if (!databaseUrl) {
    return "DATABASE_URL não configurada";
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 3,
  });

  try {
    const rows = await sql`
      SELECT id, unidade, nome
      FROM obras
      WHERE id = ANY(${[firstId, secondId]})
    `;

    if (rows.length !== 2) {
      return "Selecione dois serviços válidos.";
    }

    const byId = new Map(rows.map((row: any) => [Number(row.id), row]));
    const first = byId.get(firstId);
    const second = byId.get(secondId);
    const firstUnit = String(first?.unidade || "").trim().toUpperCase();
    const secondUnit = String(second?.unidade || "").trim().toUpperCase();

    if (!firstUnit || !secondUnit || firstUnit !== secondUnit) {
      return "O 2º serviço deve pertencer à mesma unidade do serviço principal.";
    }

    return null;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return supervisorHandler(req, context);
  }

  const bodyText = await req.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  const validationError = await validateSameUnit(body);
  if (validationError) {
    return json({ ok: false, error: validationError }, 400);
  }

  const forwarded = new Request(req.url.replace("/api/supervisor-safe", "/api/supervisor"), {
    method: req.method,
    headers: req.headers,
    body: bodyText,
  });

  return supervisorHandler(forwarded, context);
};

export const config: Config = {
  path: "/api/supervisor-safe",
};
