/* APROAR Equipes — Portal do Supervisor fiel à lógica operacional do Python.
   Este arquivo substitui somente o comportamento do Portal do Supervisor. */

(function () {
  const state = window.__aproarFieldState || {
    engineer: "VICTOR",
    date: "",
    unit: "",
    todayData: null,
    todayKey: "",
    tomorrowData: null,
    tomorrowKey: "",
    availabilityData: null,
    availabilityKey: "",
    loading: false,
    error: "",
    success: "",
    incType: "Cadastrado",
    incSecond: false,
    incUnit1: "",
    incUnit2: "",
    tomorrowTurn: "Integral",
    tomorrowUnit: "",
    availabilityDate: "",
    availabilityTurn: "Integral",
    availabilitySearch: "",
  };
  window.__aproarFieldState = state;

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function localISO() {
    const d = new Date();
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }

  function br(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function dmISO(iso) {
    if (!iso) return "";
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  }

  function realWorks(data, unit) {
    return (data?.works || []).filter(
      (w) => String(w.unidade || "") === String(unit || "") &&
        !String(w.nome || "").toUpperCase().startsWith("A DEFINIR NO APONTAMENTO")
    );
  }

  function realUnits(data) {
    return [...new Set(
      (data?.works || [])
        .filter((w) => !String(w.nome || "").toUpperCase().startsWith("A DEFINIR NO APONTAMENTO"))
        .map((w) => String(w.unidade || "").trim())
        .filter(Boolean)
    )].sort();
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Não foi possível concluir esta operação.");
    return data;
  }

  function clearMessages() {
    state.error = "";
    state.success = "";
  }

  function messageHTML() {
    let html = "";
    if (state.error) html += `<div class="alert danger">${esc(state.error)}</div>`;
    if (state.success) html += `<div class="alert success">${esc(state.success)}</div>`;
    return html;
  }

  async function loadToday(force = false) {
    if (!state.date) state.date = localISO();
    const key = `${state.engineer}|${state.date}`;
    if (!force && state.todayData && state.todayKey === key) return;
    state.loading = true;
    state.error = "";
    renderField();
    try {
      const data = await api(
        `/api/field?op=bootstrap&engineer=${encodeURIComponent(state.engineer)}&date=${encodeURIComponent(state.date)}`
      );
      state.todayData = data;
      state.todayKey = key;
      if (!state.unit || !(data.units || []).includes(state.unit)) {
        state.unit = (data.units || [])[0] || "";
      }
      if (!state.incUnit1) state.incUnit1 = state.unit || realUnits(data)[0] || "";
      if (!state.incUnit2) state.incUnit2 = state.incUnit1;
    } catch (e) {
      state.error = e.message || "Não foi possível carregar a equipe.";
      state.todayData = null;
    } finally {
      state.loading = false;
      renderField();
    }
  }

  async function loadTomorrow(force = false) {
    const key = state.engineer;
    if (!force && state.tomorrowData && state.tomorrowKey === key) return;
    state.loading = true;
    state.error = "";
    renderField();
    try {
      const data = await api(
        `/api/field?op=tomorrow&engineer=${encodeURIComponent(state.engineer)}`
      );
      state.tomorrowData = data;
      state.tomorrowKey = key;
      const units = realUnits(data);
      if (!state.tomorrowUnit || !units.includes(state.tomorrowUnit)) {
        state.tomorrowUnit = units[0] || "";
      }
    } catch (e) {
      state.error = e.message || "Não foi possível carregar a convocação.";
      state.tomorrowData = null;
    } finally {
      state.loading = false;
      renderField();
    }
  }

  async function loadAvailability(force = false) {
    if (!state.availabilityDate) {
      const tomorrow = state.todayData?.tomorrow;
      state.availabilityDate = tomorrow || localISO();
    }
    const key = `${state.availabilityDate}|${state.availabilityTurn}`;
    if (!force && state.availabilityData && state.availabilityKey === key) return;
    state.loading = true;
    state.error = "";
    renderField();
    try {
      state.availabilityData = await api(
        `/api/field?op=availability&date=${encodeURIComponent(state.availabilityDate)}&turn=${encodeURIComponent(state.availabilityTurn)}`
      );
      state.availabilityKey = key;
    } catch (e) {
      state.error = e.message || "Não foi possível consultar a disponibilidade.";
      state.availabilityData = null;
    } finally {
      state.loading = false;
      renderField();
    }
  }

  function selectHTML(id, label, options, value, attrs = "") {
    return `<div class="field"><label>${esc(label)}</label><select id="${id}" class="control" ${attrs}>${
      options.map((o) => {
        const val = typeof o === "object" ? o.value : o;
        const lab = typeof o === "object" ? o.label : o;
        return `<option value="${esc(val)}" ${String(val) === String(value) ? "selected" : ""}>${esc(lab)}</option>`;
      }).join("")
    }</select></div>`;
  }

  function inputHTML(id, label, value, type = "text", attrs = "") {
    return `<div class="field"><label>${esc(label)}</label><input id="${id}" class="control" type="${type}" value="${esc(value || "")}" ${attrs}></div>`;
  }

  function metricHTML(label, value, note = "", cls = "") {
    return `<div class="metric ${cls}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></div>`;
  }

  function statusDefault(turn) {
    if (turn === "Manhã") return "Presente (Só Manhã)";
    if (turn === "Tarde") return "Presente (Só Tarde)";
    return "Presente (Integral)";
  }

  function cardHTML(row, data, unit) {
    const works = realWorks(data, unit);
    const workOptions = [{ value: "", label: "— Selecione a Obra/Serviço —" }]
      .concat(works.map((w) => ({ value: w.id, label: w.nome })));

    const principalId = row.principal?.obra_id || (
      row.obra_real_definida ? row.obra_id : ""
    );
    const periodMain = row.principal?.periodo || row.turno || "Integral";
    const additional = (row.adicionais || [])[0] || null;
    const secondId = additional?.obra_id || "";
    const secondPeriod = additional?.periodo || "Tarde";
    const extra = Number(row.valor_extra || row.apontamento?.valor_extra || 0);
    const observation = row.apontamento?.observacao ?? row.observacao_livre ?? "";
    const isPresent = !["Falta", "Atestado"].includes(String(row.status || ""));
    let warning = "";

    if (row.apontamento?.retroativo) {
      warning = `<div class="alert warn">🟧 Apontamento realizado com atraso — salvo em data posterior ao serviço.</div>`;
    } else if (data.retroactive) {
      warning = `<div class="alert warn">🟧 Este apontamento é retroativo. Ao salvar, o atraso será registrado.</div>`;
    }

    const otherAllocation = row.outra_convocacao_no_dia
      ? `<div class="caption" style="margin-top:10px">Este colaborador já possui outra convocação neste dia. Cada turno/unidade será apontado separadamente.${
          (row.outras_alocacoes || []).length
            ? ` Outra alocação: ${(row.outras_alocacoes || []).map((x) => `${esc(x.turno)} • ${esc(x.unidade)} • ${esc(x.engenheiro)}`).join(" | ")}.`
            : ""
        }</div>`
      : "";

    const secondService = row.outra_convocacao_no_dia
      ? otherAllocation
      : `<div style="margin-top:10px"><b style="font-size:12px">Outro serviço na mesma Unidade (opcional)</b></div>
         <div class="fields g2 mt8">
           ${selectHTML(`field-second-work-${row.id}`, "2º serviço", workOptions, secondId)}
           ${selectHTML(`field-second-period-${row.id}`, "Período do 2º serviço", data.periodOptions || ["Integral","Manhã","Tarde","Noite","Outro"], secondPeriod)}
         </div>`;

    return `<div class="field-card" data-convocation-id="${row.id}">
      <div class="field-card-head">
        <div>
          <div class="field-person-name">${esc(row.colaborador_nome)}</div>
          <div class="field-person-meta">${esc(row.colaborador_funcao || "-")} · ${esc(unit)} · Convocado: ${esc(row.turno)}</div>
        </div>
        <div class="field-chip">${esc(row.turno)}</div>
      </div>
      ${warning}
      <div class="fields g2 mt8">
        ${selectHTML(
          `field-status-${row.id}`,
          "Status",
          data.statusOptions || [],
          row.status || statusDefault(row.turno),
          `onchange="fieldStatusChanged(${row.id})"`
        )}
        ${selectHTML(`field-work-${row.id}`, "Obra / Serviço principal", workOptions, principalId)}
      </div>
      <details class="expander more">
        <summary>Mais opções</summary>
        <div class="expander-body">
          <div class="fields g2">
            ${selectHTML(`field-period-${row.id}`, "Período do serviço principal", data.periodOptions || [], periodMain)}
            ${inputHTML(
              `field-extra-${row.id}`,
              "Extra (R$)",
              extra ? String(extra) : "0",
              "number",
              `min="0" step="10" ${isPresent ? "" : "disabled"}`
            )}
          </div>
          <div class="mt8">
            ${inputHTML(`field-observation-${row.id}`, "Observação / justificativa", observation)}
          </div>
          ${secondService}
        </div>
      </details>
    </div>`;
  }

  function inclusionHTML(data) {
    const allUnits = realUnits(data);
    const fixedUnit = !data.retroactive && state.unit;
    const unit1 = fixedUnit || state.incUnit1 || allUnits[0] || "";
    const unit2 = state.incUnit2 || unit1;
    const works1 = realWorks(data, unit1);
    const works2 = realWorks(data, unit2);

    const peopleOptions = [{ value: "", label: "— Selecione —" }].concat(
      (data.collaborators || []).map((c) => ({
        value: c.id,
        label: `${c.nome} (${c.funcao || "-"})`,
      }))
    );

    return `<details class="expander">
      <summary>Adicionar colaborador / avulso ao apontamento</summary>
      <div class="expander-body">
        <div class="caption">Use esta área para apontamento retroativo ou inclusão excepcional. Você pode lançar um ou dois serviços para a mesma pessoa.</div>

        ${selectHTML(
          "field-inc-type",
          "Tipo",
          ["Cadastrado", "Avulso"],
          state.incType,
          `onchange="fieldInclusionType(this.value)"`
        )}

        <div id="field-inc-registered" style="${state.incType === "Cadastrado" ? "" : "display:none"}">
          ${selectHTML("field-inc-person", "Colaborador", peopleOptions, "")}
        </div>

        <div id="field-inc-casual" style="${state.incType === "Avulso" ? "" : "display:none"}">
          ${inputHTML("field-inc-name", "Nome do avulso", "", "text", `placeholder="Nome completo"`)}
          <div class="fields g2 mt8">
            ${selectHTML("field-inc-category", "Categoria da diária", ["Profissional","Ajudante"], "Profissional")}
            ${inputHTML("field-inc-function", "Função (opcional)", "")}
          </div>
        </div>

        <div style="margin-top:12px"><b style="font-size:12px">1º serviço</b></div>
        ${
          fixedUnit
            ? `<div class="caption">Unidade do serviço: <b>${esc(fixedUnit)}</b></div>`
            : selectHTML(
                "field-inc-unit1",
                "Unidade do 1º serviço",
                allUnits,
                unit1,
                `onchange="fieldIncUnit1(this.value)"`
              )
        }
        <div class="fields g2 mt8">
          ${selectHTML(
            "field-inc-work1",
            "Obra / Serviço",
            [{value:"",label:"— Selecione —"}].concat(works1.map((w)=>({value:w.id,label:w.nome}))),
            ""
          )}
          ${selectHTML("field-inc-turn1", "Turno", ["Manhã","Tarde","Noite","Integral"], "Manhã")}
        </div>

        <label class="checkrow mt12">
          <input id="field-inc-second" type="checkbox" ${state.incSecond ? "checked" : ""} onchange="fieldToggleSecond(this.checked)">
          Adicionar 2º serviço
        </label>

        <div id="field-inc-second-wrap" style="${state.incSecond ? "" : "display:none"}">
          <div style="margin-top:12px"><b style="font-size:12px">2º serviço</b></div>
          ${
            fixedUnit
              ? ""
              : selectHTML(
                  "field-inc-unit2",
                  "Unidade do 2º serviço",
                  allUnits,
                  unit2,
                  `onchange="fieldIncUnit2(this.value)"`
                )
          }
          <div class="fields g2 mt8">
            ${selectHTML(
              "field-inc-work2",
              "Obra / Serviço",
              [{value:"",label:"— Selecione —"}].concat(works2.map((w)=>({value:w.id,label:w.nome}))),
              ""
            )}
            ${selectHTML("field-inc-turn2", "Turno", ["Manhã","Tarde","Noite","Integral"], "Tarde")}
          </div>
        </div>

        <button class="btn full mt12" onclick="fieldAddDirect()">Adicionar ao apontamento</button>
      </div>
    </details>`;
  }

  function todayHTML() {
    const data = state.todayData;

    if (!state.date) state.date = localISO();

    if (!data) {
      return `<div class="field-top">
        ${selectHTML("field-engineer", "Engenheiro", ["EDUARDO","GABRIEL","GUSTAVO","JOEL","NETO","PAULO","SOARES","VICTOR"], state.engineer, `onchange="fieldEngineerChanged(this.value)"`)}
        ${inputHTML("field-date", "Data", state.date, "date", `onchange="fieldDateChanged(this.value)"`)}
      </div>
      ${messageHTML()}
      <div class="alert info">${state.loading ? "Carregando equipe..." : "Selecione os filtros para carregar a equipe."}</div>`;
    }

    const units = data.units || [];
    if (!state.unit || !units.includes(state.unit)) state.unit = units[0] || "";

    const team = state.unit
      ? (data.team || []).filter((x) => String(x.unidade || "") === state.unit)
      : [];

    const total = team.length;
    const completed = team.filter((x) => x.obra_real_definida).length;
    const pending = Math.max(0, total - completed);
    const absences = team.filter((x) => ["Falta","Atestado"].includes(String(x.status))).length;
    const allDefined = Boolean(team.length) && team.every((x) => x.obra_real_definida);

    const globalRetro = data.retroactive
      ? `<div class="alert warn" style="background:#FFF7BF;color:#111827;border-color:#F3E38B">
           Apontamento retroativo. O sistema registrará o atraso automaticamente.
         </div>`
      : "";

    const unitControl = units.length
      ? selectHTML("field-unit", "Unidade", units, state.unit, `onchange="fieldUnitChanged(this.value)"`)
      : `<div class="field"><label>Unidade convocada</label><input class="control" disabled value="${data.retroactive ? "Sem convocação nesta data" : "Nenhuma unidade convocada"}"></div>`;

    const cards = team.map((row) => cardHTML(row, data, state.unit)).join("");

    return `<div class="field-top">
      ${selectHTML("field-engineer", "Engenheiro", data.engineers || [], state.engineer, `onchange="fieldEngineerChanged(this.value)"`)}
      ${unitControl}
      ${inputHTML("field-date", "Data", state.date, "date", `onchange="fieldDateChanged(this.value)"`)}
    </div>

    ${messageHTML()}
    ${globalRetro}

    <div class="field-summary">
      ${metricHTML("Equipe", total, "na data")}
      ${metricHTML("Pendentes", pending, `${completed} concluído(s)`, pending ? "warn" : "")}
      ${metricHTML("Ausências", absences, "falta / atestado", absences ? "danger" : "")}
    </div>

    <div class="field-section-title">Apontar equipe</div>
    <div class="field-section-sub">Status e serviço ficam visíveis. Extra, observação e 2º serviço ficam em “Mais opções”.</div>

    ${inclusionHTML(data)}

    ${
      total
        ? `<div class="caption" style="${allDefined ? "display:none" : ""}">
             Para marcar todos como presentes, defina primeiro a obra/serviço de todos os colaboradores exibidos.
           </div>
           <button class="btn full mt8" ${allDefined ? "" : "disabled"} onclick="fieldMarkAllPresent()">Marcar todos como presentes</button>
           <form onsubmit="return false">
             ${cards}
             <div class="sticky-save"><button type="button" class="btn primary full" onclick="fieldSaveTeam()">Salvar equipe</button></div>
           </form>`
        : `<div class="alert info">Nenhuma equipe encontrada para esta data. Use a inclusão acima se precisar fazer um apontamento retroativo.</div>`
    }`;
  }

  function tomorrowHTML() {
    const data = state.tomorrowData;
    if (!data) {
      return `${messageHTML()}<div class="alert info">${state.loading ? "Carregando convocação..." : "Carregando..."}</div>`;
    }

    const units = realUnits(data);
    if (!state.tomorrowUnit || !units.includes(state.tomorrowUnit)) {
      state.tomorrowUnit = units[0] || "";
    }

    const allDayByPerson = new Map();
    for (const c of data.allDay || []) {
      const id = Number(c.colaborador_id);
      if (!allDayByPerson.has(id)) allDayByPerson.set(id, []);
      allDayByPerson.get(id).push(c);
    }

    const off = new Map((data.unavailability || []).map((x) => [Number(x.colaborador_id), x]));
    const people = (data.collaborators || []).map((p) => {
      const alloc = allDayByPerson.get(Number(p.id)) || [];
      const unavailable = off.get(Number(p.id));
      let label = `${p.nome} (${p.funcao || "-"})`;
      if (unavailable) {
        label += ` — INDISPONÍVEL: ${unavailable.motivo}`;
      } else if (alloc.length) {
        label += " — " + alloc.map((a) => `${a.turno} · ${a.engenheiro}${a.unidade ? ` / ${a.unidade}` : ""}`).join(" | ");
      }
      return { value: p.id, label, disabled: Boolean(unavailable) };
    });

    const listOptions = people.map((p) =>
      `<option value="${p.value}" ${p.disabled ? "disabled" : ""}>${esc(p.label)}</option>`
    ).join("");

    const already = (data.convocations || []).map((c) =>
      `<div class="field-list-item">
        <div><div class="field-list-name">${esc(c.colaborador_nome)}</div><div class="field-list-meta">${esc(c.colaborador_funcao || "-")} · ${esc(c.unidade || "-")} · ${esc(c.turno)}</div></div>
        <div class="field-list-side">${esc(c.turno)}</div>
      </div>`
    ).join("");

    return `${messageHTML()}
      ${selectHTML("field-tom-engineer", "Engenheiro", data.engineers || [], state.engineer, `onchange="fieldTomorrowEngineerChanged(this.value)"`)}

      <div class="field-summary">
        ${metricHTML("Data", dmISO(data.date), "próximo dia")}
        ${metricHTML("Convocados", (data.convocations || []).length, "por você")}
        ${metricHTML("Ação", "Montar", "e confirmar abaixo")}
      </div>

      <details class="expander">
        <summary>Já convocados · ${(data.convocations || []).length}</summary>
        <div class="expander-body"><div class="field-list">${already || '<div class="caption">Nenhum convocado ainda.</div>'}</div></div>
      </details>

      <div class="field-section-title">Adicionar à equipe</div>
      <div class="field-section-sub">Escolha unidade, turno e pessoas. Ao confirmar, a equipe é salva de uma vez.</div>

      ${selectHTML("field-tom-unit", "Unidade", units, state.tomorrowUnit, `onchange="stateTomorrowUnit(this.value)"`)}
      <div class="mt8">
        ${selectHTML("field-tom-turn", "Turno", ["Integral","Manhã","Tarde","Noite"], state.tomorrowTurn, `onchange="stateTomorrowTurn(this.value)"`)}
      </div>

      <div class="field mt8">
        <label>Colaboradores</label>
        <select id="field-tom-people" class="control" multiple size="8">${listOptions}</select>
      </div>

      <div class="caption">Integral bloqueia qualquer outro turno. Manhã, Tarde e Noite podem coexistir quando não se sobrepõem. Pessoas indisponíveis são bloqueadas.</div>

      <button class="btn primary full mt12" onclick="fieldConfirmConvocations()">Confirmar convocação</button>`;
  }

  function availabilityHTML() {
    const data = state.availabilityData;
    if (!state.availabilityDate) state.availabilityDate = state.todayData?.tomorrow || localISO();

    if (!data) {
      return `<div class="fields g2">
        ${inputHTML("field-av-date", "Data", state.availabilityDate, "date", `onchange="fieldAvailabilityDate(this.value)"`)}
        ${selectHTML("field-av-turn", "Turno", ["Integral","Manhã","Tarde","Noite"], state.availabilityTurn, `onchange="fieldAvailabilityTurn(this.value)"`)}
      </div>
      ${messageHTML()}
      <div class="alert info">${state.loading ? "Consultando disponibilidade..." : "Carregando..."}</div>`;
    }

    const q = String(state.availabilitySearch || "").toLowerCase();
    const rows = (data.rows || []).filter((r) =>
      !q || `${r.nome} ${r.funcao}`.toLowerCase().includes(q)
    );
    const free = rows.filter((r) => r.situacao === "Disponível");
    const occupied = rows.filter((r) => r.situacao === "Ocupado");
    const unavailable = rows.filter((r) => r.situacao === "Indisponível");

    const rowHTML = (r, kind) => {
      const allocations = (r.alocacoes || []).map(
        (a) => `${a.turno} · ${a.unidade || "-"} · ${a.engenheiro || "-"}`
      ).join(" | ");
      const meta = kind === "free"
        ? (allocations ? `Outro turno: ${allocations}` : "Livre no dia")
        : kind === "off"
          ? (r.motivo || "Indisponível")
          : allocations;
      const sideClass = kind === "free" ? "avail-ok" : kind === "off" ? "avail-off" : "avail-busy";
      const side = kind === "free" ? "Livre" : kind === "off" ? "Indisp." : "Ocupado";
      return `<div class="field-list-item">
        <div><div class="field-list-name">${esc(r.nome)}</div><div class="field-list-meta">${esc(r.funcao || "-")} · ${esc(meta)}</div></div>
        <div class="field-list-side ${sideClass}">${side}</div>
      </div>`;
    };

    return `<div class="fields g2">
      ${inputHTML("field-av-date", "Data", state.availabilityDate, "date", `onchange="fieldAvailabilityDate(this.value)"`)}
      ${selectHTML("field-av-turn", "Turno", ["Integral","Manhã","Tarde","Noite"], state.availabilityTurn, `onchange="fieldAvailabilityTurn(this.value)"`)}
    </div>
    ${messageHTML()}
    <div class="field-summary">
      ${metricHTML("Disponíveis", data.totals?.disponiveis || 0, data.turn)}
      ${metricHTML("Ocupados", data.totals?.ocupados || 0, "conflitam no turno")}
      ${metricHTML("Indisponíveis", data.totals?.indisponiveis || 0, "bloqueados")}
    </div>
    ${inputHTML("field-av-search", "Buscar colaborador", state.availabilitySearch, "search", `oninput="fieldAvailabilitySearch(this.value)"`)}
    <div class="field-section-title">Disponíveis · ${free.length}</div>
    <div class="field-list mt8">${free.map((r) => rowHTML(r, "free")).join("") || '<div class="caption">Nenhum disponível neste filtro.</div>'}</div>
    <details class="expander">
      <summary>Ver ocupados e indisponíveis · ${occupied.length + unavailable.length}</summary>
      <div class="expander-body">
        <b style="font-size:12px">Ocupados no turno</b>
        <div class="field-list mt8">${occupied.map((r) => rowHTML(r, "busy")).join("") || '<div class="caption">Nenhum ocupado.</div>'}</div>
        <b style="font-size:12px;display:block;margin-top:12px">Indisponíveis</b>
        <div class="field-list mt8">${unavailable.map((r) => rowHTML(r, "off")).join("") || '<div class="caption">Nenhum indisponível.</div>'}</div>
      </div>
    </details>`;
  }

  renderField = function () {
    if (!state.date) state.date = localISO();

    let content = "";
    if (fieldTab === "amanha") content = tomorrowHTML();
    else if (fieldTab === "disp") content = availabilityHTML();
    else content = todayHTML();

    document.getElementById("app").innerHTML = `<div class="field-shell">
      <div class="field-homebar">
        <div class="brand-logo">
          <img class="logo-img" src="https://raw.githubusercontent.com/helenacsss2002/sistema-equipes-aproar/main/logo.png" alt="APROAR">
          <div class="brand-copy"><b>APROAR</b><span>Portal do Supervisor</span></div>
        </div>
        <button class="btn ghost" onclick="goLogin()">Sair</button>
      </div>

      <div class="field-head">
        <div>
          <div class="field-kicker">APROAR · Portal do Supervisor</div>
          <div class="field-title">Minha equipe</div>
          <div class="field-sub">Convocação, apontamento e disponibilidade.</div>
        </div>
        <div class="field-date">
          Hoje<br><b>${dmISO(state.todayData?.today || localISO())}</b>
          &nbsp; · &nbsp;Próximo<br><b>${dmISO(state.todayData?.tomorrow || state.tomorrowData?.date || "")}</b>
        </div>
      </div>

      <div class="field-nav">
        <button class="field-tab ${fieldTab === "hoje" ? "active" : ""}" onclick="fieldTab='hoje';render()">Hoje</button>
        <button class="field-tab ${fieldTab === "amanha" ? "active" : ""}" onclick="fieldTab='amanha';render()">Amanhã</button>
        <button class="field-tab ${fieldTab === "disp" ? "active" : ""}" onclick="fieldTab='disp';render()">Disponibilidade</button>
      </div>

      ${content}
    </div>`;

    queueMicrotask(() => {
      if (fieldTab === "hoje") loadToday(false);
      else if (fieldTab === "amanha") loadTomorrow(false);
      else loadAvailability(false);
    });
  };

  window.fieldEngineerChanged = function (value) {
    clearMessages();
    state.engineer = value;
    state.unit = "";
    state.todayData = null;
    state.tomorrowData = null;
    loadToday(true);
  };

  window.fieldDateChanged = function (value) {
    clearMessages();
    state.date = value || localISO();
    state.unit = "";
    state.todayData = null;
    loadToday(true);
  };

  window.fieldUnitChanged = function (value) {
    clearMessages();
    state.unit = value;
    state.incUnit1 = value || state.incUnit1;
    state.incUnit2 = value || state.incUnit2;
    renderField();
  };

  window.fieldStatusChanged = function (id) {
    const status = document.getElementById(`field-status-${id}`)?.value || "";
    const extra = document.getElementById(`field-extra-${id}`);
    const present = !["Falta", "Atestado"].includes(status);
    if (extra) {
      extra.disabled = !present;
      if (!present) extra.value = "0";
    }
  };

  window.fieldMarkAllPresent = function () {
    const data = state.todayData;
    if (!data) return;
    const team = state.unit
      ? (data.team || []).filter((x) => String(x.unidade || "") === state.unit)
      : [];
    for (const row of team) {
      const el = document.getElementById(`field-status-${row.id}`);
      if (el) el.value = statusDefault(row.turno);
      fieldStatusChanged(row.id);
    }
  };

  window.fieldSaveTeam = async function () {
    clearMessages();
    const data = state.todayData;
    if (!data) return;

    const team = state.unit
      ? (data.team || []).filter((x) => String(x.unidade || "") === state.unit)
      : [];
    const items = [];

    for (const row of team) {
      const workId = Number(document.getElementById(`field-work-${row.id}`)?.value || 0);
      const secondWorkId = Number(document.getElementById(`field-second-work-${row.id}`)?.value || 0);

      if (!workId) {
        state.error = `${row.colaborador_nome}: selecione a obra/serviço.`;
        renderField();
        return;
      }
      if (secondWorkId && secondWorkId === workId) {
        state.error = `${row.colaborador_nome}: o 2º serviço deve ser diferente do principal.`;
        renderField();
        return;
      }

      items.push({
        convocationId: Number(row.id),
        status: document.getElementById(`field-status-${row.id}`)?.value,
        workId,
        periodMain: document.getElementById(`field-period-${row.id}`)?.value,
        secondWorkId: secondWorkId || null,
        secondPeriod: document.getElementById(`field-second-period-${row.id}`)?.value || "Tarde",
        extra: Number(document.getElementById(`field-extra-${row.id}`)?.value || 0),
        observation: document.getElementById(`field-observation-${row.id}`)?.value || "",
      });
    }

    state.loading = true;
    renderField();
    try {
      const result = await api("/api/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_team",
          engineer: state.engineer,
          date: state.date,
          unit: state.unit,
          items,
        }),
      });

      state.success = result.retroactive
        ? `✓ Equipe salva. O apontamento retroativo foi registrado automaticamente.`
        : `✓ Equipe salva com sucesso.`;
      state.todayData = null;
      state.todayKey = "";
      await loadToday(true);
    } catch (e) {
      state.error = e.message || "Não foi possível salvar a equipe.";
    } finally {
      state.loading = false;
      renderField();
    }
  };

  window.fieldInclusionType = function (value) {
    state.incType = value;
    renderField();
  };

  window.fieldToggleSecond = function (checked) {
    state.incSecond = Boolean(checked);
    renderField();
  };

  window.fieldIncUnit1 = function (value) {
    state.incUnit1 = value;
    if (!state.incUnit2) state.incUnit2 = value;
    renderField();
  };

  window.fieldIncUnit2 = function (value) {
    state.incUnit2 = value;
    renderField();
  };

  window.fieldAddDirect = async function () {
    clearMessages();
    const data = state.todayData;
    if (!data) return;

    const fixedUnit = !data.retroactive && state.unit;
    const unit1 = fixedUnit || document.getElementById("field-inc-unit1")?.value || state.incUnit1;
    const unit2 = fixedUnit || document.getElementById("field-inc-unit2")?.value || state.incUnit2 || unit1;

    const work1 = Number(document.getElementById("field-inc-work1")?.value || 0);
    const turn1 = document.getElementById("field-inc-turn1")?.value || "Manhã";
    const work2 = Number(document.getElementById("field-inc-work2")?.value || 0);
    const turn2 = document.getElementById("field-inc-turn2")?.value || "Tarde";

    if (!unit1) {
      state.error = "Selecione a unidade do 1º serviço.";
      renderField();
      return;
    }
    if (!work1) {
      state.error = "Selecione a obra/serviço principal.";
      renderField();
      return;
    }
    if (state.incSecond && !unit2) {
      state.error = "Selecione a unidade do 2º serviço.";
      renderField();
      return;
    }
    if (state.incSecond && !work2) {
      state.error = "Selecione a 2ª obra/serviço.";
      renderField();
      return;
    }
    if (state.incSecond && work1 === work2) {
      state.error = "O 2º serviço deve ser diferente do 1º.";
      renderField();
      return;
    }

    const body = {
      action: "add_direct",
      engineer: state.engineer,
      date: state.date,
      type: state.incType,
      collaboratorId: Number(document.getElementById("field-inc-person")?.value || 0),
      name: document.getElementById("field-inc-name")?.value || "",
      category: document.getElementById("field-inc-category")?.value || "Profissional",
      functionName: document.getElementById("field-inc-function")?.value || "",
      services: [
        { workId: work1, turn: turn1, unit: unit1 },
        ...(state.incSecond ? [{ workId: work2, turn: turn2, unit: unit2 }] : []),
      ],
    };

    state.loading = true;
    renderField();
    try {
      const result = await api("/api/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      state.success = result.message || "✓ Apontamento salvo com sucesso.";
      state.incSecond = false;
      state.todayData = null;
      state.todayKey = "";
      await loadToday(true);
    } catch (e) {
      state.error = e.message || "Não foi possível incluir o colaborador.";
    } finally {
      state.loading = false;
      renderField();
    }
  };

  window.fieldTomorrowEngineerChanged = function (value) {
    clearMessages();
    state.engineer = value;
    state.tomorrowData = null;
    state.todayData = null;
    loadTomorrow(true);
  };

  window.stateTomorrowUnit = function (value) {
    state.tomorrowUnit = value;
  };

  window.stateTomorrowTurn = function (value) {
    state.tomorrowTurn = value;
  };

  window.fieldConfirmConvocations = async function () {
    clearMessages();
    const data = state.tomorrowData;
    if (!data) return;

    const selected = [...(document.getElementById("field-tom-people")?.selectedOptions || [])]
      .map((x) => Number(x.value))
      .filter(Boolean);

    if (!state.tomorrowUnit || !selected.length) {
      state.error = "Selecione a Unidade e pelo menos um colaborador.";
      renderField();
      return;
    }

    state.loading = true;
    renderField();
    try {
      const result = await api("/api/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_convocations",
          engineer: state.engineer,
          date: data.date,
          unit: state.tomorrowUnit,
          turn: state.tomorrowTurn,
          collaboratorIds: selected,
        }),
      });

      if (result.warnings?.length) {
        state.error = result.warnings.join(" • ");
      }
      if (result.created) {
        state.success = `✓ ${result.created} convocação(ões) salva(s).${
          result.delayed ? " A convocação feita após 16h foi registrada como atrasada." : ""
        }`;
      }
      state.tomorrowData = null;
      state.tomorrowKey = "";
      await loadTomorrow(true);
    } catch (e) {
      state.error = e.message || "Não foi possível confirmar a convocação.";
    } finally {
      state.loading = false;
      renderField();
    }
  };

  window.fieldAvailabilityDate = function (value) {
    clearMessages();
    state.availabilityDate = value;
    state.availabilityData = null;
    loadAvailability(true);
  };

  window.fieldAvailabilityTurn = function (value) {
    clearMessages();
    state.availabilityTurn = value;
    state.availabilityData = null;
    loadAvailability(true);
  };

  window.fieldAvailabilitySearch = function (value) {
    state.availabilitySearch = value || "";
    renderField();
    const input = document.getElementById("field-av-search");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };
})();
