import type { Config, Context } from "@netlify/functions";
import postgres from "postgres";

const ENGENHEIROS = [
  "EDUARDO", "GABRIEL", "GUSTAVO", "JOEL",
  "NETO", "PAULO", "SOARES", "VICTOR",
];

const UNIDADES_APROAR = [
  "BARRA DO CEARÁ",
  "MARACANAÚ",
  "COLISEU",
  "HORIZONTE",
  "ESCRITÓRIO",
  "CENTRO",
  "MUSEU",
  "FIEC",
  "UNIFOR",
  "SEBRAE",
];

const STATUS_PRESENCA = [
  "Presente (Integral)",
  "Presente (Só Manhã)",
  "Presente (Só Tarde)",
  "Saída Antecipada",
  "Falta",
  "Atestado",
];

const PERIODOS = ["Integral", "Manhã", "Tarde", "Noite", "Outro"];
const TURNOS = ["Integral", "Manhã", "Tarde", "Noite"];
const OBS_META_MARKER = " ||APROAR_META|| ";
const VALOR_DIARIA_PROFISSIONAL = 241.74;
const VALOR_DIARIA_AJUDANTE = 182.34;

type Sql = ReturnType<typeof postgres>;

type ServiceRef = {
  id?: number | null;
  workId: number;
  name: string;
  unit: string;
  period: string;
  principal: boolean;
};

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function cleanName(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function cleanRole(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || normalizeText(raw) === "NAN") return "INDEFINIDA";
  return raw
    .replace(/^\d+\s*-\s*/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function datePartsFortaleza(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
  };
}

function todayFortaleza() {
  const p = datePartsFortaleza();
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function normalizeTurn(value: unknown) {
  const raw = normalizeText(value || "Integral");
  if (raw === "MANHA") return "Manhã";
  if (raw === "TARDE") return "Tarde";
  if (raw === "NOITE") return "Noite";
  return "Integral";
}

function turnsOverlap(a: unknown, b: unknown) {
  const ta = normalizeTurn(a);
  const tb = normalizeTurn(b);
  if (ta === "Integral" || tb === "Integral") return true;
  return ta === tb;
}

function isPresence(status: unknown) {
  return [
    "Presente (Integral)",
    "Presente (Só Manhã)",
    "Presente (Só Tarde)",
    "Saída Antecipada",
    "Presente",
    "Extra",
  ].includes(String(status || ""));
}

function defaultStatusForTurn(turn: unknown) {
  const t = normalizeTurn(turn);
  if (t === "Manhã") return "Presente (Só Manhã)";
  if (t === "Tarde") return "Presente (Só Tarde)";
  return "Presente (Integral)";
}

function parseObservation(value: unknown) {
  const text = String(value || "");
  const idx = text.indexOf(OBS_META_MARKER);
  const visible = idx >= 0 ? text.slice(0, idx) : text;
  const metaText = idx >= 0 ? text.slice(idx + OBS_META_MARKER.length) : "";

  let turno = "Integral";
  let livre = "";
  for (const part of visible.split("|").map((x) => x.trim())) {
    if (part.toLowerCase().startsWith("turno:")) {
      turno = normalizeTurn(part.split(":").slice(1).join(":"));
    }
    if (part.toLowerCase().startsWith("obs:")) {
      livre = part.split(":").slice(1).join(":").trim();
    }
  }

  let meta: Record<string, any> = {};
  if (metaText) {
    try { meta = JSON.parse(metaText); } catch { meta = {}; }
  }
  return { turno, livre, meta };
}

function buildObservation(turn: unknown, freeText: unknown, meta: Record<string, any> = {}) {
  const parts = [`Turno: ${normalizeTurn(turn)}`];
  if (String(freeText || "").trim()) parts.push(`Obs: ${String(freeText).trim()}`);

  const clean = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => {
      if (value === null || value === undefined || value === "") return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
      return true;
    }),
  );

  return Object.keys(clean).length
    ? `${parts.join(" | ")}${OBS_META_MARKER}${JSON.stringify(clean)}`
    : parts.join(" | ");
}

function isPlaceholder(name: unknown) {
  return normalizeText(name).startsWith("A DEFINIR NO APONTAMENTO");
}

async function getSql() {
  const databaseUrl = Netlify.env.get("DATABASE_URL");
  if (!databaseUrl) throw new Error("DATABASE_URL não configurada");
  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 8,
    idle_timeout: 3,
  });
}

async function audit(
  sql: Sql,
  entidade: string,
  entidadeId: string | number | null,
  acao: string,
  usuario: string,
  antes: unknown = null,
  depois: unknown = null,
  contexto: unknown = {},
) {
  try {
    await sql`
      INSERT INTO auditoria
        (entidade, entidade_id, acao, usuario, antes, depois, contexto)
      VALUES (
        ${entidade}, ${String(entidadeId || "")}, ${acao}, ${usuario},
        ${antes ? sql.json(antes as object) : null},
        ${depois ? sql.json(depois as object) : null},
        ${sql.json((contexto || {}) as object)}
      )
    `;
  } catch {
    // A auditoria não pode derrubar a operação principal.
  }
}

async function recordError(sql: Sql | null, error: unknown, action: string, context: unknown = {}) {
  if (!sql) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const code = `AP-${Date.now().toString(36).toUpperCase()}`;
    await sql`
      INSERT INTO erros_sistema
        (codigo, modulo, acao, tipo_erro, mensagem, detalhes, contexto, ambiente)
      VALUES (
        ${code}, 'portal_supervisor_next', ${action}, ${err.name},
        ${err.message.slice(0, 2000)}, ${(err.stack || "").slice(0, 10000)},
        ${sql.json((context || {}) as object)}, 'netlify'
      )
    `;
  } catch {
    // Registro de erro também não pode mascarar o erro original.
  }
}

async function ensurePlaceholder(sql: Sql, unit: string) {
  const normalized = String(unit || "").trim().toUpperCase();
  const name = `A DEFINIR NO APONTAMENTO - ${normalized}`;
  const rows = await sql`
    INSERT INTO obras (unidade, nome)
    VALUES (${normalized}, ${name})
    ON CONFLICT (nome) DO UPDATE SET unidade = EXCLUDED.unidade
    RETURNING id, unidade, nome
  `;
  return rows[0];
}

async function getBaseLists(sql: Sql) {
  const collaborators = await sql`
    SELECT id, nome, funcao, valor_diaria
    FROM colaboradores
    WHERE ativo = TRUE
    ORDER BY nome
  `;
  const works = await sql`
    SELECT id, unidade, nome
    FROM obras
    ORDER BY unidade, nome
  `;
  return { collaborators, works };
}

async function getServicesForConvocations(sql: Sql, ids: number[]) {
  if (!ids.length) return [] as any[];
  return sql`
    SELECT
      s.id, s.convocacao_id, s.obra_id, s.obra_nome_snapshot,
      s.unidade_snapshot, s.periodo, s.principal
    FROM servicos_apontamento s
    WHERE s.convocacao_id = ANY(${ids})
    ORDER BY s.convocacao_id, s.principal DESC, s.id
  `;
}

function serviceFromDb(row: any): ServiceRef {
  return {
    id: row?.id ? Number(row.id) : null,
    workId: Number(row?.obra_id || 0),
    name: String(row?.obra_nome_snapshot || ""),
    unit: String(row?.unidade_snapshot || ""),
    period: String(row?.periodo || "Integral"),
    principal: Boolean(row?.principal),
  };
}

async function getBootstrap(sql: Sql, engineer: string, date: string) {
  const { collaborators, works } = await getBaseLists(sql);

  const team = await sql`
    SELECT
      c.id, c.obra_id, c.colaborador_id, c.data::text AS data,
      c.engenheiro, c.status, c.valor_extra, c.observacao, c.turno,
      col.nome AS colaborador_nome, col.funcao AS colaborador_funcao,
      o.nome AS obra_nome, o.unidade AS unidade
    FROM convocacoes c
    JOIN colaboradores col ON col.id = c.colaborador_id
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.engenheiro = ${engineer}
      AND c.data = ${date}::date
    ORDER BY col.nome, c.turno, c.id
  `;

  const allDay = await sql`
    SELECT
      c.id, c.colaborador_id, c.engenheiro, c.turno,
      o.unidade, o.nome AS obra_nome
    FROM convocacoes c
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.data = ${date}::date
    ORDER BY c.id
  `;

  const ids = team.map((x: any) => Number(x.id));
  const services = await getServicesForConvocations(sql, ids);
  const appointments = ids.length
    ? await sql`
        SELECT
          convocacao_id, data_servico::text AS data_servico,
          status, valor_extra, observacao, retroativo,
          apontado_em::text AS apontado_em, atualizado_em::text AS atualizado_em
        FROM apontamentos
        WHERE convocacao_id = ANY(${ids})
      `
    : [];

  const serviceMap = new Map<number, ServiceRef[]>();
  for (const raw of services) {
    const cid = Number(raw.convocacao_id);
    if (!serviceMap.has(cid)) serviceMap.set(cid, []);
    serviceMap.get(cid)!.push(serviceFromDb(raw));
  }
  const appointmentMap = new Map<number, any>();
  for (const a of appointments) appointmentMap.set(Number(a.convocacao_id), a);

  const contexts: any[] = [];
  for (const row of team) {
    const convId = Number(row.id);
    const parsed = parseObservation(row.observacao);
    const appointment = appointmentMap.get(convId) || null;
    let serviceSet = serviceMap.get(convId) || [];

    if (!serviceSet.length) {
      serviceSet = [{
        id: null,
        workId: Number(row.obra_id || 0),
        name: String(row.obra_nome || ""),
        unit: String(row.unidade || ""),
        period: String(parsed.meta?.periodo_servico_principal || row.turno || parsed.turno || "Integral"),
        principal: true,
      }];
    }

    let principal = serviceSet.find((s) => s.principal) || serviceSet[0];
    if (!principal) {
      principal = {
        id: null,
        workId: Number(row.obra_id || 0),
        name: String(row.obra_nome || ""),
        unit: String(row.unidade || ""),
        period: String(row.turno || "Integral"),
        principal: true,
      };
    }
    principal.principal = true;
    const additions = serviceSet.filter((s) => s !== principal && !s.principal);

    const byUnit = new Map<string, ServiceRef>();
    if (principal.unit) byUnit.set(principal.unit, principal);
    for (const additional of additions) {
      if (additional.unit && !byUnit.has(additional.unit)) {
        byUnit.set(additional.unit, additional);
      }
    }
    if (!byUnit.size) byUnit.set(String(row.unidade || ""), principal);

    const otherAllocations = allDay
      .filter((x: any) => Number(x.colaborador_id) === Number(row.colaborador_id) && Number(x.id) !== convId)
      .map((x: any) => ({
        id: Number(x.id),
        turno: normalizeTurn(x.turno),
        unidade: x.unidade || "-",
        engenheiro: x.engenheiro || "-",
      }));

    for (const [unit, contextService] of byUnit.entries()) {
      const sameUnitAdditions = additions.filter((s) => s.unit === unit);
      const editableSecond = contextService.principal ? (sameUnitAdditions[0] || null) : null;
      contexts.push({
        ...row,
        id: convId,
        turno: normalizeTurn(row.turno || parsed.turno),
        observacao_livre: appointment?.observacao ?? parsed.livre,
        metadata: parsed.meta,
        apontamento: appointment,
        context: {
          key: `${convId}:${contextService.principal ? "principal" : `additional:${contextService.workId}`}:${unit}`,
          unit,
          isPrincipal: Boolean(contextService.principal),
          originalWorkId: Number(contextService.workId || 0),
          workId: Number(contextService.workId || 0),
          workName: String(contextService.name || ""),
          period: String(contextService.period || row.turno || "Integral"),
          second: editableSecond,
        },
        principal,
        additions,
        obra_real_definida: Boolean(contextService.name && !isPlaceholder(contextService.name)),
        outra_convocacao_no_dia: otherAllocations.length > 0,
        outras_alocacoes: otherAllocations,
      });
    }
  }

  const units = [...new Set(contexts.map((x) => String(x.context?.unit || "").trim()).filter(Boolean))].sort();
  const today = todayFortaleza();

  return {
    ok: true,
    engineers: ENGENHEIROS,
    fixedUnits: UNIDADES_APROAR,
    statusOptions: STATUS_PRESENCA,
    periodOptions: PERIODOS,
    turnOptions: TURNOS,
    today,
    tomorrow: addDays(today, 1),
    retroactive: date < today,
    date,
    engineer,
    units,
    collaborators,
    works,
    team: contexts,
  };
}

async function getTomorrow(sql: Sql, engineer: string) {
  const today = todayFortaleza();
  const date = addDays(today, 1);
  const { collaborators, works } = await getBaseLists(sql);

  const convocations = await sql`
    SELECT
      c.id, c.colaborador_id, c.engenheiro, c.turno, c.data::text AS data,
      col.nome AS colaborador_nome, col.funcao AS colaborador_funcao,
      o.unidade, o.nome AS obra_nome
    FROM convocacoes c
    JOIN colaboradores col ON col.id = c.colaborador_id
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.engenheiro = ${engineer}
      AND c.data = ${date}::date
    ORDER BY col.nome, c.turno, c.id
  `;

  const allDay = await sql`
    SELECT
      c.id, c.colaborador_id, c.engenheiro, c.turno,
      col.nome AS colaborador_nome, o.unidade
    FROM convocacoes c
    JOIN colaboradores col ON col.id = c.colaborador_id
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.data = ${date}::date
    ORDER BY col.nome, c.turno, c.id
  `;

  const unavailability = await sql`
    SELECT colaborador_id, motivo, inicio::text AS inicio, fim::text AS fim, observacao
    FROM indisponibilidades
    WHERE ativo = TRUE
      AND inicio <= ${date}::date
      AND fim >= ${date}::date
    ORDER BY colaborador_id
  `;

  const realUnits = works.map((w: any) => String(w.unidade || "").trim()).filter(Boolean);
  const units = [...new Set([...UNIDADES_APROAR, ...realUnits])];

  return {
    ok: true,
    today,
    date,
    engineer,
    engineers: ENGENHEIROS,
    fixedUnits: UNIDADES_APROAR,
    collaborators,
    works,
    units,
    convocations,
    allDay,
    unavailability,
  };
}

async function getAvailability(sql: Sql, date: string, turn: string) {
  const collaborators = await sql`
    SELECT id, nome, funcao
    FROM colaboradores
    WHERE ativo = TRUE
    ORDER BY nome
  `;
  const convs = await sql`
    SELECT c.id, c.colaborador_id, c.engenheiro, c.turno, o.unidade
    FROM convocacoes c
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.data = ${date}::date
  `;
  const indisps = await sql`
    SELECT colaborador_id, motivo, inicio::text AS inicio, fim::text AS fim, observacao
    FROM indisponibilidades
    WHERE ativo = TRUE
      AND inicio <= ${date}::date
      AND fim >= ${date}::date
  `;

  const byCol = new Map<number, any[]>();
  for (const c of convs) {
    const id = Number(c.colaborador_id);
    if (!byCol.has(id)) byCol.set(id, []);
    byCol.get(id)!.push(c);
  }
  const off = new Map<number, any>();
  for (const i of indisps) off.set(Number(i.colaborador_id), i);

  const rows = collaborators.map((c: any) => {
    const unavailable = off.get(Number(c.id));
    const allocations = byCol.get(Number(c.id)) || [];
    if (unavailable) {
      return {
        ...c,
        situacao: "Indisponível",
        motivo: unavailable.motivo,
        indisponibilidade: unavailable,
        alocacoes: allocations,
        conflitos: [],
      };
    }
    const conflicts = allocations.filter((a) => turnsOverlap(a.turno, turn));
    return {
      ...c,
      situacao: conflicts.length ? "Ocupado" : "Disponível",
      motivo: "",
      alocacoes: allocations,
      conflitos: conflicts,
    };
  });

  return {
    ok: true,
    date,
    turn: normalizeTurn(turn),
    rows,
    totals: {
      disponiveis: rows.filter((x) => x.situacao === "Disponível").length,
      ocupados: rows.filter((x) => x.situacao === "Ocupado").length,
      indisponiveis: rows.filter((x) => x.situacao === "Indisponível").length,
    },
  };
}

async function createOrGetManualCollaborator(sql: Sql, manual: any) {
  const name = cleanName(manual?.name);
  if (!name) return { ok: false, error: "Informe o nome do colaborador." };

  const existing = await sql`
    SELECT id, nome, funcao, valor_diaria
    FROM colaboradores
    WHERE upper(nome) = ${name}
    ORDER BY id
    LIMIT 1
  `;
  if (existing.length) return { ok: true, collaborator: existing[0], reused: true };

  const category = normalizeText(manual?.category) === "AJUDANTE" ? "Ajudante" : "Profissional";
  const freeRole = String(manual?.functionName || "").trim();
  const casual = Boolean(manual?.isCasual);
  const rawRole = casual
    ? `AVULSO - ${freeRole || category.toUpperCase()}`
    : (freeRole || category.toUpperCase());
  const role = cleanRole(rawRole);
  const daily = category === "Ajudante" ? VALOR_DIARIA_AJUDANTE : VALOR_DIARIA_PROFISSIONAL;

  const [created] = await sql`
    INSERT INTO colaboradores (nome, funcao, valor_diaria)
    VALUES (${name}, ${role}, ${daily})
    RETURNING id, nome, funcao, valor_diaria
  `;
  return { ok: true, collaborator: created, reused: false };
}

async function persistConflict(
  sql: Sql,
  person: any,
  date: string,
  existing: any,
  engineerAttempt: string,
  turnAttempt: string,
  unitAttempt: string,
  origin: string,
) {
  await sql`
    INSERT INTO conflitos_convocacao (
      colaborador_id, colaborador_nome_snapshot, data,
      convocacao_existente_id, engenheiro_original, turno_original,
      unidade_original, engenheiro_tentativa, turno_tentativa,
      unidade_tentativa, contexto
    ) VALUES (
      ${Number(person.id)}, ${person.nome}, ${date}::date,
      ${Number(existing.id)}, ${existing.engenheiro}, ${normalizeTurn(existing.turno)},
      ${existing.unidade || ""}, ${engineerAttempt}, ${normalizeTurn(turnAttempt)},
      ${unitAttempt}, ${sql.json({ origem: origin })}
    )
  `;
  await audit(sql, "convocacao", existing.id, "CONFLITO_CONVOCACAO", engineerAttempt, null, null, {
    colaborador_id: String(person.id),
    engenheiro_original: existing.engenheiro,
    turno_original: normalizeTurn(existing.turno),
    turno_tentativa: normalizeTurn(turnAttempt),
    unidade_tentativa: unitAttempt,
  });
}

async function createConvocations(sql: Sql, body: any) {
  const engineer = cleanName(body.engineer);
  const date = String(body.date || "").trim();
  const unit = cleanName(body.unit);
  const turn = normalizeTurn(body.turn);
  const collaboratorIds = Array.from(
    new Set((body.collaboratorIds || []).map((x: unknown) => Number(x)).filter(Boolean)),
  ) as number[];

  let manualMessage = "";
  if (String(body.manual?.name || "").trim()) {
    const manualResult: any = await createOrGetManualCollaborator(sql, body.manual);
    if (!manualResult.ok) {
      manualMessage = manualResult.error || "Não foi possível cadastrar o nome informado.";
    } else {
      collaboratorIds.push(Number(manualResult.collaborator.id));
      manualMessage = manualResult.reused
        ? "Cadastro existente localizado e reutilizado."
        : "Novo colaborador cadastrado.";
    }
  }

  const uniqueIds = [...new Set(collaboratorIds)].filter(Boolean);
  if (!engineer || !date || !unit || !uniqueIds.length) {
    return {
      ok: false,
      status: 400,
      error: manualMessage || "Informe engenheiro, data, unidade, turno e pelo menos uma pessoa.",
    };
  }

  const placeholder = await ensurePlaceholder(sql, unit);
  const now = new Date();
  const fp = datePartsFortaleza(now);
  const today = todayFortaleza();
  const delayed = fp.hour >= 16 && date === addDays(today, 1);
  const warnings: string[] = [];
  let created = 0;

  for (const cid of uniqueIds) {
    const [person] = await sql`
      SELECT id, nome, funcao, valor_diaria
      FROM colaboradores
      WHERE id = ${cid} AND ativo = TRUE
      LIMIT 1
    `;
    if (!person) {
      warnings.push(`Colaborador ${cid}: colaborador não localizado. Atualize a página e tente novamente.`);
      continue;
    }

    const [off] = await sql`
      SELECT motivo, inicio::text AS inicio, fim::text AS fim
      FROM indisponibilidades
      WHERE colaborador_id = ${cid}
        AND ativo = TRUE
        AND inicio <= ${date}::date
        AND fim >= ${date}::date
      LIMIT 1
    `;
    if (off) {
      warnings.push(`${person.nome}: INDISPONÍVEL — ${off.motivo} (${off.inicio} a ${off.fim}).`);
      continue;
    }

    const existing = await sql`
      SELECT c.id, c.engenheiro, c.turno, o.unidade
      FROM convocacoes c
      LEFT JOIN obras o ON o.id = c.obra_id
      WHERE c.colaborador_id = ${cid}
        AND c.data = ${date}::date
      ORDER BY c.id
    `;

    const conflict = existing.find((x: any) => turnsOverlap(x.turno, turn));
    if (conflict) {
      if (normalizeText(conflict.engenheiro) !== normalizeText(engineer)) {
        await persistConflict(sql, person, date, conflict, engineer, turn, unit, "portal_supervisor_next_convocacao");
        warnings.push(
          `${person.nome}: já está com ${conflict.engenheiro} em ${normalizeTurn(conflict.turno)}. ` +
          "O conflito foi registrado para o Paulo.",
        );
      } else {
        warnings.push(
          `${person.nome}: já está no seu apontamento em ${normalizeTurn(conflict.turno)}. Escolha outro turno.`,
        );
      }
      continue;
    }

    const meta = {
      convocado_em: now.toISOString(),
      convocado_por: engineer,
      convocacao_atrasada: delayed,
    };
    const observation = buildObservation(turn, "", meta);

    const [row] = await sql`
      INSERT INTO convocacoes (
        obra_id, colaborador_id, data, engenheiro, status,
        valor_extra, observacao, turno, criado_em, criado_por
      ) VALUES (
        ${Number(placeholder.id)}, ${cid}, ${date}::date, ${engineer},
        'Presente (Integral)', 0, ${observation}, ${turn}, now(), ${engineer}
      )
      RETURNING id
    `;
    created += 1;
    await audit(sql, "convocacao", row.id, "CRIAR", engineer, null, {
      colaborador_id: String(cid),
      data: date,
      turno: turn,
      obra_id: String(placeholder.id),
    }, { origem: "portal_supervisor_next", convocacao_atrasada: delayed });
  }

  return {
    ok: created > 0,
    status: created > 0 ? 200 : 409,
    created,
    warnings,
    delayed,
    manualMessage,
    message: created
      ? `✓ Convocação salva com sucesso · ${created} pessoa(s).`
      : "A convocação não foi salva. Nenhum colaborador válido foi encontrado.",
  };
}

async function getCurrentServices(sql: Sql, conv: any): Promise<ServiceRef[]> {
  const rows = await sql`
    SELECT id, obra_id, obra_nome_snapshot, unidade_snapshot, periodo, principal
    FROM servicos_apontamento
    WHERE convocacao_id = ${Number(conv.id)}
    ORDER BY principal DESC, id
  `;
  if (rows.length) return rows.map(serviceFromDb);

  const work = conv.obra_id
    ? (await sql`
        SELECT id, unidade, nome
        FROM obras
        WHERE id = ${Number(conv.obra_id)}
        LIMIT 1
      `)[0]
    : null;
  const parsed = parseObservation(conv.observacao);
  return [{
    id: null,
    workId: Number(work?.id || conv.obra_id || 0),
    name: String(work?.nome || ""),
    unit: String(work?.unidade || ""),
    period: String(parsed.meta?.periodo_servico_principal || conv.turno || parsed.turno || "Integral"),
    principal: true,
  }];
}

async function persistServiceSet(sql: Sql, convocationId: number, services: ServiceRef[]) {
  const principal = services.find((s) => s.principal) || services[0];
  if (!principal) throw new Error("O apontamento ficou sem serviço principal.");

  await sql`DELETE FROM servicos_apontamento WHERE convocacao_id = ${convocationId}`;
  for (const service of services) {
    await sql`
      INSERT INTO servicos_apontamento (
        convocacao_id, obra_id, obra_nome_snapshot,
        unidade_snapshot, periodo, principal
      ) VALUES (
        ${convocationId}, ${service.workId || null}, ${service.name},
        ${service.unit}, ${service.period}, ${Boolean(service.principal)}
      )
    `;
  }
}

function servicesMetadata(services: ServiceRef[]) {
  const principal = services.find((s) => s.principal) || services[0];
  const additions = services.filter((s) => s !== principal && !s.principal);
  return {
    periodo_servico_principal: principal?.period || "Integral",
    servicos_adicionais: additions.map((x) => ({
      servico: x.name,
      periodo: x.period,
      obra_id: String(x.workId || ""),
      unidade: x.unit,
    })),
    servicos_extras: additions.map((x) => x.name).filter(Boolean),
  };
}

async function saveTeam(sql: Sql, body: any) {
  const engineer = cleanName(body.engineer);
  const date = String(body.date || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!engineer || !date || !items.length) {
    return { ok: false, status: 400, error: "Nenhum apontamento foi enviado." };
  }

  const today = todayFortaleza();
  const retroactive = date < today;
  const now = new Date();
  const errors: string[] = [];
  let saved = 0;

  for (const item of items) {
    const convocationId = Number(item.convocationId || 0);
    const status = STATUS_PRESENCA.includes(String(item.status))
      ? String(item.status)
      : "Presente (Integral)";
    const selectedWorkId = Number(item.workId || 0);
    const selectedPeriod = PERIODOS.includes(String(item.periodMain))
      ? String(item.periodMain)
      : "Integral";
    const secondWorkId = Number(item.secondWorkId || 0) || null;
    const secondPeriod = PERIODOS.includes(String(item.secondPeriod))
      ? String(item.secondPeriod)
      : "Tarde";
    const observationFree = String(item.observation || "").trim();
    const extra = isPresence(status) ? Math.max(0, Number(item.extra || 0)) : 0;
    const contextUnit = String(item.contextUnit || "").trim();
    const contextIsPrincipal = item.contextIsPrincipal !== false;
    const contextOriginalWorkId = Number(item.contextOriginalWorkId || 0);

    const [conv] = await sql`
      SELECT c.*, col.nome AS colaborador_nome
      FROM convocacoes c
      JOIN colaboradores col ON col.id = c.colaborador_id
      WHERE c.id = ${convocationId}
        AND c.engenheiro = ${engineer}
        AND c.data = ${date}::date
      LIMIT 1
    `;
    if (!conv) {
      errors.push(`Convocação ${convocationId}: não encontrada para este supervisor/data.`);
      continue;
    }

    const [selectedWork] = await sql`
      SELECT id, unidade, nome
      FROM obras
      WHERE id = ${selectedWorkId}
      LIMIT 1
    `;
    if (!selectedWork || isPlaceholder(selectedWork.nome)) {
      errors.push(`${conv.colaborador_nome}: selecione a obra/serviço.`);
      continue;
    }
    if (contextUnit && normalizeText(selectedWork.unidade) !== normalizeText(contextUnit)) {
      errors.push(`${conv.colaborador_nome}: o serviço selecionado deve pertencer à unidade ${contextUnit}.`);
      continue;
    }

    let secondWork: any = null;
    if (secondWorkId) {
      if (secondWorkId === selectedWorkId) {
        errors.push(`${conv.colaborador_nome}: o 2º serviço deve ser diferente do principal.`);
        continue;
      }
      [secondWork] = await sql`
        SELECT id, unidade, nome
        FROM obras
        WHERE id = ${secondWorkId}
        LIMIT 1
      `;
      if (!secondWork || isPlaceholder(secondWork.nome)) {
        errors.push(`${conv.colaborador_nome}: selecione um 2º serviço válido.`);
        continue;
      }
      if (contextUnit && normalizeText(secondWork.unidade) !== normalizeText(contextUnit)) {
        errors.push(`${conv.colaborador_nome}: o 2º serviço deve pertencer à mesma unidade.`);
        continue;
      }
    }

    const [otherCount] = await sql`
      SELECT count(*)::int AS qtd
      FROM convocacoes
      WHERE colaborador_id = ${Number(conv.colaborador_id)}
        AND data = ${date}::date
        AND id <> ${convocationId}
    `;
    const hasSeparateConvocation = Number(otherCount?.qtd || 0) > 0;
    if (hasSeparateConvocation && secondWork) {
      errors.push(`${conv.colaborador_nome}: já existe outra convocação no dia; cada turno deve ser apontado separadamente.`);
      continue;
    }

    let services = await getCurrentServices(sql, conv);
    let principal = services.find((s) => s.principal) || services[0];
    principal.principal = true;
    let additions = services.filter((s) => s !== principal && !s.principal);

    if (contextIsPrincipal) {
      principal = {
        ...principal,
        workId: Number(selectedWork.id),
        name: String(selectedWork.nome),
        unit: String(selectedWork.unidade || contextUnit),
        period: selectedPeriod,
        principal: true,
      };

      const sameUnit = additions.filter((x) => normalizeText(x.unit) === normalizeText(contextUnit || principal.unit));
      const otherUnits = additions.filter((x) => normalizeText(x.unit) !== normalizeText(contextUnit || principal.unit));

      if (!hasSeparateConvocation && secondWork) {
        const newSecond: ServiceRef = {
          id: sameUnit[0]?.id || null,
          workId: Number(secondWork.id),
          name: String(secondWork.nome),
          unit: String(secondWork.unidade || principal.unit),
          period: secondPeriod,
          principal: false,
        };
        if (sameUnit.length) sameUnit[0] = newSecond;
        else sameUnit.push(newSecond);
      }
      additions = [...otherUnits, ...sameUnit];
    } else {
      const keep = additions.filter((x) => {
        if (!contextOriginalWorkId) return true;
        return !(Number(x.workId) === contextOriginalWorkId && normalizeText(x.unit) === normalizeText(contextUnit));
      });
      keep.push({
        id: null,
        workId: Number(selectedWork.id),
        name: String(selectedWork.nome),
        unit: String(selectedWork.unidade || contextUnit),
        period: selectedPeriod,
        principal: false,
      });
      additions = keep;
    }

    const dedupe = new Set<number>();
    const finalServices = [principal, ...additions].filter((service) => {
      if (!service.workId) return false;
      if (dedupe.has(service.workId)) return false;
      dedupe.add(service.workId);
      return true;
    });

    const parsed = parseObservation(conv.observacao);
    const serviceMeta = servicesMetadata(finalServices);
    const meta = {
      ...(parsed.meta || {}),
      apontado_em: parsed.meta?.apontado_em || now.toISOString(),
      ultimo_apontamento_em: now.toISOString(),
      apontado_por: engineer,
      apontamento_atrasado: retroactive,
      ...serviceMeta,
    };
    const newObservation = buildObservation(conv.turno || parsed.turno, observationFree, meta);

    try {
      await sql.begin(async (tx) => {
        await tx`
          UPDATE convocacoes
          SET obra_id = ${principal.workId},
              status = ${status},
              valor_extra = ${extra},
              observacao = ${newObservation},
              atualizado_em = now()
          WHERE id = ${convocationId}
        `;

        await tx`
          INSERT INTO apontamentos (
            convocacao_id, data_servico, colaborador_id, engenheiro,
            status, valor_extra, observacao, apontado_em, apontado_por,
            retroativo, atualizado_em
          ) VALUES (
            ${convocationId}, ${date}::date, ${Number(conv.colaborador_id)}, ${engineer},
            ${status}, ${extra}, ${observationFree}, now(), ${engineer},
            ${retroactive}, now()
          )
          ON CONFLICT (convocacao_id) DO UPDATE SET
            data_servico = EXCLUDED.data_servico,
            colaborador_id = EXCLUDED.colaborador_id,
            engenheiro = EXCLUDED.engenheiro,
            status = EXCLUDED.status,
            valor_extra = EXCLUDED.valor_extra,
            observacao = EXCLUDED.observacao,
            apontado_por = EXCLUDED.apontado_por,
            retroativo = EXCLUDED.retroativo,
            atualizado_em = now()
        `;

        await persistServiceSet(tx as unknown as Sql, convocationId, finalServices);
      });

      await audit(sql, "apontamento", convocationId, "SALVAR", engineer, null, {
        data_servico: date,
        status,
        valor_extra: extra,
        servicos: finalServices,
        retroativo: retroactive,
      }, {
        origem: "portal_supervisor_next",
        unidade_contexto: contextUnit,
        contexto_principal: contextIsPrincipal,
      });
      saved += 1;
    } catch (error) {
      errors.push(`${conv.colaborador_nome}: não foi possível salvar o apontamento.`);
      await recordError(sql, error, "save_team_item", { convocationId, engineer, date });
    }
  }

  return {
    ok: errors.length === 0,
    partial: saved > 0 && errors.length > 0,
    status: errors.length && !saved ? 400 : 200,
    saved,
    errors,
    retroactive,
    message: saved
      ? `✓ Apontamento salvo com sucesso · ${saved} registro(s).`
      : "Nenhum apontamento foi salvo.",
  };
}

async function addDirect(sql: Sql, body: any) {
  const engineer = cleanName(body.engineer);
  const date = String(body.date || "").trim();
  const type = String(body.type || "Cadastrado");
  const rawServices = Array.isArray(body.services) ? body.services.slice(0, 2) : [];

  const services: any[] = [];
  const seenWorks = new Set<number>();
  for (const raw of rawServices) {
    const workId = Number(raw?.workId || 0);
    const turn = normalizeTurn(raw?.turn || "Integral");
    if (!workId) continue;
    if (seenWorks.has(workId)) {
      return { ok: false, status: 400, error: "Os serviços selecionados devem ser diferentes." };
    }
    const [work] = await sql`
      SELECT id, unidade, nome
      FROM obras
      WHERE id = ${workId}
      LIMIT 1
    `;
    if (!work || isPlaceholder(work.nome)) {
      return { ok: false, status: 400, error: "Selecione pelo menos um serviço válido." };
    }
    seenWorks.add(workId);
    services.push({
      workId,
      turn,
      name: String(work.nome),
      unit: String(work.unidade || ""),
    });
  }

  if (!engineer || !date || !services.length) {
    return { ok: false, status: 400, error: "Selecione pelo menos um serviço." };
  }

  const groups = new Map<string, any[]>();
  for (const service of services) {
    if (!groups.has(service.turn)) groups.set(service.turn, []);
    groups.get(service.turn)!.push(service);
  }
  const turns = [...groups.keys()];
  for (let i = 0; i < turns.length; i += 1) {
    for (let j = i + 1; j < turns.length; j += 1) {
      if (turnsOverlap(turns[i], turns[j])) {
        return {
          ok: false,
          status: 409,
          error:
            `Os turnos ${turns[i]} e ${turns[j]} se sobrepõem. ` +
            "Use o mesmo turno nos dois serviços quando ambos ocorreram no mesmo período, ou escolha períodos compatíveis.",
        };
      }
    }
  }

  let person: any = null;
  if (type === "Avulso") {
    const manual = await createOrGetManualCollaborator(sql, {
      name: body.name,
      category: body.category,
      functionName: body.functionName,
      isCasual: true,
    });
    if (!manual.ok) return { ok: false, status: 400, error: manual.error };
    person = manual.collaborator;
  } else {
    const collaboratorId = Number(body.collaboratorId || 0);
    [person] = await sql`
      SELECT id, nome, funcao, valor_diaria
      FROM colaboradores
      WHERE id = ${collaboratorId} AND ativo = TRUE
      LIMIT 1
    `;
    if (!person) return { ok: false, status: 400, error: "Selecione um colaborador." };
  }

  const collaboratorId = Number(person.id);
  const [off] = await sql`
    SELECT motivo, inicio::text AS inicio, fim::text AS fim
    FROM indisponibilidades
    WHERE colaborador_id = ${collaboratorId}
      AND ativo = TRUE
      AND inicio <= ${date}::date
      AND fim >= ${date}::date
    LIMIT 1
  `;
  if (off) {
    return {
      ok: false,
      status: 409,
      error: `Colaborador indisponível: ${off.motivo} (${off.inicio} a ${off.fim}).`,
    };
  }

  const existingRows = await sql`
    SELECT c.id, c.obra_id, c.engenheiro, c.turno, c.observacao, c.status, c.valor_extra,
           o.nome AS obra_nome, o.unidade
    FROM convocacoes c
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.colaborador_id = ${collaboratorId}
      AND c.data = ${date}::date
    ORDER BY c.id
  `;

  for (const [turn, groupServices] of groups.entries()) {
    for (const existing of existingRows) {
      if (!turnsOverlap(existing.turno, turn)) continue;
      if (normalizeText(existing.engenheiro) !== normalizeText(engineer)) {
        await persistConflict(
          sql, person, date, existing, engineer, turn,
          groupServices[0]?.unit || "", "portal_supervisor_next_inclusao_direta",
        );
        return {
          ok: false,
          status: 409,
          error:
            `Esse colaborador já está com ${existing.engenheiro} em ${normalizeTurn(existing.turno)}. ` +
            "O conflito foi registrado para o Paulo.",
        };
      }
      if (normalizeTurn(existing.turno) !== normalizeTurn(turn)) {
        return {
          ok: false,
          status: 409,
          error:
            `Esse colaborador já está no seu apontamento em ${normalizeTurn(existing.turno)}. ` +
            "Escolha um período compatível.",
        };
      }
    }
  }

  const today = todayFortaleza();
  const retroactive = date < today;
  const now = new Date();
  const fp = datePartsFortaleza(now);
  const convLate = fp.hour >= 16 && date === addDays(today, 1);
  let totalServicesLinked = 0;

  for (const [turn, groupServices] of groups.entries()) {
    const sameTurnExisting = existingRows.find(
      (x: any) => normalizeText(x.engenheiro) === normalizeText(engineer) && normalizeTurn(x.turno) === normalizeTurn(turn),
    );

    if (sameTurnExisting) {
      let current = await getCurrentServices(sql, sameTurnExisting);
      let principal = current.find((s) => s.principal) || current[0];
      principal.principal = true;
      const additions = current.filter((s) => s !== principal && !s.principal);
      const known = new Set<number>(current.map((x) => Number(x.workId)).filter(Boolean));
      const newOnes = groupServices.filter((x) => !known.has(Number(x.workId)));

      if ((!principal.name || isPlaceholder(principal.name)) && newOnes.length) {
        const promoted = newOnes.shift();
        principal = {
          workId: Number(promoted.workId),
          name: promoted.name,
          unit: promoted.unit,
          period: turn,
          principal: true,
        };
      }
      for (const service of newOnes) {
        additions.push({
          workId: Number(service.workId),
          name: service.name,
          unit: service.unit,
          period: turn,
          principal: false,
        });
      }
      current = [principal, ...additions];

      const parsed = parseObservation(sameTurnExisting.observacao);
      const meta = {
        ...(parsed.meta || {}),
        apontado_em: parsed.meta?.apontado_em || now.toISOString(),
        ultimo_apontamento_em: now.toISOString(),
        apontado_por: engineer,
        apontamento_atrasado: retroactive,
        incluido_direto_apontamento: true,
        ...servicesMetadata(current),
      };
      const observation = buildObservation(turn, parsed.livre, meta);

      await sql.begin(async (tx) => {
        await tx`
          UPDATE convocacoes
          SET obra_id = ${principal.workId}, observacao = ${observation}, atualizado_em = now()
          WHERE id = ${Number(sameTurnExisting.id)}
        `;
        await tx`
          INSERT INTO apontamentos (
            convocacao_id, data_servico, colaborador_id, engenheiro,
            status, valor_extra, observacao, apontado_em, apontado_por,
            retroativo, atualizado_em
          ) VALUES (
            ${Number(sameTurnExisting.id)}, ${date}::date, ${collaboratorId}, ${engineer},
            ${sameTurnExisting.status || defaultStatusForTurn(turn)},
            ${Number(sameTurnExisting.valor_extra || 0)}, ${parsed.livre}, now(), ${engineer},
            ${retroactive}, now()
          )
          ON CONFLICT (convocacao_id) DO UPDATE SET
            apontado_por = EXCLUDED.apontado_por,
            retroativo = EXCLUDED.retroativo,
            atualizado_em = now()
        `;
        await persistServiceSet(tx as unknown as Sql, Number(sameTurnExisting.id), current);
      });

      totalServicesLinked += groupServices.length;
      await audit(sql, "convocacao", sameTurnExisting.id, "INCLUIR_DIRETO_APONTAMENTO", engineer, null, {
        colaborador_id: String(collaboratorId), data: date, turno: turn, servicos: groupServices,
      }, { retroativo, origem: "portal_supervisor_next_multisservico" });
      continue;
    }

    const principalSource = groupServices[0];
    const additions = groupServices.slice(1).map((x) => ({
      workId: Number(x.workId), name: x.name, unit: x.unit, period: turn, principal: false,
    }));
    const serviceSet: ServiceRef[] = [{
      workId: Number(principalSource.workId),
      name: principalSource.name,
      unit: principalSource.unit,
      period: turn,
      principal: true,
    }, ...additions];

    const status = defaultStatusForTurn(turn);
    const meta = {
      convocado_em: now.toISOString(),
      convocado_por: engineer,
      incluido_direto_apontamento: true,
      convocacao_atrasada: convLate,
      apontado_em: now.toISOString(),
      ultimo_apontamento_em: now.toISOString(),
      apontado_por: engineer,
      apontamento_atrasado: retroactive,
      ...servicesMetadata(serviceSet),
    };
    const observation = buildObservation(turn, "", meta);

    const [row] = await sql`
      INSERT INTO convocacoes (
        obra_id, colaborador_id, data, engenheiro, status,
        valor_extra, observacao, turno, criado_em, criado_por
      ) VALUES (
        ${Number(principalSource.workId)}, ${collaboratorId}, ${date}::date, ${engineer},
        ${status}, 0, ${observation}, ${turn}, now(), ${engineer}
      )
      RETURNING id
    `;

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO apontamentos (
          convocacao_id, data_servico, colaborador_id, engenheiro,
          status, valor_extra, observacao, apontado_em, apontado_por,
          retroativo, atualizado_em
        ) VALUES (
          ${Number(row.id)}, ${date}::date, ${collaboratorId}, ${engineer},
          ${status}, 0, '', now(), ${engineer}, ${retroactive}, now()
        )
      `;
      await persistServiceSet(tx as unknown as Sql, Number(row.id), serviceSet);
    });

    totalServicesLinked += groupServices.length;
    await audit(sql, "convocacao", row.id, "INCLUIR_DIRETO_APONTAMENTO", engineer, null, {
      colaborador_id: String(collaboratorId), data: date, turno: turn, servicos: groupServices,
    }, { retroativo, origem: "portal_supervisor_next_multisservico" });
  }

  return {
    ok: true,
    status: 200,
    message: `✓ Apontamento salvo com sucesso · ${person.nome}.`,
    retroactive,
    servicesLinked: totalServicesLinked,
  };
}

export default async (req: Request, _context: Context) => {
  let sql: Sql | null = null;
  let action = "unknown";
  try {
    sql = await getSql();
    const url = new URL(req.url);

    if (req.method === "GET") {
      const op = url.searchParams.get("op") || "bootstrap";
      action = `GET:${op}`;
      if (op === "bootstrap") {
        const engineer = cleanName(url.searchParams.get("engineer") || "VICTOR");
        const date = String(url.searchParams.get("date") || todayFortaleza());
        return json(await getBootstrap(sql, engineer, date));
      }
      if (op === "tomorrow") {
        const engineer = cleanName(url.searchParams.get("engineer") || "VICTOR");
        return json(await getTomorrow(sql, engineer));
      }
      if (op === "availability") {
        const date = String(url.searchParams.get("date") || addDays(todayFortaleza(), 1));
        const turn = String(url.searchParams.get("turn") || "Integral");
        return json(await getAvailability(sql, date, turn));
      }
      return json({ ok: false, error: "Operação inválida." }, 400);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      action = String((body as any).action || "");
      let result: any;

      if (action === "create_convocations") result = await createConvocations(sql, body);
      else if (action === "save_team") result = await saveTeam(sql, body);
      else if (action === "add_direct") result = await addDirect(sql, body);
      else result = { ok: false, status: 400, error: "Ação inválida." };

      return json(result, Number(result.status || (result.ok ? 200 : 400)));
    }

    return json({ ok: false, error: "Método não permitido." }, 405);
  } catch (error) {
    console.error("supervisor API error", error);
    await recordError(sql, error, action, { path: req.url, method: req.method });
    return json({
      ok: false,
      error: "Não foi possível acessar os dados operacionais agora.",
    }, 500);
  } finally {
    if (sql) await sql.end({ timeout: 1 });
  }
};

export const config: Config = {
  path: "/api/supervisor",
};
