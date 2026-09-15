'use client';

import { useCallback, useEffect, useMemo, useState } from "react";

const API = "/api/supervisor";
const FALLBACK_ENGINEERS = [
  "EDUARDO", "GABRIEL", "GUSTAVO", "JOEL",
  "NETO", "PAULO", "SOARES", "VICTOR",
];
const FALLBACK_TURNS = ["Integral", "Manhã", "Tarde", "Noite"];
const FALLBACK_PERIODS = ["Integral", "Manhã", "Tarde", "Noite", "Outro"];
const FALLBACK_STATUS = [
  "Presente (Integral)",
  "Presente (Só Manhã)",
  "Presente (Só Tarde)",
  "Saída Antecipada",
  "Falta",
  "Atestado",
];

function fortalezaISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type) => parts.find((x) => x.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function brDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
}

function shortDate(iso) {
  if (!iso) return "—";
  const [, m, d] = String(iso).split("-");
  return m && d ? `${d}/${m}` : String(iso);
}

function statusForTurn(turn) {
  if (turn === "Manhã") return "Presente (Só Manhã)";
  if (turn === "Tarde") return "Presente (Só Tarde)";
  return "Presente (Integral)";
}

function isAbsence(status) {
  return ["Falta", "Atestado"].includes(String(status || ""));
}

function realWorks(data, unit) {
  return (data?.works || []).filter((work) => {
    const placeholder = String(work.nome || "").toUpperCase().startsWith("A DEFINIR NO APONTAMENTO");
    return !placeholder && (!unit || String(work.unidade || "") === String(unit));
  });
}

function realUnits(data) {
  const values = (data?.works || [])
    .filter((work) => !String(work.nome || "").toUpperCase().startsWith("A DEFINIR NO APONTAMENTO"))
    .map((work) => String(work.unidade || "").trim())
    .filter(Boolean);
  return [...new Set([...(data?.fixedUnits || []), ...values])];
}

async function request(url, options) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Não foi possível concluir esta operação.");
  }
  return payload;
}

function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function Select({ value, onChange, children, disabled, multiple, size, className = "" }) {
  return (
    <select
      className={`control ${className}`}
      value={value}
      onChange={onChange}
      disabled={disabled}
      multiple={multiple}
      size={size}
    >
      {children}
    </select>
  );
}

function Metric({ label, value, note, tone = "" }) {
  return (
    <div className={`metric ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </div>
  );
}

function Notice({ type = "info", children }) {
  return <div className={`notice ${type}`}>{children}</div>;
}

function LoadingBlock({ children = "Carregando..." }) {
  return <div className="loading-block"><span className="spinner" /> {children}</div>;
}

function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>;
}

function TeamCard({ row, data, draft, onDraftChange }) {
  const unit = row.context?.unit || row.unidade || "";
  const works = realWorks(data, unit);
  const periods = data.periodOptions || FALLBACK_PERIODS;
  const statuses = data.statusOptions || FALLBACK_STATUS;
  const hasOtherConvocation = Boolean(row.outra_convocacao_no_dia);
  const contextIsPrincipal = row.context?.isPrincipal !== false;
  const canEditSecond = contextIsPrincipal && !hasOtherConvocation;
  const savedLate = Boolean(row.apontamento?.retroativo);
  const retroactive = Boolean(data.retroactive);

  return (
    <article className="team-card">
      <div className="team-card-head">
        <div>
          <div className="person-name">{row.colaborador_nome}</div>
          <div className="person-meta">
            {row.colaborador_funcao || "—"} · {unit} · Convocado: {row.turno}
          </div>
        </div>
        <span className="turn-chip">{row.turno}</span>
      </div>

      {savedLate ? (
        <Notice type="warning">Apontamento realizado com atraso — salvo em data posterior ao serviço.</Notice>
      ) : retroactive ? (
        <Notice type="warning">Este apontamento é retroativo. Ao salvar, o atraso será registrado.</Notice>
      ) : null}

      {!contextIsPrincipal ? (
        <Notice type="muted">
          Este é um serviço adicional do mesmo turno. Ele permanece vinculado ao mesmo apontamento e o serviço principal não será substituído.
        </Notice>
      ) : null}

      <div className="grid grid-2">
        <Field label="Status">
          <Select
            value={draft.status}
            onChange={(event) => {
              const status = event.target.value;
              onDraftChange({
                status,
                ...(isAbsence(status) ? { extra: 0 } : {}),
              });
            }}
          >
            {statuses.map((status) => <option key={status}>{status}</option>)}
          </Select>
        </Field>

        <Field label="Obra / Serviço">
          <Select
            value={draft.workId || ""}
            onChange={(event) => onDraftChange({ workId: Number(event.target.value || 0) })}
          >
            <option value="">— Selecione o serviço —</option>
            {works.map((work) => (
              <option key={work.id} value={work.id}>{work.nome}</option>
            ))}
          </Select>
        </Field>
      </div>

      <details className="expander">
        <summary>Mais opções</summary>
        <div className="expander-body">
          <div className="grid grid-2">
            <Field label="Período no serviço">
              <Select
                value={draft.periodMain}
                onChange={(event) => onDraftChange({ periodMain: event.target.value })}
              >
                {periods.map((period) => <option key={period}>{period}</option>)}
              </Select>
            </Field>

            <Field label="Extra (R$)" hint="Falta ou atestado salva extra como zero.">
              <input
                className="control"
                type="number"
                min="0"
                step="10"
                disabled={isAbsence(draft.status)}
                value={draft.extra}
                onChange={(event) => onDraftChange({ extra: Number(event.target.value || 0) })}
              />
            </Field>
          </div>

          <Field label="Observação / justificativa">
            <input
              className="control"
              value={draft.observation}
              onChange={(event) => onDraftChange({ observation: event.target.value })}
            />
          </Field>

          {canEditSecond ? (
            <div className="secondary-service">
              <div className="secondary-title">2º serviço na mesma unidade</div>
              <div className="grid grid-2">
                <Field label="2º serviço">
                  <Select
                    value={draft.secondWorkId || ""}
                    onChange={(event) => onDraftChange({ secondWorkId: Number(event.target.value || 0) })}
                  >
                    <option value="">— Nenhum —</option>
                    {works.map((work) => (
                      <option key={work.id} value={work.id}>{work.nome}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Período do 2º serviço">
                  <Select
                    value={draft.secondPeriod}
                    onChange={(event) => onDraftChange({ secondPeriod: event.target.value })}
                  >
                    {periods.map((period) => <option key={period}>{period}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          ) : hasOtherConvocation && contextIsPrincipal ? (
            <div className="subtle-note">
              Já existe outra convocação desta pessoa no mesmo dia. Cada turno é apontado separadamente.
              {(row.outras_alocacoes || []).length ? (
                <span> {row.outras_alocacoes.map((x) => `${x.turno} · ${x.unidade} · ${x.engenheiro}`).join(" | ")}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function DirectInclusion({ data, selectedUnit, onSaved, setGlobalError, setGlobalSuccess, setBusy }) {
  const [type, setType] = useState("Cadastrado");
  const [collaboratorId, setCollaboratorId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Profissional");
  const [functionName, setFunctionName] = useState("");
  const [second, setSecond] = useState(false);
  const units = realUnits(data);
  const fixedUnit = !data.retroactive ? selectedUnit : "";
  const [unit1, setUnit1] = useState(fixedUnit || units[0] || "");
  const [unit2, setUnit2] = useState(fixedUnit || units[0] || "");
  const [work1, setWork1] = useState("");
  const [work2, setWork2] = useState("");
  const [turn1, setTurn1] = useState("Manhã");
  const [turn2, setTurn2] = useState("Tarde");

  useEffect(() => {
    if (fixedUnit) {
      setUnit1(fixedUnit);
      setUnit2(fixedUnit);
    }
  }, [fixedUnit]);

  const works1 = realWorks(data, fixedUnit || unit1);
  const works2 = realWorks(data, fixedUnit || unit2);

  const submit = async () => {
    const effectiveUnit1 = fixedUnit || unit1;
    const effectiveUnit2 = fixedUnit || unit2;
    setGlobalError("");
    setGlobalSuccess("");

    if (type === "Cadastrado" && !Number(collaboratorId)) {
      setGlobalError("Selecione um colaborador.");
      return;
    }
    if (type === "Avulso" && !name.trim()) {
      setGlobalError("Digite o nome do funcionário avulso.");
      return;
    }
    if (!effectiveUnit1 || !Number(work1)) {
      setGlobalError("Selecione a unidade e a obra/serviço principal.");
      return;
    }
    if (second && (!effectiveUnit2 || !Number(work2))) {
      setGlobalError("Selecione a unidade e a 2ª obra/serviço.");
      return;
    }
    if (second && Number(work1) === Number(work2)) {
      setGlobalError("O 2º serviço deve ser diferente do 1º.");
      return;
    }

    setBusy(true);
    try {
      const result = await request(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_direct",
          engineer: data.engineer,
          date: data.date,
          type,
          collaboratorId: Number(collaboratorId || 0),
          name,
          category,
          functionName,
          services: [
            { workId: Number(work1), turn: turn1, unit: effectiveUnit1 },
            ...(second ? [{ workId: Number(work2), turn: turn2, unit: effectiveUnit2 }] : []),
          ],
        }),
      });
      setGlobalSuccess(result.message || "✓ Apontamento salvo com sucesso.");
      setSecond(false);
      setWork1("");
      setWork2("");
      setName("");
      setCollaboratorId("");
      await onSaved();
    } catch (error) {
      setGlobalError(error.message || "Não foi possível incluir o colaborador.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="expander inclusion-box">
      <summary>Adicionar colaborador / avulso ao apontamento</summary>
      <div className="expander-body">
        <p className="section-help">
          Use esta área para apontamento retroativo ou inclusão excepcional. Você pode lançar um ou dois serviços para a mesma pessoa.
        </p>

        <Field label="Tipo">
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            <option>Cadastrado</option>
            <option>Avulso</option>
          </Select>
        </Field>

        {type === "Cadastrado" ? (
          <Field label="Colaborador">
            <Select value={collaboratorId} onChange={(event) => setCollaboratorId(event.target.value)}>
              <option value="">— Selecione —</option>
              {(data.collaborators || []).map((person) => (
                <option key={person.id} value={person.id}>{person.nome} ({person.funcao || "—"})</option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Nome do avulso">
              <input className="control" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome completo" />
            </Field>
            <div className="grid grid-2">
              <Field label="Categoria da diária">
                <Select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option>Profissional</option>
                  <option>Ajudante</option>
                </Select>
              </Field>
              <Field label="Função (opcional)">
                <input className="control" value={functionName} onChange={(event) => setFunctionName(event.target.value)} />
              </Field>
            </div>
          </>
        )}

        <div className="secondary-title">1º serviço</div>
        {!fixedUnit ? (
          <Field label="Unidade do 1º serviço">
            <Select value={unit1} onChange={(event) => { setUnit1(event.target.value); setWork1(""); }}>
              {units.map((unit) => <option key={unit}>{unit}</option>)}
            </Select>
          </Field>
        ) : <div className="subtle-note">Unidade do serviço: <strong>{fixedUnit}</strong></div>}
        <div className="grid grid-2">
          <Field label="Obra / Serviço">
            <Select value={work1} onChange={(event) => setWork1(event.target.value)}>
              <option value="">— Selecione —</option>
              {works1.map((work) => <option key={work.id} value={work.id}>{work.nome}</option>)}
            </Select>
          </Field>
          <Field label="Turno">
            <Select value={turn1} onChange={(event) => setTurn1(event.target.value)}>
              {FALLBACK_TURNS.map((turn) => <option key={turn}>{turn}</option>)}
            </Select>
          </Field>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={second} onChange={(event) => setSecond(event.target.checked)} />
          <span>Adicionar 2º serviço</span>
        </label>

        {second ? (
          <div className="secondary-panel">
            <div className="secondary-title">2º serviço</div>
            {!fixedUnit ? (
              <Field label="Unidade do 2º serviço">
                <Select value={unit2} onChange={(event) => { setUnit2(event.target.value); setWork2(""); }}>
                  {units.map((unit) => <option key={unit}>{unit}</option>)}
                </Select>
              </Field>
            ) : null}
            <div className="grid grid-2">
              <Field label="Obra / Serviço">
                <Select value={work2} onChange={(event) => setWork2(event.target.value)}>
                  <option value="">— Selecione —</option>
                  {works2.map((work) => <option key={work.id} value={work.id}>{work.nome}</option>)}
                </Select>
              </Field>
              <Field label="Turno">
                <Select value={turn2} onChange={(event) => setTurn2(event.target.value)}>
                  {FALLBACK_TURNS.map((turn) => <option key={turn}>{turn}</option>)}
                </Select>
              </Field>
            </div>
          </div>
        ) : null}

        <button type="button" className="button full" onClick={submit}>Adicionar ao apontamento</button>
      </div>
    </details>
  );
}

export default function SupervisorPortal() {
  const [tab, setTab] = useState("today");
  const [engineer, setEngineer] = useState("VICTOR");
  const [date, setDate] = useState(() => fortalezaISO());
  const [unit, setUnit] = useState("");
  const [todayData, setTodayData] = useState(null);
  const [tomorrowData, setTomorrowData] = useState(null);
  const [availabilityData, setAvailabilityData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [tomorrowUnit, setTomorrowUnit] = useState("");
  const [tomorrowTurn, setTomorrowTurn] = useState("Integral");
  const [functionFilter, setFunctionFilter] = useState("Todas");
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [manualName, setManualName] = useState("");
  const [manualCasual, setManualCasual] = useState(false);
  const [manualCategory, setManualCategory] = useState("Profissional");
  const [manualFunction, setManualFunction] = useState("");

  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityTurn, setAvailabilityTurn] = useState("Integral");
  const [availabilitySearch, setAvailabilitySearch] = useState("");

  const clearMessages = useCallback(() => {
    setError("");
    setSuccess("");
  }, []);

  const hydrateDrafts = useCallback((data) => {
    const next = {};
    for (const row of data?.team || []) {
      const key = row.context?.key || String(row.id);
      next[key] = {
        status: row.apontamento?.status || row.status || statusForTurn(row.turno),
        workId: Number(row.context?.workId || 0),
        periodMain: row.context?.period || row.turno || "Integral",
        secondWorkId: Number(row.context?.second?.workId || 0),
        secondPeriod: row.context?.second?.period || "Tarde",
        extra: Number(row.apontamento?.valor_extra ?? row.valor_extra ?? 0),
        observation: row.apontamento?.observacao ?? row.observacao_livre ?? "",
      };
    }
    setDrafts(next);
  }, []);

  const loadToday = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setBusy(true);
    setError("");
    try {
      const data = await request(`${API}?op=bootstrap&engineer=${encodeURIComponent(engineer)}&date=${encodeURIComponent(date)}`);
      setTodayData(data);
      hydrateDrafts(data);
      const units = data.units || [];
      setUnit((current) => current && units.includes(current) ? current : (units[0] || ""));
      if (!availabilityDate) setAvailabilityDate(data.tomorrow || data.today || fortalezaISO());
      return data;
    } catch (loadError) {
      setTodayData(null);
      setError(loadError.message || "Não foi possível carregar a equipe.");
      return null;
    } finally {
      if (!silent) setBusy(false);
    }
  }, [engineer, date, hydrateDrafts, availabilityDate]);

  const loadTomorrow = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setBusy(true);
    setError("");
    try {
      const data = await request(`${API}?op=tomorrow&engineer=${encodeURIComponent(engineer)}`);
      setTomorrowData(data);
      const units = data.units || realUnits(data);
      setTomorrowUnit((current) => current && units.includes(current) ? current : (units[0] || ""));
      return data;
    } catch (loadError) {
      setTomorrowData(null);
      setError(loadError.message || "Não foi possível carregar a convocação.");
      return null;
    } finally {
      if (!silent) setBusy(false);
    }
  }, [engineer]);

  const loadAvailability = useCallback(async ({ silent = false } = {}) => {
    const targetDate = availabilityDate || todayData?.tomorrow || fortalezaISO();
    if (!silent) setBusy(true);
    setError("");
    try {
      const data = await request(`${API}?op=availability&date=${encodeURIComponent(targetDate)}&turn=${encodeURIComponent(availabilityTurn)}`);
      setAvailabilityData(data);
      if (!availabilityDate) setAvailabilityDate(targetDate);
      return data;
    } catch (loadError) {
      setAvailabilityData(null);
      setError(loadError.message || "Não foi possível consultar a disponibilidade.");
      return null;
    } finally {
      if (!silent) setBusy(false);
    }
  }, [availabilityDate, availabilityTurn, todayData?.tomorrow]);

  useEffect(() => {
    if (tab === "today") loadToday();
  }, [tab, engineer, date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "tomorrow") loadTomorrow();
  }, [tab, engineer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === "availability") loadAvailability();
  }, [tab, availabilityDate, availabilityTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentTeam = useMemo(() => {
    if (!todayData || !unit) return [];
    return (todayData.team || []).filter((row) => String(row.context?.unit || row.unidade || "") === unit);
  }, [todayData, unit]);

  const teamMetrics = useMemo(() => {
    const total = currentTeam.length;
    const complete = currentTeam.filter((row) => Number(drafts[row.context?.key || String(row.id)]?.workId || 0) > 0).length;
    const absences = currentTeam.filter((row) => isAbsence(drafts[row.context?.key || String(row.id)]?.status || row.status)).length;
    return { total, complete, pending: Math.max(0, total - complete), absences };
  }, [currentTeam, drafts]);

  const allDefined = currentTeam.length > 0 && teamMetrics.pending === 0;

  const updateDraft = (key, patch) => {
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const markAllPresent = () => {
    if (!allDefined) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const row of currentTeam) {
        const key = row.context?.key || String(row.id);
        next[key] = {
          ...next[key],
          status: statusForTurn(row.turno),
        };
      }
      return next;
    });
  };

  const saveTeam = async () => {
    clearMessages();
    if (!currentTeam.length) return;

    const items = [];
    for (const row of currentTeam) {
      const key = row.context?.key || String(row.id);
      const draft = drafts[key];
      if (!draft?.workId) {
        setError(`${row.colaborador_nome}: selecione a obra/serviço.`);
        return;
      }
      if (draft.secondWorkId && Number(draft.secondWorkId) === Number(draft.workId)) {
        setError(`${row.colaborador_nome}: o 2º serviço deve ser diferente do principal.`);
        return;
      }
      items.push({
        convocationId: Number(row.id),
        contextUnit: row.context?.unit || unit,
        contextIsPrincipal: row.context?.isPrincipal !== false,
        contextOriginalWorkId: Number(row.context?.originalWorkId || 0),
        status: draft.status,
        workId: Number(draft.workId),
        periodMain: draft.periodMain,
        secondWorkId: Number(draft.secondWorkId || 0) || null,
        secondPeriod: draft.secondPeriod,
        extra: Number(draft.extra || 0),
        observation: draft.observation || "",
      });
    }

    setBusy(true);
    try {
      const result = await request(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_team",
          engineer,
          date,
          unit,
          items,
        }),
      });
      if (result.errors?.length) setError(result.errors.join(" • "));
      if (result.saved) {
        setSuccess(result.retroactive
          ? `✓ ${result.saved} apontamento(s) salvo(s). O atraso retroativo foi registrado automaticamente.`
          : result.message || `✓ ${result.saved} apontamento(s) salvo(s).`);
      }
      await loadToday({ silent: true });
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar a equipe.");
    } finally {
      setBusy(false);
    }
  };

  const tomorrowFunctions = useMemo(() => {
    const functions = (tomorrowData?.collaborators || []).map((person) => String(person.funcao || "").trim()).filter(Boolean);
    return ["Todas", ...[...new Set(functions)].sort()];
  }, [tomorrowData]);

  const tomorrowPeople = useMemo(() => {
    if (!tomorrowData) return [];
    const byPerson = new Map();
    for (const allocation of tomorrowData.allDay || []) {
      const id = Number(allocation.colaborador_id);
      if (!byPerson.has(id)) byPerson.set(id, []);
      byPerson.get(id).push(allocation);
    }
    const off = new Map((tomorrowData.unavailability || []).map((item) => [Number(item.colaborador_id), item]));

    return (tomorrowData.collaborators || [])
      .filter((person) => functionFilter === "Todas" || String(person.funcao || "") === functionFilter)
      .map((person) => {
        const allocations = byPerson.get(Number(person.id)) || [];
        const unavailable = off.get(Number(person.id));
        const details = [];
        if (unavailable) details.push(`INDISPONÍVEL: ${unavailable.motivo}`);
        for (const allocation of allocations) {
          const occupied = allocation.turno === "Integral" || tomorrowTurn === "Integral" || allocation.turno === tomorrowTurn;
          details.push(`${occupied ? "OCUPADO" : "já"} ${allocation.turno} · ${allocation.engenheiro}${allocation.unidade ? ` / ${allocation.unidade}` : ""}`);
        }
        return { ...person, allocations, unavailable, details };
      });
  }, [tomorrowData, functionFilter, tomorrowTurn]);

  const toggleTomorrowPerson = (personId) => {
    const id = Number(personId);
    setSelectedPeople((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  const confirmConvocations = async () => {
    clearMessages();
    if (!tomorrowData) return;
    if (!tomorrowUnit) {
      setError("Selecione a Unidade.");
      return;
    }
    if (!selectedPeople.length && !manualName.trim()) {
      setError("Selecione pelo menos uma pessoa.");
      return;
    }

    setBusy(true);
    try {
      const result = await request(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_convocations",
          engineer,
          date: tomorrowData.date,
          unit: tomorrowUnit,
          turn: tomorrowTurn,
          collaboratorIds: selectedPeople,
          manual: manualName.trim() ? {
            name: manualName,
            isCasual: manualCasual,
            category: manualCategory,
            functionName: manualFunction,
          } : null,
        }),
      });
      if (result.warnings?.length) setError(result.warnings.join(" • "));
      if (result.created) {
        setSuccess(`${result.message}${result.delayed ? " Convocação feita após 16h registrada como atrasada." : ""}`);
      }
      setSelectedPeople([]);
      setManualName("");
      setManualCasual(false);
      setManualFunction("");
      await loadTomorrow({ silent: true });
    } catch (submitError) {
      setError(submitError.message || "Não foi possível confirmar a convocação.");
    } finally {
      setBusy(false);
    }
  };

  const filteredAvailability = useMemo(() => {
    const query = availabilitySearch.trim().toLowerCase();
    const rows = (availabilityData?.rows || []).filter((row) => {
      if (!query) return true;
      return `${row.nome || ""} ${row.funcao || ""}`.toLowerCase().includes(query);
    });
    return {
      free: rows.filter((row) => row.situacao === "Disponível"),
      occupied: rows.filter((row) => row.situacao === "Ocupado"),
      unavailable: rows.filter((row) => row.situacao === "Indisponível"),
    };
  }, [availabilityData, availabilitySearch]);

  const renderMessages = () => (
    <>
      {error ? <Notice type="danger">{error}</Notice> : null}
      {success ? <Notice type="success">{success}</Notice> : null}
    </>
  );

  const renderToday = () => {
    const engineers = todayData?.engineers || FALLBACK_ENGINEERS;
    const units = todayData?.units || [];

    return (
      <>
        <div className="filter-row today-filters">
          <Field label="Engenheiro">
            <Select value={engineer} onChange={(event) => { clearMessages(); setEngineer(event.target.value); setUnit(""); }}>
              {engineers.map((name) => <option key={name}>{name}</option>)}
            </Select>
          </Field>
          <Field label="Unidade">
            <Select value={unit} onChange={(event) => { clearMessages(); setUnit(event.target.value); }} disabled={!units.length}>
              {units.length ? units.map((name) => <option key={name}>{name}</option>) : <option value="">Nenhuma unidade convocada</option>}
            </Select>
          </Field>
          <Field label="Data">
            <input className="control" type="date" value={date} onChange={(event) => { clearMessages(); setDate(event.target.value || fortalezaISO()); setUnit(""); }} />
          </Field>
        </div>

        {renderMessages()}
        {busy && !todayData ? <LoadingBlock>Carregando equipe...</LoadingBlock> : null}

        {todayData ? (
          <>
            {todayData.retroactive ? (
              <Notice type="retroactive">Apontamento retroativo. O sistema registrará o atraso automaticamente.</Notice>
            ) : null}

            <div className="metrics-row">
              <Metric label="Equipe" value={teamMetrics.total} note="na data" />
              <Metric label="Pendentes" value={teamMetrics.pending} note={`${teamMetrics.complete} concluído(s)`} tone={teamMetrics.pending ? "warn" : ""} />
              <Metric label="Ausências" value={teamMetrics.absences} note="falta / atestado" tone={teamMetrics.absences ? "danger" : ""} />
            </div>

            <div className="section-heading">
              <div>
                <h2>Apontar equipe</h2>
                <p>Status e serviço ficam visíveis. Extra, observação e 2º serviço ficam em “Mais opções”.</p>
              </div>
              <span className="date-pill">{brDate(date)}</span>
            </div>

            <DirectInclusion
              data={todayData}
              selectedUnit={unit}
              onSaved={() => loadToday({ silent: true })}
              setGlobalError={setError}
              setGlobalSuccess={setSuccess}
              setBusy={setBusy}
            />

            {currentTeam.length ? (
              <>
                {!allDefined ? (
                  <div className="subtle-note">
                    Para marcar todos como presentes, defina primeiro a obra/serviço de todos os colaboradores exibidos.
                  </div>
                ) : null}
                <button className="button secondary full" type="button" onClick={markAllPresent} disabled={!allDefined}>
                  Marcar todos como presentes
                </button>

                <div className="team-list">
                  {currentTeam.map((row) => {
                    const key = row.context?.key || String(row.id);
                    return (
                      <TeamCard
                        key={key}
                        row={row}
                        data={todayData}
                        draft={drafts[key] || {
                          status: row.status || statusForTurn(row.turno),
                          workId: Number(row.context?.workId || 0),
                          periodMain: row.context?.period || row.turno,
                          secondWorkId: 0,
                          secondPeriod: "Tarde",
                          extra: 0,
                          observation: "",
                        }}
                        onDraftChange={(patch) => updateDraft(key, patch)}
                      />
                    );
                  })}
                </div>

                <div className="sticky-action">
                  <button className="button primary full" type="button" onClick={saveTeam} disabled={busy}>
                    {busy ? "Salvando..." : "Salvar equipe"}
                  </button>
                </div>
              </>
            ) : (
              <EmptyState>
                Nenhuma equipe encontrada para esta unidade/data. Use a inclusão acima se precisar fazer um apontamento excepcional ou retroativo.
              </EmptyState>
            )}
          </>
        ) : null}
      </>
    );
  };

  const renderTomorrow = () => {
    const data = tomorrowData;
    const units = data?.units || [];
    return (
      <>
        <div className="filter-row tomorrow-top-filter">
          <Field label="Engenheiro">
            <Select value={engineer} onChange={(event) => { clearMessages(); setEngineer(event.target.value); setSelectedPeople([]); }}>
              {(data?.engineers || FALLBACK_ENGINEERS).map((name) => <option key={name}>{name}</option>)}
            </Select>
          </Field>
        </div>
        {renderMessages()}
        {busy && !data ? <LoadingBlock>Carregando convocação...</LoadingBlock> : null}

        {data ? (
          <>
            <div className="metrics-row">
              <Metric label="Data" value={shortDate(data.date)} note="próximo dia" />
              <Metric label="Convocados" value={(data.convocations || []).length} note="por você" />
              <Metric label="Ação" value="Montar" note="e confirmar abaixo" />
            </div>

            <details className="expander">
              <summary>Já convocados · {(data.convocations || []).length}</summary>
              <div className="expander-body list-stack">
                {(data.convocations || []).length ? (data.convocations || []).map((convocation) => (
                  <div className="list-row" key={convocation.id}>
                    <div>
                      <div className="list-title">{convocation.colaborador_nome}</div>
                      <div className="list-meta">{convocation.colaborador_funcao || "—"} · {convocation.unidade || "—"} · {convocation.turno}</div>
                    </div>
                    <span className="turn-chip">{convocation.turno}</span>
                  </div>
                )) : <div className="subtle-note">Nenhum convocado ainda.</div>}
              </div>
            </details>

            <div className="section-heading">
              <div>
                <h2>Adicionar à equipe</h2>
                <p>Escolha unidade, turno e pessoas. Ao confirmar, a equipe é salva de uma vez.</p>
              </div>
              <span className="date-pill">{brDate(data.date)}</span>
            </div>

            <div className="grid grid-3">
              <Field label="Unidade">
                <Select value={tomorrowUnit} onChange={(event) => setTomorrowUnit(event.target.value)}>
                  {units.map((name) => <option key={name}>{name}</option>)}
                </Select>
              </Field>
              <Field label="Turno">
                <Select value={tomorrowTurn} onChange={(event) => { setTomorrowTurn(event.target.value); setSelectedPeople([]); }}>
                  {(data.turnOptions || FALLBACK_TURNS).map((turn) => <option key={turn}>{turn}</option>)}
                </Select>
              </Field>
              <Field label="Função">
                <Select value={functionFilter} onChange={(event) => { setFunctionFilter(event.target.value); setSelectedPeople([]); }}>
                  {tomorrowFunctions.map((name) => <option key={name}>{name}</option>)}
                </Select>
              </Field>
            </div>

            <div className="people-picker">
              <div className="picker-label">Colaboradores</div>
              <div className="people-list">
                {tomorrowPeople.map((person) => {
                  const checked = selectedPeople.includes(Number(person.id));
                  return (
                    <label className={`person-option ${person.unavailable ? "disabled" : ""}`} key={person.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={Boolean(person.unavailable)}
                        onChange={() => toggleTomorrowPerson(person.id)}
                      />
                      <span>
                        <strong>{person.nome}</strong> <small>({person.funcao || "—"})</small>
                        {person.details.length ? <em>{person.details.join(" | ")}</em> : <em>Livre no dia</em>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <Notice type="muted">
              Integral bloqueia qualquer outro turno. Manhã, Tarde e Noite podem coexistir quando não se sobrepõem. Indisponibilidade bloqueia a convocação; conflito real com outro engenheiro é registrado para tratamento administrativo.
            </Notice>

            <details className="expander">
              <summary>Adicionar nome que não está na lista</summary>
              <div className="expander-body">
                <Field label="Nome">
                  <input className="control" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Nome completo" />
                </Field>
                <label className="check-row">
                  <input type="checkbox" checked={manualCasual} onChange={(event) => setManualCasual(event.target.checked)} />
                  <span>É avulso?</span>
                </label>
                <div className="grid grid-2">
                  <Field label="Categoria da diária">
                    <Select value={manualCategory} onChange={(event) => setManualCategory(event.target.value)}>
                      <option>Profissional</option>
                      <option>Ajudante</option>
                    </Select>
                  </Field>
                  <Field label="Função (opcional)">
                    <input className="control" value={manualFunction} onChange={(event) => setManualFunction(event.target.value)} />
                  </Field>
                </div>
              </div>
            </details>

            <button className="button primary full" type="button" onClick={confirmConvocations} disabled={busy}>
              {busy ? "Salvando convocação..." : "Confirmar convocação"}
            </button>
          </>
        ) : null}
      </>
    );
  };

  const availabilityRow = (person, kind) => {
    const allocations = (person.alocacoes || []).map((a) => `${a.turno} · ${a.unidade || "—"} · ${a.engenheiro || "—"}`).join(" | ");
    const meta = kind === "free"
      ? (allocations ? `Outro turno: ${allocations}` : "Livre no dia")
      : kind === "off"
        ? (person.motivo || "Indisponível")
        : allocations;
    return (
      <div className="list-row" key={person.id}>
        <div>
          <div className="list-title">{person.nome}</div>
          <div className="list-meta">{person.funcao || "—"} · {meta}</div>
        </div>
        <span className={`availability-chip ${kind}`}>{kind === "free" ? "Livre" : kind === "off" ? "Indisp." : "Ocupado"}</span>
      </div>
    );
  };

  const renderAvailability = () => (
    <>
      <div className="grid grid-2">
        <Field label="Data">
          <input className="control" type="date" value={availabilityDate} onChange={(event) => { clearMessages(); setAvailabilityDate(event.target.value); }} />
        </Field>
        <Field label="Turno">
          <Select value={availabilityTurn} onChange={(event) => { clearMessages(); setAvailabilityTurn(event.target.value); }}>
            {FALLBACK_TURNS.map((turn) => <option key={turn}>{turn}</option>)}
          </Select>
        </Field>
      </div>
      {renderMessages()}
      {busy && !availabilityData ? <LoadingBlock>Consultando disponibilidade...</LoadingBlock> : null}

      {availabilityData ? (
        <>
          <div className="metrics-row">
            <Metric label="Disponíveis" value={availabilityData.totals?.disponiveis || 0} note={availabilityData.turn} />
            <Metric label="Ocupados" value={availabilityData.totals?.ocupados || 0} note="conflitam no turno" />
            <Metric label="Indisponíveis" value={availabilityData.totals?.indisponiveis || 0} note="bloqueados" />
          </div>

          <Field label="Buscar colaborador">
            <input className="control" type="search" value={availabilitySearch} onChange={(event) => setAvailabilitySearch(event.target.value)} placeholder="Digite um nome ou função" />
          </Field>

          <div className="section-heading compact">
            <h2>Disponíveis · {filteredAvailability.free.length}</h2>
          </div>
          <div className="list-stack">
            {filteredAvailability.free.length ? filteredAvailability.free.map((person) => availabilityRow(person, "free")) : <EmptyState>Nenhum disponível neste filtro.</EmptyState>}
          </div>

          <details className="expander">
            <summary>Ver ocupados e indisponíveis · {filteredAvailability.occupied.length + filteredAvailability.unavailable.length}</summary>
            <div className="expander-body">
              <div className="subsection-label">Ocupados no turno</div>
              <div className="list-stack">
                {filteredAvailability.occupied.length ? filteredAvailability.occupied.map((person) => availabilityRow(person, "busy")) : <div className="subtle-note">Nenhum ocupado.</div>}
              </div>
              <div className="subsection-label spaced">Indisponíveis</div>
              <div className="list-stack">
                {filteredAvailability.unavailable.length ? filteredAvailability.unavailable.map((person) => availabilityRow(person, "off")) : <div className="subtle-note">Nenhum indisponível.</div>}
              </div>
            </div>
          </details>
        </>
      ) : null}
    </>
  );

  return (
    <main className="app-page">
      <section className="portal-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">A</div>
            <div>
              <strong>APROAR</strong>
              <span>Portal do Supervisor</span>
            </div>
          </div>
          <div className="topbar-status">
            <span className="status-dot" /> Dados operacionais via Neon
          </div>
        </header>

        <div className="hero-row">
          <div>
            <div className="eyebrow">APROAR · Equipes</div>
            <h1>Minha equipe</h1>
            <p>Convocação, apontamento e disponibilidade.</p>
          </div>
          <div className="date-summary">
            <span>Hoje <strong>{shortDate(todayData?.today || fortalezaISO())}</strong></span>
            <span>Próximo <strong>{shortDate(todayData?.tomorrow || tomorrowData?.date || "")}</strong></span>
          </div>
        </div>

        <nav className="tabs" aria-label="Portal do Supervisor">
          <button className={tab === "today" ? "active" : ""} onClick={() => { clearMessages(); setTab("today"); }}>Hoje</button>
          <button className={tab === "tomorrow" ? "active" : ""} onClick={() => { clearMessages(); setTab("tomorrow"); }}>Amanhã</button>
          <button className={tab === "availability" ? "active" : ""} onClick={() => { clearMessages(); setTab("availability"); }}>Disponibilidade</button>
        </nav>

        <div className="portal-content">
          {tab === "today" ? renderToday() : null}
          {tab === "tomorrow" ? renderTomorrow() : null}
          {tab === "availability" ? renderAvailability() : null}
        </div>
      </section>
    </main>
  );
}
