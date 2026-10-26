---
name: agentboard-discovery
description: Discovery de uma demanda no AgentBoard (discovery-intake). Use no começo do chat livre ou do planejamento de um card para entender o pedido, explorar o código só com leitura, registrar o entendimento, avaliar a complexidade em seis dimensões e recomendar o fluxo (curto, spec leve ou SDD).
---

# Discovery da demanda (AgentBoard)

Objetivo: transformar uma conversa informal em requisitos claros o bastante para planejar ou implementar, sem perder decisões e sem gerar documentação antes da hora. Não é um formulário: converse.

## 1. Entender

- Identifique o objetivo, o problema/motivação, o que entra e o que fica fora, restrições e requisitos implícitos (segurança, desempenho, compatibilidade, dados existentes).
- Pergunte só o que muda o resultado: até 3 perguntas por mensagem, com o bloco `agentboard-perguntas` quando houver opções.
- Não suponha detalhes técnicos que o código responde: explore antes de perguntar.

## 2. Explorar o código (barato e só leitura)

- Comece por buscas (Grep/Glob, `rg`, nomes de símbolos) e leia só os trechos relevantes. Não leia o workspace inteiro e não mande arquivos grandes para o contexto.
- Se o contexto já trouxer uma "Exploração do código" válida para a versão atual, reaproveite. Explore de novo só quando ela estiver DESATUALIZADA ou a demanda mudar.
- Use um subagente explorador (ex.: Explore do Claude Code) só quando a busca for ampla de verdade; o custo extra precisa compensar.
- Procure: módulos e repositórios afetados, implementações parecidas, contratos/APIs, dependências e testes existentes.
- Registre o resultado com `agentboard_registrar_exploracao` (resumo compacto + evidências com caminho e linha). O app guarda a versão do código junto.

## 3. Registrar o entendimento

Chame `agentboard_registrar_entendimento` com objetivo, motivação, escopo, exclusões, critérios de aceite, pendências, contexto técnico (caminhos reais) e `prontidao` (`pronto` ou `precisa_esclarecer`). Chame de novo só quando algo relevante mudar.

Decisões que o usuário tomar no chat: `agentboard_registrar_decisao` com `origem: "usuario"`. Recomendações suas: `origem: "agente"` (o usuário aprova no card). Para trocar uma decisão, use `substitui`.

## 4. Avaliar a complexidade

Chame `agentboard_avaliar_complexidade` com uma nota de 0 a 3 por dimensão e uma justificativa objetiva (fato verificável, não raciocínio interno):

| Dimensão | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| escopo | 1 arquivo | poucos arquivos de um módulo | vários módulos | vários repositórios ou sistema todo |
| acoplamento | isolado | 1 dependência | contratos compartilhados | muda contratos públicos/dados |
| incerteza | tudo claro | 1 detalhe aberto | requisitos parciais | objetivo ainda vago |
| risco | nenhum | regressão local | dados, segurança ou dinheiro tocados | perda de dados, segurança ou produção |
| novidade | padrão do projeto | variação conhecida | tecnologia nova para o projeto | sem precedente |
| validacao | teste óbvio | teste unitário | integração/E2E | difícil reproduzir |

- Sem evidências ainda (antes de explorar), marque `preliminar: true` e `confianca: "baixa"`.
- Liste `riscos_criticos` à parte da nota; risco 3 nunca vai para o fluxo curto.
- Informe evidências (`file`, `commit`, `message`, `test`, `api`...) com caminho/linha.
- Reavalie só com `gatilho` real (`requirements-changed`, `new-dependency`, `risk`, `architecture`, `scope`, `failures`). O app recusa avaliações iguais à atual.

## 5. Recomendar o fluxo

O app devolve a pontuação e o fluxo recomendado. Apresente em uma ou duas frases (pontos, nível, principal motivo) e pergunte ao usuário, com botões, se segue o recomendado ou outro:

- `light` (simples): tarefa pequena; implementar e validar, sem Especificação/Plano/Tasks.
- `spec` (média): Especificação objetiva, Plano e Tasks do AgentBoard.
- `sdd` (complexa): método configurado do projeto (SDD do AgentBoard, Spec Kit, OpenSpec ou personalizado), descrito no contexto.

Depois da resposta, chame `agentboard_escolher_fluxo` com `confirmado_pelo_usuario: true`. Se o usuário corrigir alguma premissa, registre a decisão e reavalie com o gatilho certo; a avaliação anterior continua no histórico.
