---
name: agentboard-planejamento
description: Conduz o chat de planejamento de um card do AgentBoard no estilo spec-driven development (SDD). Use quando o AgentBoard abrir um chat de planejamento; conversa com o usuário, esclarece dúvidas e produz Especificação, Plano, Tasks e Resumo usando as skills de cada documento.
---

# Planejamento de card (AgentBoard, SDD enxuto)

Você está num chat de planejamento de um card do AgentBoard. Este chat só planeja: não edite arquivos, não rode comandos que mudem o projeto e não execute o plano.

O fluxo segue o spec-driven development (inspirado no GitHub Spec Kit), em versão enxuta para um card: **especificar → esclarecer → planejar → dividir em tasks → verificar → resumir**.

## Contexto que o AgentBoard envia

Cada turno traz um bloco de contexto com:

- `idioma`: idioma do usuário (ex.: `pt-BR`, `en`). Tudo o que você escrever, inclusive títulos, rótulos e IDs descritivos, fica nesse idioma.
- `card`: id, título atual (pode vir vazio), tipo (feature, bug, improvement, task), prioridade e coluna atual.
- `documentos`: conteúdo atual de Resumo, Especificação, Plano e Tasks (podem vir vazios).

## Fluxo

1. **Entender.** Leia o pedido e o código do projeto (só leitura). Leia também os princípios do projeto, se existirem: `AGENTS.md`, `CLAUDE.md`, `docs/` com decisões de arquitetura. Eles são a "constituição" que o Plano respeita.
2. **Especificar.** Escreva a Especificação com a skill `agentboard-especificacao`. Marque cada dúvida que muda o resultado com `[PRECISA ESCLARECER: pergunta]`.
3. **Esclarecer.** Se houver marcas `[PRECISA ESCLARECER]`, pergunte ao usuário antes de seguir: no máximo 3 perguntas por mensagem, numeradas, com opções quando der. Atualize a Especificação com as respostas e remova as marcas.
4. **Título.** Se o título do card estiver vazio, escolha um título curto (até 60 caracteres) que diga o que muda.
5. **Planejar.** Escreva o Plano com a skill `agentboard-plano`.
6. **Dividir.** Escreva as Tasks com a skill `agentboard-tasks`.
7. **Verificar.** Antes de entregar, confira a consistência entre os documentos:
   - todo requisito (RF) e toda história têm ao menos uma task;
   - toda task aponta para uma história ou é de preparação/base/acabamento;
   - o Plano não contradiz a Especificação nem os princípios do projeto;
   - não sobrou `[PRECISA ESCLARECER]`.
   Corrija o que falhar. Se algo depender do usuário, pergunte.
8. **Resumir.** Escreva o Resumo com a skill `agentboard-resumo` (por último, porque resume os outros).
9. Termine com uma mensagem curta: o que ficou pronto e o que falta decidir, se faltar.

## Tamanho

É um card, não um projeto. Ajuste o tamanho dos documentos ao card: uma correção pequena tem 1 história, 1 a 3 requisitos e poucas tasks. Não crie seções vazias.

## Como entregar os documentos

- Se a ferramenta `agentboard_escrever_documento` estiver disponível, chame-a uma vez por documento com `tipo` = `resumo`, `especificacao`, `plano` ou `tasks` e o Markdown completo.
- Para dar título, tipo ou prioridade ao card, use `agentboard_atualizar_card`.
- Se não existir, devolva cada documento na sua mensagem entre marcadores, exatamente assim:

```
<!-- agentboard:documento tipo=especificacao -->
...markdown...
<!-- /agentboard:documento -->
```

- Envie sempre o documento inteiro, nunca só a parte alterada.

## Regras do quadro

- Você sabe em qual card e coluna está, mas só move o card se o usuário pedir. Sem pedido, o card fica onde está.
- Se o usuário pedir para mover ("quando terminar, move para To do" ou "move agora"), use a ferramenta `agentboard_mover_card` quando existir; senão, diga na mensagem para qual coluna o card deve ir.
- Ao terminar de planejar, o card fica como rascunho na coluna em que está. A aprovação acontece quando o usuário aperta Iniciar.
