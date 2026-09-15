import type { Config, Context } from "@netlify/functions";
import postgres from "postgres";

const ENGENHEIROS = [
  "EDUARDO", "GABRIEL", "GUSTAVO", "JOEL",
  "NETO", "PAULO", "SOARES", "VICTOR",
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

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

function normalizeTurn(turno: unknown) {
  const raw = String(turno || "Integral").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (raw === "manha") return "Manhã";
  if (raw === "tarde") return "Tarde";
  if (raw === "noite") return "Noite";
  return "Integral";
}

function turnsOverlap(a: unknown, b: unknown) {
  const ta = normalizeTurn(a);
  const tb = normalizeTurn(b);
  if (ta === "Integral" || tb === "Integral") return true;
  return ta === tb;
}

function isPresence(status: unknown) {
  const s = String(status || "");
  return [
    "Presente (Integral)",
    "Presente (Só Manhã)",
    "Presente (Só Tarde)",
    "Saída Antecipada",
    "Presente",
    "Extra",
  ].includes(s);
}

function parseObservation(observation: unknown) {
  const text = String(observation || "");
  const idx = text.indexOf(OBS_META_MARKER);
  const visible = idx >= 0 ? text.slice(0, idx) : text;
  const metaText = idx >= 0 ? text.slice(idx + OBS_META_MARKER.length) : "";

  let turno = "Integral";
  let livre = "";
  for (const part of visible.split("|").map((x) => x.trim())) {
    if (part.toLowerCase().startsWith("turno:")) turno = normalizeTurn(part.split(":").slice(1).join(":"));
    if (part.toLowerCase().startsWith("obs:")) livre = part.split(":").slice(1).join(":").trim();
  }

  let meta: Record<string, unknown> = {};
  if (metaText) {
    try { meta = JSON.parse(metaText); } catch { meta = {}; }
  }
  return { turno, livre, meta };
}

function buildObservation(turno: unknown, livre: unknown, meta: Record<string, unknown> = {}) {
  const parts = [`Turno: ${normalizeTurn(turno)}`];
  if (String(livre || "").trim()) parts.push(`Obs: ${String(livre).trim()}`);
  const clean = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => {
      if (value === null || value === undefined || value === "") return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) return false;
      return true;
    }),
  );
  return Object.keys(clean).length
    ? `${parts.join(" | ")}${OBS_META_MARKER}${JSON.stringify(clean)}`
    : parts.join(" | ");
}

function isPlaceholder(name: unknown) {
  return String(name || "").trim().toUpperCase().startsWith("A DEFINIR NO APONTAMENTO");
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

async function ensurePlaceholder(sql: ReturnType<typeof postgres>, unidade: string) {
  const normalized = unidade.trim().toUpperCase();
  const name = `A DEFINIR NO APONTAMENTO - ${normalized}`;
  const rows = await sql`
    INSERT INTO obras (unidade, nome)
    VALUES (${normalized}, ${name})
    ON CONFLICT (nome) DO UPDATE SET unidade = EXCLUDED.unidade
    RETURNING id, unidade, nome
  `;
  return rows[0];
}

async function audit(
  sql: ReturnType<typeof postgres>,
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
        ${entidade},
        ${String(entidadeId || "")},
        ${acao},
        ${usuario},
        ${antes ? sql.json(antes as object) : null},
        ${depois ? sql.json(depois as object) : null},
        ${sql.json((contexto || {}) as object)}
      )
    `;
  } catch {
    // Auditoria jamais derruba a operação principal.
  }
}

async function getBootstrap(
  sql: ReturnType<typeof postgres>,
  engineer: string,
  date: string,
) {
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

  const team = await sql`
    SELECT
      c.id,
      c.obra_id,
      c.colaborador_id,
      c.data::text AS data,
      c.engenheiro,
      c.status,
      c.valor_extra,
      c.observacao,
      c.turno,
      col.nome AS colaborador_nome,
      col.funcao AS colaborador_funcao,
      o.nome AS obra_nome,
      o.unidade AS unidade
    FROM convocacoes c
    JOIN colaboradores col ON col.id = c.colaborador_id
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.engenheiro = ${engineer}
      AND c.data = ${date}::date
    ORDER BY col.nome, c.turno, c.id
  `;

  const allDay = await sql`
    SELECT
      c.id,
      c.colaborador_id,
      c.engenheiro,
      c.turno,
      o.unidade
    FROM convocacoes c
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.data = ${date}::date
  `;

  const ids = team.map((x: any) => Number(x.id));
  let services: any[] = [];
  let appointments: any[] = [];
  if (ids.length) {
    services = await sql`
      SELECT
        s.id,
        s.convocacao_id,
        s.obra_id,
        s.obra_nome_snapshot,
        s.unidade_snapshot,
        s.periodo,
        s.principal
      FROM servicos_apontamento s
      WHERE s.convocacao_id = ANY(${ids})
      ORDER BY s.convocacao_id, s.principal DESC, s.id
    `;
    appointments = await sql`
      SELECT
        convocacao_id,
        data_servico::text AS data_servico,
        status,
        valor_extra,
        observacao,
        retroativo,
        apontado_em::text AS apontado_em
      FROM apontamentos
      WHERE convocacao_id = ANY(${ids})
    `;
  }

  const sameDayCount = new Map<number, number>();
  for (const row of allDay) {
    const cid = Number(row.colaborador_id);
    sameDayCount.set(cid, (sameDayCount.get(cid) || 0) + 1);
  }

  const servicesByConv = new Map<number, any[]>();
  for (const s of services) {
    const id = Number(s.convocacao_id);
    if (!servicesByConv.has(id)) servicesByConv.set(id, []);
    servicesByConv.get(id)!.push(s);
  }
  const appointmentsByConv = new Map<number, any>();
  for (const a of appointments) appointmentsByConv.set(Number(a.convocacao_id), a);

  const enriched = team.map((row: any) => {
    const parsed = parseObservation(row.observacao);
    const appointment = appointmentsByConv.get(Number(row.id)) || null;
    const serviceList = servicesByConv.get(Number(row.id)) || [];
    const principal = serviceList.find((s) => s.principal) || null;
    const additional = serviceList.filter((s) => !s.principal);

    const workName = principal?.obra_nome_snapshot || row.obra_nome || "";
    const currentWorkId = principal?.obra_id || row.obra_id || null;

    return {
      ...row,
      turno: normalizeTurn(row.turno || parsed.turno),
      observacao_livre: appointment?.observacao ?? parsed.livre,
      metadata: parsed.meta,
      apontamento: appointment,
      principal: principal || {
        obra_id: currentWorkId,
        obra_nome_snapshot: workName,
        unidade_snapshot: row.unidade,
        periodo: (parsed.meta as any)?.periodo_servico_principal || row.turno || parsed.turno,
        principal: true,
      },
      adicionais: additional,
      obra_real_definida: Boolean(workName && !isPlaceholder(workName)),
      outra_convocacao_no_dia: (sameDayCount.get(Number(row.colaborador_id)) || 0) > 1,
      outras_alocacoes: allDay
        .filter((x: any) => Number(x.colaborador_id) === Number(row.colaborador_id) && Number(x.id) !== Number(row.id))
        .map((x: any) => ({
          turno: normalizeTurn(x.turno),
          unidade: x.unidade || "-",
          engenheiro: x.engenheiro || "-",
        })),
    };
  });

  const units = [...new Set(
    enriched.map((x: any) => String(x.unidade || "").trim()).filter(Boolean),
  )].sort();

  const today = todayFortaleza();
  return {
    ok: true,
    engineers: ENGENHEIROS,
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
    team: enriched,
  };
}

async function getTomorrow(
  sql: ReturnType<typeof postgres>,
  engineer: string,
) {
  const today = todayFortaleza();
  const date = addDays(today, 1);

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
  const convocations = await sql`
    SELECT
      c.id, c.colaborador_id, c.engenheiro, c.turno, c.data::text AS data,
      col.nome AS colaborador_nome, col.funcao AS colaborador_funcao,
      o.unidade, o.nome AS obra_nome
    FROM convocacoes c
    JOIN colaboradores col ON col.id = c.colaborador_id
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.engenheiro = ${engineer} AND c.data = ${date}::date
    ORDER BY col.nome, c.turno
  `;

  const allDay = await sql`
    SELECT
      c.id, c.colaborador_id, c.engenheiro, c.turno,
      col.nome AS colaborador_nome, o.unidade
    FROM convocacoes c
    JOIN colaboradores col ON col.id = c.colaborador_id
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.data = ${date}::date
  `;

  const unavailability = await sql`
    SELECT colaborador_id, motivo, inicio::text AS inicio, fim::text AS fim
    FROM indisponibilidades
    WHERE ativo = TRUE
      AND inicio <= ${date}::date
      AND fim >= ${date}::date
  `;

  return {
    ok: true,
    today,
    date,
    engineer,
    engineers: ENGENHEIROS,
    collaborators,
    works,
    convocations,
    allDay,
    unavailability,
  };
}

async function getAvailability(
  sql: ReturnType<typeof postgres>,
  date: string,
  turn: string,
) {
  const collaborators = await sql`
    SELECT id, nome, funcao
    FROM colaboradores
    WHERE ativo = TRUE
    ORDER BY nome
  `;
  const convs = await sql`
    SELECT
      c.id, c.colaborador_id, c.engenheiro, c.turno,
      o.unidade
    FROM convocacoes c
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.data = ${date}::date
  `;
  const indisps = await sql`
    SELECT
      colaborador_id, motivo, inicio::text AS inicio, fim::text AS fim,
      observacao
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
    const alloc = byCol.get(Number(c.id)) || [];
    if (unavailable) {
      return {
        ...c,
        situacao: "Indisponível",
        motivo: unavailable.motivo,
        alocacoes: alloc,
      };
    }
    const conflicts = alloc.filter((a) => turnsOverlap(a.turno, turn));
    return {
      ...c,
      situacao: conflicts.length ? "Ocupado" : "Disponível",
      motivo: "",
      alocacoes: alloc,
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

async function createConvocations(sql: ReturnType<typeof postgres>, body: any) {
  const engineer = String(body.engineer || "").trim().toUpperCase();
  const date = String(body.date || "").trim();
  const unit = String(body.unit || "").trim().toUpperCase();
  const turn = normalizeTurn(body.turn);
  const collaboratorIds = Array.from(
    new Set((body.collaboratorIds || []).map((x: unknown) => Number(x)).filter(Boolean)),
  ) as number[];

  if (!engineer || !date || !unit || !collaboratorIds.length) {
    return { ok: false, status: 400, error: "Informe engenheiro, data, unidade, turno e colaboradores." };
  }

  const placeholder = await ensurePlaceholder(sql, unit);
  const now = new Date();
  const fp = datePartsFortaleza(now);
  const today = todayFortaleza();
  const delayed = fp.hour >= 16 && date === addDays(today, 1);
  const warnings: string[] = [];
  const created: any[] = [];

  for (const cid of collaboratorIds) {
    const [person] = await sql`SELECT id, nome FROM colaboradores WHERE id = ${cid} AND ativo = TRUE`;
    if (!person) {
      warnings.push(`Colaborador ${cid}: cadastro não encontrado.`);
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
      warnings.push(`${person.nome}: indisponível — ${off.motivo} (${off.inicio} a ${off.fim}).`);
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
      if (String(conflict.engenheiro || "").trim().toUpperCase() !== engineer) {
        await sql`
          INSERT INTO conflitos_convocacao (
            colaborador_id, colaborador_nome_snapshot, data,
            convocacao_existente_id, engenheiro_original, turno_original,
            unidade_original, engenheiro_tentativa, turno_tentativa,
            unidade_tentativa, contexto
          ) VALUES (
            ${cid}, ${person.nome}, ${date}::date,
            ${Number(conflict.id)}, ${conflict.engenheiro}, ${normalizeTurn(conflict.turno)},
            ${conflict.unidade || ""}, ${engineer}, ${turn},
            ${unit}, ${sql.json({ origem: "portal_web" })}
          )
        `;
        warnings.push(
          `${person.nome}: já está com ${conflict.engenheiro} em ${normalizeTurn(conflict.turno)}. O conflito foi registrado para o Paulo.`,
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
      RETURNING id, colaborador_id, data::text AS data, engenheiro, turno
    `;
    created.push(row);
    await audit(sql, "convocacao", row.id, "CRIAR", engineer, null, {
      colaborador_id: String(cid),
      data: date,
      turno: turn,
      obra_id: String(placeholder.id),
    });
  }

  return {
    ok: true,
    status: 200,
    created: created.length,
    warnings,
    delayed,
  };
}

async function saveTeam(sql: ReturnType<typeof postgres>, body: any) {
  const engineer = String(body.engineer || "").trim().toUpperCase();
  const date = String(body.date || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!engineer || !date || !items.length) {
    return { ok: false, status: 400, error: "Nenhum apontamento foi enviado." };
  }

  const today = todayFortaleza();
  const retroactive = date < today;
  const now = new Date();
  const errors: string[] = [];
  const saved: number[] = [];

  for (const item of items) {
    const convocationId = Number(item.convocationId);
    const status = STATUS_PRESENCA.includes(String(item.status))
      ? String(item.status)
      : "Presente (Integral)";
    const workId = Number(item.workId);
    const periodMain = PERIODOS.includes(String(item.periodMain))
      ? String(item.periodMain)
      : "Integral";
    const secondWorkId = item.secondWorkId ? Number(item.secondWorkId) : null;
    const secondPeriod = PERIODOS.includes(String(item.secondPeriod))
      ? String(item.secondPeriod)
      : "Tarde";
    const observationFree = String(item.observation || "").trim();
    const extra = isPresence(status) ? Math.max(0, Number(item.extra || 0)) : 0;

    const [conv] = await sql`
      SELECT
        c.*, col.nome AS colaborador_nome
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

    const [work] = await sql`
      SELECT id, unidade, nome
      FROM obras
      WHERE id = ${workId}
      LIMIT 1
    `;
    if (!work || isPlaceholder(work.nome)) {
      errors.push(`${conv.colaborador_nome}: selecione a obra/serviço.`);
      continue;
    }

    let secondWork: any = null;
    if (secondWorkId) {
      if (secondWorkId === workId) {
        errors.push(`${conv.colaborador_nome}: o 2º serviço deve ser diferente do principal.`);
        continue;
      }
      [secondWork] = await sql`
        SELECT id, unidade, nome
        FROM obras
        WHERE id = ${secondWorkId}
        LIMIT 1
      `;
      if (!secondWork || isPlaceholder(secondWork.nome)) secondWork = null;
    }

    const [otherCount] = await sql`
      SELECT count(*)::int AS qtd
      FROM convocacoes
      WHERE colaborador_id = ${Number(conv.colaborador_id)}
        AND data = ${date}::date
        AND id <> ${convocationId}
    `;
    const hasSeparateConvocation = Number(otherCount?.qtd || 0) > 0;

    const parsed = parseObservation(conv.observacao);
    const meta: Record<string, unknown> = {
      ...(parsed.meta || {}),
      apontado_em: (parsed.meta as any)?.apontado_em || now.toISOString(),
      ultimo_apontamento_em: now.toISOString(),
      apontado_por: engineer,
      apontamento_atrasado: retroactive,
      periodo_servico_principal: periodMain,
      servicos_adicionais: [],
      servicos_extras: [],
    };

    if (!hasSeparateConvocation && secondWork) {
      (meta.servicos_adicionais as any[]) = [{
        servico: secondWork.nome,
        periodo: secondPeriod,
        obra_id: String(secondWork.id),
        unidade: String(secondWork.unidade || work.unidade || ""),
      }];
      meta.servicos_extras = [secondWork.nome];
    }

    const newObservation = buildObservation(
      conv.turno || parsed.turno,
      observationFree,
      meta,
    );

    await sql.begin(async (tx) => {
      await tx`
        UPDATE convocacoes
        SET
          obra_id = ${workId},
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

      await tx`DELETE FROM servicos_apontamento WHERE convocacao_id = ${convocationId}`;

      await tx`
        INSERT INTO servicos_apontamento (
          convocacao_id, obra_id, obra_nome_snapshot,
          unidade_snapshot, periodo, principal
        ) VALUES (
          ${convocationId}, ${workId}, ${work.nome},
          ${work.unidade || ""}, ${periodMain}, TRUE
        )
      `;

      if (!hasSeparateConvocation && secondWork) {
        await tx`
          INSERT INTO servicos_apontamento (
            convocacao_id, obra_id, obra_nome_snapshot,
            unidade_snapshot, periodo, principal
          ) VALUES (
            ${convocationId}, ${Number(secondWork.id)}, ${secondWork.nome},
            ${secondWork.unidade || work.unidade || ""}, ${secondPeriod}, FALSE
          )
        `;
      }
    });

    await audit(sql, "apontamento", convocationId, "SALVAR", engineer, null, {
      data_servico: date,
      status,
      valor_extra: extra,
      obra_principal_id: String(workId),
      periodo_principal: periodMain,
      segundo_servico: (!hasSeparateConvocation && secondWork)
        ? { obra_id: String(secondWork.id), periodo: secondPeriod }
        : null,
      retroativo: retroactive,
    });

    saved.push(convocationId);
  }

  return {
    ok: errors.length === 0,
    partial: saved.length > 0 && errors.length > 0,
    status: errors.length && !saved.length ? 400 : 200,
    saved: saved.length,
    errors,
    retroactive,
  };
}

async function addDirect(sql: ReturnType<typeof postgres>, body: any) {
  const engineer = String(body.engineer || "").trim().toUpperCase();
  const date = String(body.date || "").trim();
  const type = String(body.type || "Cadastrado");

  const rawServices = Array.isArray(body.services)
    ? body.services.slice(0, 2)
    : [{
        workId: body.workId,
        turn: body.turn || "Integral",
      }];

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
      name: work.nome,
      unit: String(work.unidade || "").trim(),
    });
  }

  if (!services.length) {
    return { ok: false, status: 400, error: "Selecione pelo menos um serviço." };
  }

  // Serviços do mesmo turno ficam no mesmo apontamento; turnos diferentes
  // só podem coexistir quando não se sobrepõem.
  const groups = new Map<string, any[]>();
  for (const service of services) {
    if (!groups.has(service.turn)) groups.set(service.turn, []);
    groups.get(service.turn)!.push(service);
  }
  const newTurns = [...groups.keys()];
  for (let i = 0; i < newTurns.length; i += 1) {
    for (let j = i + 1; j < newTurns.length; j += 1) {
      if (turnsOverlap(newTurns[i], newTurns[j])) {
        return {
          ok: false,
          status: 409,
          error:
            `Os turnos ${newTurns[i]} e ${newTurns[j]} se sobrepõem. ` +
            "Use o mesmo turno nos dois serviços quando ambos ocorreram no mesmo período, " +
            "ou escolha períodos compatíveis.",
        };
      }
    }
  }

  let collaboratorId = Number(body.collaboratorId || 0);
  let person: any = null;

  if (type === "Avulso") {
    const name = String(body.name || "").trim().replace(/\s+/g, " ").toUpperCase();
    if (!name) return { ok: false, status: 400, error: "Digite o nome do funcionário avulso." };

    const existingPerson = await sql`
      SELECT id, nome, funcao, valor_diaria
      FROM colaboradores
      WHERE upper(nome) = ${name}
      LIMIT 1
    `;

    if (existingPerson.length) {
      person = existingPerson[0];
      collaboratorId = Number(person.id);
    } else {
      const category = String(body.category || "Profissional");
      const functionName = String(body.functionName || "").trim();
      const role = `AVULSO - ${functionName || category.toUpperCase()}`;
      const daily = category === "Ajudante"
        ? VALOR_DIARIA_AJUDANTE
        : VALOR_DIARIA_PROFISSIONAL;

      [person] = await sql`
        INSERT INTO colaboradores (nome, funcao, valor_diaria)
        VALUES (${name}, ${role}, ${daily})
        RETURNING id, nome, funcao, valor_diaria
      `;
      collaboratorId = Number(person.id);
    }
  } else {
    [person] = await sql`
      SELECT id, nome, funcao, valor_diaria
      FROM colaboradores
      WHERE id = ${collaboratorId} AND ativo = TRUE
      LIMIT 1
    `;
    if (!person) return { ok: false, status: 400, error: "Selecione um colaborador." };
  }

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
    SELECT
      c.id, c.obra_id, c.engenheiro, c.turno, c.observacao,
      o.nome AS obra_nome, o.unidade
    FROM convocacoes c
    LEFT JOIN obras o ON o.id = c.obra_id
    WHERE c.colaborador_id = ${collaboratorId}
      AND c.data = ${date}::date
    ORDER BY c.id
  `;

  // Primeiro valida conflitos com outras pessoas/turnos. Se for mesmo engenheiro
  // + mesmo turno, será tratado como inclusão de outro serviço no mesmo registro.
  for (const [turn, groupServices] of groups.entries()) {
    for (const existing of existingRows) {
      if (!turnsOverlap(existing.turn, turn)) continue;

      const existingEngineer = String(existing.engenheiro || "").trim().toUpperCase();

      if (existingEngineer !== engineer) {
        await sql`
          INSERT INTO conflitos_convocacao (
            colaborador_id, colaborador_nome_snapshot, data,
            convocacao_existente_id, engenheiro_original, turno_original,
            unidade_original, engenheiro_tentativa, turno_tentativa,
            unidade_tentativa, contexto
          ) VALUES (
            ${collaboratorId}, ${person.nome}, ${date}::date,
            ${Number(existing.id)}, ${existing.engenheiro}, ${normalizeTurn(existing.turn)},
            ${existing.unidade || ""}, ${engineer}, ${turn},
            ${groupServices[0]?.unit || ""}, ${sql.json({ origem: "portal_web_inclusao_direta" })}
          )
        `;
        return {
          ok: false,
          status: 409,
          error:
            `Esse colaborador já está com ${existing.engenheiro} em ${normalizeTurn(existing.turn)}. ` +
            "O conflito foi registrado para o Paulo.",
        };
      }

      if (normalizeTurn(existing.turn) !== normalizeTurn(turn)) {
        return {
          ok: false,
          status: 409,
          error:
            `Esse colaborador já está no seu apontamento em ${normalizeTurn(existing.turn)}. ` +
            "Escolha um período compatível.",
        };
      }
    }
  }

  const now = new Date();
  const fp = datePartsFortaleza(now);
  const today = todayFortaleza();
  const retroactive = date < today;
  const convLate = fp.hour >= 16 && date === addDays(today, 1);
  let totalServicesLinked = 0;

  for (const [turn, groupServices] of groups.entries()) {
    const sameTurnExisting = existingRows.find(
      (x: any) =>
        String(x.engenheiro || "").trim().toUpperCase() === engineer &&
        normalizeTurn(x.turn) === normalizeTurn(turn),
    );

    if (sameTurnExisting) {
      const parsed = parseObservation(sameTurnExisting.observacao);
      const principalReal = sameTurnExisting.obra_nome && !isPlaceholder(sameTurnExisting.obra_nome);

      let principalWorkId = Number(sameTurnExisting.obra_id || 0);
      let principalName = String(sameTurnExisting.obra_nome || "");
      let principalUnit = String(sameTurnExisting.unidade || "");
      const additions: any[] = [];

      const existingServices = await sql`
        SELECT obra_id, obra_nome_snapshot, unidade_snapshot, periodo, principal
        FROM servicos_apontamento
        WHERE convocacao_id = ${Number(sameTurnExisting.id)}
        ORDER BY principal DESC, id
      `;

      for (const s of existingServices) {
        if (!s.principal) {
          additions.push({
            workId: Number(s.obra_id || 0),
            name: s.obra_nome_snapshot,
            unit: s.unidade_snapshot,
            turn: s.periodo || turn,
          });
        }
      }

      const known = new Set<number>();
      if (principalReal && principalWorkId) known.add(principalWorkId);
      for (const a of additions) if (a.workId) known.add(a.workId);

      const newServices = groupServices.filter((s) => !known.has(Number(s.workId)));

      if (!principalReal && newServices.length) {
        const promoted = newServices.shift();
        principalWorkId = Number(promoted.workId);
        principalName = promoted.name;
        principalUnit = promoted.unit;
        known.add(principalWorkId);
      }

      for (const service of newServices) {
        additions.push(service);
        known.add(Number(service.workId));
      }

      const meta: Record<string, unknown> = {
        ...(parsed.meta || {}),
        apontado_em: (parsed.meta as any)?.apontado_em || now.toISOString(),
        ultimo_apontamento_em: now.toISOString(),
        apontado_por: engineer,
        apontamento_atrasado: retroactive,
        incluido_direto_apontamento: true,
        periodo_servico_principal: turn,
        servicos_adicionais: additions.map((x) => ({
          servico: x.name,
          periodo: turn,
          obra_id: String(x.workId),
          unidade: x.unit,
        })),
        servicos_extras: additions.map((x) => x.name),
      };
      const observation = buildObservation(turn, parsed.livre, meta);

      await sql.begin(async (tx) => {
        await tx`
          UPDATE convocacoes
          SET obra_id = ${principalWorkId},
              observacao = ${observation},
              atualizado_em = now()
          WHERE id = ${Number(sameTurnExisting.id)}
        `;

        await tx`
          INSERT INTO apontamentos (
            convocacao_id, data_servico, colaborador_id, engenheiro,
            status, valor_extra, observacao, apontado_em, apontado_por,
            retroativo, atualizado_em
          )
          SELECT
            c.id, c.data, c.colaborador_id, c.engenheiro,
            c.status, c.valor_extra, ${parsed.livre}, now(), ${engineer},
            ${retroactive}, now()
          FROM convocacoes c
          WHERE c.id = ${Number(sameTurnExisting.id)}
          ON CONFLICT (convocacao_id) DO UPDATE SET
            retroativo = EXCLUDED.retroativo,
            apontado_por = EXCLUDED.apontado_por,
            atualizado_em = now()
        `;

        await tx`DELETE FROM servicos_apontamento WHERE convocacao_id = ${Number(sameTurnExisting.id)}`;

        await tx`
          INSERT INTO servicos_apontamento (
            convocacao_id, obra_id, obra_nome_snapshot,
            unidade_snapshot, periodo, principal
          ) VALUES (
            ${Number(sameTurnExisting.id)}, ${principalWorkId}, ${principalName},
            ${principalUnit}, ${turn}, TRUE
          )
        `;

        for (const addition of additions) {
          await tx`
            INSERT INTO servicos_apontamento (
              convocacao_id, obra_id, obra_nome_snapshot,
              unidade_snapshot, periodo, principal
            ) VALUES (
              ${Number(sameTurnExisting.id)}, ${Number(addition.workId)}, ${addition.name},
              ${addition.unit}, ${turn}, FALSE
            )
          `;
        }
      });

      totalServicesLinked += groupServices.length;
      await audit(sql, "convocacao", sameTurnExisting.id, "INCLUIR_DIRETO_APONTAMENTO", engineer, null, {
        colaborador_id: String(collaboratorId),
        data: date,
        turno: turn,
        servicos: groupServices.map((x) => ({
          obra_id: String(x.workId),
          obra: x.name,
          unidade: x.unit,
        })),
      }, {
        retroativo,
        origem: "portal_web_multisservico",
      });

      continue;
    }

    const principal = groupServices[0];
    const additions = groupServices.slice(1);
    const status = turn === "Manhã"
      ? "Presente (Só Manhã)"
      : turn === "Tarde"
        ? "Presente (Só Tarde)"
        : "Presente (Integral)";

    const meta = {
      convocado_em: now.toISOString(),
      convocado_por: engineer,
      incluido_direto_apontamento: true,
      convocacao_atrasada: convLate,
      apontado_em: now.toISOString(),
      ultimo_apontamento_em: now.toISOString(),
      apontado_por: engineer,
      apontamento_atrasado: retroactive,
      periodo_servico_principal: turn,
      servicos_adicionais: additions.map((x) => ({
        servico: x.name,
        periodo: turn,
        obra_id: String(x.workId),
        unidade: x.unit,
      })),
      servicos_extras: additions.map((x) => x.name),
    };
    const observation = buildObservation(turn, "", meta);

    const [row] = await sql`
      INSERT INTO convocacoes (
        obra_id, colaborador_id, data, engenheiro, status,
        valor_extra, observacao, turno, criado_em, criado_por
      ) VALUES (
        ${Number(principal.workId)}, ${collaboratorId}, ${date}::date, ${engineer},
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

      await tx`
        INSERT INTO servicos_apontamento (
          convocacao_id, obra_id, obra_nome_snapshot,
          unidade_snapshot, periodo, principal
        ) VALUES (
          ${Number(row.id)}, ${Number(principal.workId)}, ${principal.name},
          ${principal.unit}, ${turn}, TRUE
        )
      `;

      for (const addition of additions) {
        await tx`
          INSERT INTO servicos_apontamento (
            convocacao_id, obra_id, obra_nome_snapshot,
            unidade_snapshot, periodo, principal
          ) VALUES (
            ${Number(row.id)}, ${Number(addition.workId)}, ${addition.name},
            ${addition.unit}, ${turn}, FALSE
          )
        `;
      }
    });

    totalServicesLinked += groupServices.length;
    await audit(sql, "convocacao", row.id, "INCLUIR_DIRETO_APONTAMENTO", engineer, null, {
      colaborador_id: String(collaboratorId),
      data: date,
      turno: turn,
      servicos: groupServices.map((x) => ({
        obra_id: String(x.workId),
        obra: x.name,
        unidade: x.unit,
      })),
    }, {
      retroativo,
      origem: "portal_web_multisservico",
    });
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
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    sql = await getSql();

    const url = new URL(req.url);

    if (req.method === "GET") {
      const op = url.searchParams.get("op") || "bootstrap";
      if (op === "bootstrap") {
        const engineer = String(url.searchParams.get("engineer") || "VICTOR").toUpperCase();
        const date = String(url.searchParams.get("date") || todayFortaleza());
        return json(await getBootstrap(sql, engineer, date));
      }
      if (op === "tomorrow") {
        const engineer = String(url.searchParams.get("engineer") || "VICTOR").toUpperCase();
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
      const action = String((body as any).action || "");

      let result: any;
      if (action === "create_convocations") result = await createConvocations(sql, body);
      else if (action === "save_team") result = await saveTeam(sql, body);
      else if (action === "add_direct") result = await addDirect(sql, body);
      else result = { ok: false, status: 400, error: "Ação inválida." };

      return json(result, Number(result.status || (result.ok ? 200 : 400)));
    }

    return json({ ok: false, error: "Método não permitido." }, 405);
  } catch (error) {
    console.error("field API error", error);
    return json({
      ok: false,
      error: "Não foi possível acessar os dados operacionais agora.",
    }, 500);
  } finally {
    if (sql) await sql.end({ timeout: 1 });
  }
};

export const config: Config = {
  path: "/api/field",
};
