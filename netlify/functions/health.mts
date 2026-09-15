import type { Config, Context } from "@netlify/functions";
import postgres from "postgres";

export default async (_req: Request, _context: Context) => {
  const databaseUrl = Netlify.env.get("DATABASE_URL");
  if (!databaseUrl) {
    return Response.json({ ok: false, database: "not-configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 2 });
  try {
    const [row] = await sql<{ now: string }[]>`select now()::text as now`;
    return Response.json({ ok: true, database: "Neon", checkedAt: row?.now || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, database: "error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  } finally {
    await sql.end({ timeout: 1 });
  }
};

export const config: Config = { path: "/api/health" };
