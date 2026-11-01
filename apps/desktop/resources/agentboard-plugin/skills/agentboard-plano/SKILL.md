---
name: agentboard-plano
description: Writes the Plan document of an AgentBoard card in SDD style (technical summary, technical context, project principles check, decisions with alternatives, data model, contracts, affected areas, risks and validation), based on the project's real code.
---

# Document: Plan

The Plan says **how** the Specification will be implemented. It is written after reading the code (read-only) and it is what the execution agent follows. The structure follows the GitHub Spec Kit plan template, trimmed down for a card.

## Language

Write everything you produce for the user — documents, headings, labels, descriptive IDs, questions and chat replies — in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language. Use `templates/<idioma>.md`; if there is none, translate `templates/pt-BR.md`, section headings included.

## Sections (in this order)

1. **Summary.** The main requirement and the technical approach in 2 or 3 sentences.
2. **Technical context.** Only what matters for this card, taken from the repository: language and version, main dependencies, storage, tests, platform, constraints. Mark anything you don't know as `[PRECISA ESCLARECER]` (needs clarification; use the equivalent marker from the template of `idioma`) and resolve it in the chat.
3. **Principles check.** Read the project's principles: first the Constitution (full text with `agentboard_ler_constituicao` if the context carries only the index), then `AGENTS.md`, `CLAUDE.md` and decisions in `docs/`. List the ones that apply and say whether the plan respects each (✅) or not (⚠️). A ⚠️ requires the Complexity section.
4. **Decisions.** Each one in the format **Decision** / **Reason** / **Alternatives rejected**.
5. **Data model.** Only if the card changes data: tables, fields, migration and what happens to existing data.
6. **Contracts.** Only if the card changes an interface (IPC, API, events, file format): name, input, output and validation.
7. **Affected areas.** Real repository paths (check that they exist) and what changes in each. A new file gets "(new)". Do not invent paths.
8. **Risks.** What can break and how to avoid it. Remove if there is no real risk.
9. **How to validate.** Commands the project already uses (tests, typecheck, lint) and the manual step that proves each P1 story.
10. **Complexity.** Only if the principles check has a ⚠️: table Violation / Why it is necessary / Simpler alternative rejected because.

## Rules

- Do not repeat the Specification; cite its IDs (`RF-001`, Story 1) when it helps.
- Do not list tasks here; they live in the Tasks document.
- Keep the plan sized to the card. Remove empty optional sections.

## Delivery

Send it with `tipo` = `plano` (tool `agentboard_escrever_documento` or markers, as described in `agentboard-planejamento`).

## Test plan

Include in the Plan a test plan section (heading `## Plano de testes` in pt-BR; use the equivalent heading in the language of `idioma`, e.g. `## Test plan`). It is the tester's script and the place for everything that is verification (none of it becomes a task):

- **Per story:** what to test, how (command or steps on screen) and the expected result.
- **Expected automated tests:** which tests the developer writes together with the tasks (file and what they cover), so the tester can check that they exist and make sense.
- **Regressions:** what already exists and must not break (e.g. "the first-access button still works").
- **Project commands:** lint, type-check and the test suite that the tester runs in full.

The tester and the developer use this section; anything missing from it becomes a question or a change proposal.
