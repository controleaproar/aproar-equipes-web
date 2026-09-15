# APROAR Equipes — primeira correção de paridade

Este pacote começa a substituir o protótipo estático pela lógica operacional real do sistema Python.

## O que esta etapa restaura no Portal do Supervisor
- aviso e registro de apontamento retroativo;
- inclusão excepcional de colaborador cadastrado ou avulso;
- um ou dois serviços na inclusão;
- dois serviços no mesmo turno no mesmo apontamento;
- Manhã + Tarde/Noite compatíveis como registros separados;
- Integral conflita com qualquer outro turno;
- bloqueio por indisponibilidade;
- conflito entre supervisores registrado para o Paulo;
- validação de obra/serviço e do 2º serviço;
- extra zerado para Falta/Atestado;
- 2º serviço oculto quando já há outra convocação no mesmo dia;
- Salvar equipe em lote;
- disponibilidade por data/turno;
- convocação do próximo dia com registro de atraso após 16h.

A migração SQL foi preparada/testada em branch temporária do Neon, mas deve ser aplicada ao banco principal somente após confirmação explícita.
