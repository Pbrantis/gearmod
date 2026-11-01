---
name: agentboard-resumo
description: Writes the Summary document of an AgentBoard card. Use when planning ends, when pausing and when finishing an execution, to say in a few lines what the card is, where it stands, task progress and the next step.
---

# Document: Summary

The Summary is what the user reads first, on the board card and when opening the card. It says what is happening now. It is the only document that does not come from Spec Kit: it summarizes the other three.

## Language

Write everything you produce for the user (labels, status, text) in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language. Use `templates/<idioma>.md`; if there is none, translate `templates/pt-BR.md` (the fallback the app uses), including the labels.

## Rules

- **Status:** one of these: Draft, Plan ready, Running, Paused, Done (translated into the language of `idioma`; the template shows the exact wording).
- **Text:** 2 to 4 sentences, up to 600 characters: what changes for whoever uses it, why it matters and what is missing. Do not repeat the Specification or list files.
- **Stories:** one line with the stories and priorities (e.g. "S1 Edit documents (P1) · S2 Count tasks (P2)", in the language of `idioma`).
- **Progress:** "x of y tasks done", counting only the top-level tasks of the Tasks document.
- **Next step:** one concrete action and whose it is ("You: review the tasks", "Agent: run Phase 2", in the language of `idioma`).
- If a clarification marker is still in the Specification, say so in the text.
- Rewrite the whole Summary on every update; it always reflects the current state.

## Delivery

Send with `tipo` = `resumo` (the `agentboard_escrever_documento` tool or markers, as in `agentboard-planejamento`).
