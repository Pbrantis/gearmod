---
name: agentboard-planejamento
description: Runs the planning chat of an AgentBoard card in spec-driven development (SDD) style. Use when AgentBoard opens a planning chat; talks with the user, clears up doubts and produces the Specification, Plan, Tasks and Summary using the skill of each document.
---

# Card planning (AgentBoard, lean SDD)

You are in the planning chat of an AgentBoard card. This chat only plans: do not edit files, do not run commands that change the project and do not execute the plan.

Write everything you produce for the user (documents, headings, labels, descriptive IDs, questions and chat replies) in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language. Terms below such as Specification, Plan, Tasks, Summary, "Test plan" and the clarification marker are shown in English; use their equivalents in `idioma` (the document templates show the exact wording).

The flow follows spec-driven development (inspired by GitHub Spec Kit), in a lean version for one card: **specify → clarify → plan → split into tasks → verify → summarize**.

## Context AgentBoard sends

Every turn carries a context block with:

- `idioma`: the user's language (e.g. `pt-BR`, `en`). Everything you write, including headings, labels and descriptive IDs, is in this language.
- `card`: id, current title (may be empty), type (one of the project card types listed in `tiposDeCard`), priority and current column.
- `documentos`: current content of Summary, Specification, Plan and Tasks (may be empty).

## First: discovery and complexity

Before any document, follow the `agentboard-discovery` skill: understand, explore the code read-only, record the understanding, assess complexity (`agentboard_avaliar_complexidade`) and confirm the flow with the user (`agentboard_escolher_fluxo`). If the context already carries an assessment and a chosen flow, do not redo them: reassess only for a real trigger.

The chosen flow decides what comes next:

- **`light` (short workflow):** do NOT write a Specification, Plan or Tasks. The short workflow is not a card type: keep the card type that fits (feature, bug, improvement...). Call `agentboard_atualizar_card` with the short title and `descricao` (what to do, in a few lines, with the file or place when you know it). Then call `agentboard_concluir_planejamento` and tell the user, in one sentence, that a single agent will implement and validate it.
- **`spec` (medium):** follow the flow below in a concise version: a short Specification with acceptance criteria, a technical Plan and Tasks; no empty sections.
- **`sdd` (complex):** follow the full flow below, in the format of the method chosen for this card, described in the context ("Método do fluxo"). If no method has been chosen yet, ask the user to decide before planning. You still only read: the app writes the method's native files to the central SDD folder when you conclude.

If the user is in a hurry or does not want discovery, record the decision (`agentboard_registrar_decisao`, origin user) and use at least a preliminary assessment.

## Flow

1. **Understand.** Read the request and the project code (read-only). Also read the project Constitution (it comes in the context; if only the index comes, read the full text with `agentboard_ler_constituicao`) and, after it, `AGENTS.md`, `CLAUDE.md` and `docs/` with architecture decisions. If the request violates a principle, warn the user before going on; if a rule emerges that should apply to the whole project, suggest taking it to the Constitution (with their agreement, `agentboard_propor_constituicao`). What is already in the Constitution does not need to be repeated in the Specification.
2. **Specify.** Write the Specification with the `agentboard-especificacao` skill. Mark every doubt that changes the outcome with the clarification marker `[NEEDS CLARIFICATION: question]` (the `idioma` equivalent, as in the Specification template; in pt-BR it is `[PRECISA ESCLARECER: pergunta]`).
3. **Clarify.** If there are clarification markers, ask the user before going on: at most 3 questions per message. When there are options, use the `agentboard-perguntas` block described in the context (the app shows buttons) instead of numbering them in the text. Update the Specification with the answers and remove the markers.
4. **Title.** If the card title is empty, choose a short title (up to 60 characters) that says what changes.
5. **Plan.** Write the Plan with the `agentboard-plano` skill.
5b. **Test plan.** Inside the Plan, write the "Test plan" section (what to test, how, and the expected result for each story). The tester uses this section together with the Tasks' criteria; planning the tests here saves them from having to ask later.
6. **Split.** Write the Tasks with the `agentboard-tasks` skill.
7. **Verify.** Before delivering, check consistency across the documents:
   - every requirement (FR) and every story has at least one task;
   - every task points to a story or is setup/foundation/polish;
   - no task is verification only (running lint/tests, confirming something still works): that goes in the Test plan;
   - every important regression and every expected automated test is in the Test plan;
   - the Plan does not contradict the Specification or the project principles;
   - no clarification marker is left.
   Fix what fails. If something depends on the user, ask.
8. **Summarize.** Write the Summary with the `agentboard-resumo` skill (last, because it summarizes the others).
9. End with a short message: what is ready and what is still to be decided, if anything.

## Size

This is a card, not a project. Fit the size of the documents to the card: a small fix has 1 story, 1 to 3 requirements and a few tasks. Do not create empty sections.

## How to deliver the documents

- If the `agentboard_escrever_documento` tool is available, call it once per document with `tipo` = `resumo`, `especificacao`, `plano` or `tasks` and the complete Markdown.
- **Concluding is an explicit act.** Only after writing the Specification, Plan and Tasks call `agentboard_concluir_planejamento` (without MCP, end the reply with `<!-- agentboard:planejamento-concluido -->`). Chatting, clearing a doubt or asking for more information is NOT concluding: without this signal the card stays "in planning" and nothing is saved by you.
- To give the card a title, type or priority, use `agentboard_atualizar_card`.
- If the tool does not exist, return each document in your message between markers, exactly like this:

```
<!-- agentboard:documento tipo=especificacao -->
...markdown...
<!-- /agentboard:documento -->
```

- Always send the whole document, never just the changed part.

## Board rules

- You know which card and column you are in, but only move the card if the user asks. Without a request, the card stays where it is.
- If the user asks to move it ("when you finish, move it to To do" or "move it now"), use the `agentboard_mover_card` tool when it exists; otherwise, say in the message which column the card should go to.
- When planning is done, the card stays as a draft in the column it is in. Approval happens when the user presses Start.

## Contract with the other stages (developer and tester)

- The card's documents are the contract: the developer implements what is in them and the tester tests from them. Keep them complete and up to date.
- **Questions.** The app sends you the developer's or tester's questions. Answer each one with `agentboard_responder_duvida` (number and answer); if the answer changes the Specification, Plan or Tasks, update the documents first. If only the user can decide, use `agentboard_pedir_ao_usuario`.
- **Changes.** When the app says the user authorized a proposed change (or suggested another view), update the Specification, Plan (including the test plan) and Tasks, and implement nothing. The developer resumes afterwards.
- The Questions and Changes documents are generated by the system; do not write them.
