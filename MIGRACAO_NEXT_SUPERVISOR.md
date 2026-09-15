# APROAR Equipes — migração Next.js do Portal do Supervisor

## Regra de ouro

O arquivo `app_apontamentos_v6_9_alerta_preto.py` continua sendo a fonte de verdade da lógica operacional. Esta branch não autoriza remover, condensar ou reinterpretar regras do Python.

## Branch de trabalho

`nextjs-supervisor-parity`

A branch `main` e a produção devem permanecer intactas até que:

1. a migration Neon oficial esteja aplicada;
2. o Portal do Supervisor seja testado com dados reais;
3. os fluxos Hoje / Amanhã / Disponibilidade estejam persistindo e relendo corretamente;
4. as validações de conflito, indisponibilidade, retroativo, múltiplos serviços e auditoria estejam confirmadas.

## O que foi portado nesta etapa

### Next.js

- App Router (`app/`);
- Portal do Supervisor em React;
- telas Hoje, Amanhã e Disponibilidade;
- layout responsivo para desktop e celular;
- nenhum dado operacional mockado no novo Portal.

### Hoje

- engenheiro, unidade e data;
- resumo Equipe / Pendentes / Ausências;
- aviso retroativo;
- inclusão excepcional/retroativa;
- cadastrado ou avulso;
- um ou dois serviços;
- status, serviço principal e período;
- Mais opções: extra, observação e 2º serviço;
- regra de 2º serviço na mesma unidade;
- preservação dos serviços adicionais de outras unidades ao editar;
- Marcar todos como presentes apenas com todos os serviços definidos;
- Salvar equipe em lote;
- apontamento persistido e editável;
- retroativo persistido como atraso;
- auditoria.

### Amanhã

- engenheiro;
- próximo dia automático;
- equipe já convocada;
- unidade;
- turno;
- filtro por função;
- multiseleção de colaboradores;
- inclusão manual de nome;
- opção de avulso;
- categoria Profissional/Ajudante e função opcional;
- indisponibilidade;
- conflito apenas em turnos sobrepostos;
- conflito persistido para tratamento administrativo;
- convocação após 16h registrada como atrasada quando aplicável;
- auditoria.

### Disponibilidade

- consulta por data e turno;
- busca;
- disponível / ocupado / indisponível;
- ocupação somente quando o turno consultado se sobrepõe à convocação existente.

## API

Nova função: `netlify/functions/supervisor.mts`

Rota: `/api/supervisor`

A função antiga `field.mts` foi mantida nesta fase como fallback e referência de migração. Não deve ser removida antes da validação da nova aplicação.

## Neon

O projeto Neon atual tem duas modelagens:

- `main`: tabelas antigas em inglês (`units`, `collaborators`, `convocations`, etc.);
- branch de migration: tabelas de paridade do Python (`obras`, `colaboradores`, `convocacoes`, `apontamentos`, `servicos_apontamento`, etc.).

As tabelas operacionais consultadas estão vazias neste momento, portanto não há registros operacionais no Neon a converter antes da promoção do esquema.

### Invariante de turnos

A migration `migration-regra-sobreposicao-turnos.sql` replica a regra `turnos_se_sobrepoem` do Python também no banco:

- Integral conflita com qualquer turno;
- Manhã conflita com Manhã/Integral;
- Tarde conflita com Tarde/Integral;
- Noite conflita com Noite/Integral;
- Manhã + Tarde, Manhã + Noite e Tarde + Noite podem coexistir.

O banco não usa `UNIQUE(colaborador_id, data)`, porque essa restrição quebraria a regra de múltiplos turnos compatíveis.

## Antes de mergear

- validar build/deploy preview do Next.js;
- aplicar/testar a migration completa em branch Neon de teste;
- validar criação de placeholder por unidade;
- popular/sincronizar obras e colaboradores reais;
- executar cenários de paridade do Portal do Supervisor;
- somente então promover o esquema e configurar produção.

## Depois do Portal do Supervisor

Seguir a ordem do handoff oficial:

1. Controladoria módulo por módulo;
2. Financeiro;
3. relatórios/indicadores;
4. auditoria/manutenção/limpeza operacional completa.
