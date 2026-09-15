CREATE TABLE IF NOT EXISTS obras (
  id BIGSERIAL PRIMARY KEY,
  unidade TEXT NOT NULL,
  nome TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_obras_nome ON obras (nome);
CREATE INDEX IF NOT EXISTS idx_obras_unidade ON obras (unidade);

CREATE TABLE IF NOT EXISTS colaboradores (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  funcao TEXT,
  valor_diaria NUMERIC(12,2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_colaboradores_nome ON colaboradores (nome);
CREATE INDEX IF NOT EXISTS idx_colaboradores_ativo ON colaboradores (ativo);

CREATE TABLE IF NOT EXISTS convocacoes (
  id BIGSERIAL PRIMARY KEY,
  obra_id BIGINT REFERENCES obras(id) ON DELETE SET NULL,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  engenheiro TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Presente (Integral)',
  valor_extra NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  turno TEXT NOT NULL DEFAULT 'Integral',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_convocacoes_data ON convocacoes (data);
CREATE INDEX IF NOT EXISTS idx_convocacoes_colab_data ON convocacoes (colaborador_id, data);
CREATE INDEX IF NOT EXISTS idx_convocacoes_eng_data ON convocacoes (engenheiro, data);
CREATE INDEX IF NOT EXISTS idx_convocacoes_obra ON convocacoes (obra_id);

CREATE TABLE IF NOT EXISTS indisponibilidades (
  id BIGSERIAL PRIMARY KEY,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  colaborador_nome_snapshot TEXT,
  motivo TEXT NOT NULL,
  inicio DATE NOT NULL,
  fim DATE NOT NULL,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  legacy_origem_id TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por TEXT
);
CREATE INDEX IF NOT EXISTS idx_indisponibilidades_colab_periodo ON indisponibilidades (colaborador_id, inicio, fim);
CREATE INDEX IF NOT EXISTS idx_indisponibilidades_ativo ON indisponibilidades (ativo);

CREATE TABLE IF NOT EXISTS conflitos_convocacao (
  id BIGSERIAL PRIMARY KEY,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  colaborador_nome_snapshot TEXT,
  data DATE NOT NULL,
  convocacao_existente_id BIGINT REFERENCES convocacoes(id) ON DELETE SET NULL,
  engenheiro_original TEXT,
  turno_original TEXT,
  unidade_original TEXT,
  engenheiro_tentativa TEXT,
  turno_tentativa TEXT,
  unidade_tentativa TEXT,
  contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolvido BOOLEAN NOT NULL DEFAULT FALSE,
  resolvido_em TIMESTAMPTZ,
  resolvido_por TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conflitos_pendentes ON conflitos_convocacao (resolvido, data);
CREATE INDEX IF NOT EXISTS idx_conflitos_colab_data ON conflitos_convocacao (colaborador_id, data);

CREATE TABLE IF NOT EXISTS apontamentos (
  id BIGSERIAL PRIMARY KEY,
  convocacao_id BIGINT NOT NULL UNIQUE REFERENCES convocacoes(id) ON DELETE CASCADE,
  data_servico DATE NOT NULL,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  engenheiro TEXT NOT NULL,
  status TEXT NOT NULL,
  valor_extra NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  apontado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  apontado_por TEXT,
  retroativo BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apontamentos_data ON apontamentos (data_servico);
CREATE INDEX IF NOT EXISTS idx_apontamentos_eng_data ON apontamentos (engenheiro, data_servico);

CREATE TABLE IF NOT EXISTS servicos_apontamento (
  id BIGSERIAL PRIMARY KEY,
  convocacao_id BIGINT NOT NULL REFERENCES convocacoes(id) ON DELETE CASCADE,
  obra_id BIGINT REFERENCES obras(id) ON DELETE SET NULL,
  obra_nome_snapshot TEXT,
  unidade_snapshot TEXT,
  periodo TEXT,
  principal BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_servicos_apontamento_conv ON servicos_apontamento (convocacao_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGSERIAL PRIMARY KEY,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  acao TEXT NOT NULL,
  usuario TEXT,
  antes JSONB,
  depois JSONB,
  contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_ocorrido ON auditoria (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria (entidade, entidade_id);

CREATE TABLE IF NOT EXISTS erros_sistema (
  id BIGSERIAL PRIMARY KEY,
  codigo TEXT,
  modulo TEXT,
  acao TEXT,
  tipo_erro TEXT,
  mensagem TEXT,
  detalhes TEXT,
  contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario TEXT,
  ambiente TEXT,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erros_ocorrido ON erros_sistema (ocorrido_em DESC);
