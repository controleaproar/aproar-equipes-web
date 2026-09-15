# APROAR Equipes — migração Next.js do Portal do Supervisor

## Regra de ouro

O arquivo `app_apontamentos_v6_9_alerta_preto.py` continua sendo a fonte de verdade da lógica operacional. Esta branch não autoriza remover, condensar ou reinterpretar regras do Python.

## Branch de trabalho

`nextjs-supervisor-parity`

A produção só deve receber o Next.js depois que os fluxos Hoje / Amanhã / Disponibilidade estejam persistindo e relendo corretamente e as validações de conflito, indisponibilidade, retroativo, múltiplos serviços e auditoria estejam confirmadas.

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
- preservação dos serviços adicionais ao editar;
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

Nova função principal: `netlify/functions/supervisor.mts`.

Rota operacional: `/api/supervisor`.

Foi adicionada uma camada de proteção em `netlify/functions/supervisor-safe.mts`, usada pelo Next.js, que valida no Neon que o segundo serviço pertence à mesma unidade do serviço principal antes de delegar para a API operacional.

A função antiga `field.mts` permanece como fallback e referência de migração nesta fase.

## Neon

Em 15/09/2026 a migration `migration-paridade-python.sql` foi aplicada com sucesso na branch `main` do projeto Neon `aproar-equipes`.

A `main` agora contém as tabelas de paridade do Python:

- `obras`;
- `colaboradores`;
- `convocacoes`;
- `apontamentos`;
- `servicos_apontamento`;
- `conflitos_convocacao`;
- `indisponibilidades`;
- `auditoria`;
- `erros_sistema`.

As tabelas antigas em inglês foram mantidas; nenhuma tabela antiga foi removida.

As tabelas operacionais estavam vazias na promoção, portanto não houve registros operacionais a converter ou perder.

### Invariante de turnos

A migration `migration-regra-sobreposicao-turnos.sql` também foi aplicada na `main` em 15/09/2026.

Ela replica a regra `turnos_se_sobrepoem` do Python também no banco:

- Integral conflita com qualquer turno;
- Manhã conflita com Manhã/Integral;
- Tarde conflita com Tarde/Integral;
- Noite conflita com Noite/Integral;
- Manhã + Tarde, Manhã + Noite e Tarde + Noite podem coexistir.

O trigger `trg_aproar_bloquear_convocacao_sobreposta` está ativo na tabela `convocacoes` como última camada de proteção.

O banco não usa `UNIQUE(colaborador_id, data)`, porque essa restrição quebraria a regra de múltiplos turnos compatíveis.

## Status de deploy

O PR #1 possui Deploy Preview do Netlify com status de build bem-sucedido.

Produção continua na branch `main` do GitHub até a conclusão da validação operacional e sincronização dos cadastros reais.

## Próximos passos antes do merge final

1. validar o Deploy Preview contra a base principal já migrada;
2. popular/sincronizar obras e colaboradores reais sem mocks;
3. executar cenários de paridade do Portal do Supervisor;
4. tirar o PR de draft e promover o Next.js para produção;
5. seguir para Controladoria módulo por módulo, depois Financeiro, relatórios/indicadores e manutenção/limpeza operacional.
