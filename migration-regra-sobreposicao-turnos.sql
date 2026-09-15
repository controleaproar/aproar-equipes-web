-- APROAR Equipes — invariantes de turno no banco
-- Fonte de verdade: app_apontamentos_v6_9_alerta_preto.py / turnos_se_sobrepoem
--
-- Regra:
-- - Integral conflita com qualquer turno.
-- - Manhã conflita com Manhã/Integral.
-- - Tarde conflita com Tarde/Integral.
-- - Noite conflita com Noite/Integral.
-- - Turnos distintos não integrais podem coexistir no mesmo dia.
--
-- O Portal registra o conflito administrativo antes da tentativa de INSERT.
-- Este trigger é a última camada de proteção para impedir gravações inválidas
-- feitas por qualquer outro caminho.

CREATE OR REPLACE FUNCTION aproar_normalizar_turno(valor TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS 'SELECT CASE
  WHEN UPPER(TRIM(COALESCE(valor, ''Integral''))) IN (''MANHÃ'', ''MANHA'') THEN ''MANHA''
  WHEN UPPER(TRIM(COALESCE(valor, ''Integral''))) = ''TARDE'' THEN ''TARDE''
  WHEN UPPER(TRIM(COALESCE(valor, ''Integral''))) = ''NOITE'' THEN ''NOITE''
  ELSE ''INTEGRAL''
END';

CREATE OR REPLACE FUNCTION aproar_turnos_sobrepoem(turno_a TEXT, turno_b TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS 'SELECT
  aproar_normalizar_turno(turno_a) = ''INTEGRAL''
  OR aproar_normalizar_turno(turno_b) = ''INTEGRAL''
  OR aproar_normalizar_turno(turno_a) = aproar_normalizar_turno(turno_b)';

CREATE OR REPLACE FUNCTION aproar_bloquear_convocacao_sobreposta()
RETURNS TRIGGER
LANGUAGE plpgsql
AS 'DECLARE
  conflito RECORD;
BEGIN
  SELECT c.id, c.engenheiro, c.turno
  INTO conflito
  FROM convocacoes c
  WHERE c.colaborador_id = NEW.colaborador_id
    AND c.data = NEW.data
    AND c.id <> COALESCE(NEW.id, -1)
    AND aproar_turnos_sobrepoem(c.turno, NEW.turno)
  ORDER BY c.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = ''23505'',
      MESSAGE = FORMAT(
        ''Convocação sobreposta: colaborador já possui convocação %s (%s, %s) nesta data.'',
        conflito.id,
        COALESCE(conflito.engenheiro, ''-''),
        COALESCE(conflito.turno, ''Integral'')
      );
  END IF;

  RETURN NEW;
END';

DROP TRIGGER IF EXISTS trg_aproar_bloquear_convocacao_sobreposta ON convocacoes;

CREATE TRIGGER trg_aproar_bloquear_convocacao_sobreposta
BEFORE INSERT OR UPDATE OF colaborador_id, data, turno
ON convocacoes
FOR EACH ROW
EXECUTE FUNCTION aproar_bloquear_convocacao_sobreposta();
