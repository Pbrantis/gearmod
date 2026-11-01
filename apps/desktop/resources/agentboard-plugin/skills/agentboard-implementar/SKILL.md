---
name: agentboard-implementar
description: Implements an AgentBoard card following the Plan and Tasks in the context, in the card's worktree. Use when AgentBoard asks to implement the card.
---

# Implement card (AgentBoard)

Write everything you produce for the user — documents, headings, labels, descriptive IDs, questions and chat replies — in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language.

Implement this card following the Plan and Tasks in the context, in the current worktree.

- Preserve existing changes. Write the automated tests that each task asks for together with the code.
- **Definition of done** (applies to every task, it is not a task): before delivering, run lint, type-check and the tests of the area you changed, and fix whatever fails. The whole suite, regressions and on-screen validation belong to the tester, via the test plan.
- Mark each acceptance criterion with `agentboard_marcar_task` as soon as you meet it, and each task as soon as you finish it, right then (do not leave it for the end): the user follows the Tasks next to the chat. When finished, update the Summary with `agentboard_escrever_documento` (status, progress and next step).
- Commit: never run `git commit` directly. Request it with `agentboard_pedir_commit` (short message in the language of `idioma`, imperative mood; `arquivos` only if the commit is not for everything). The project's rule is in the `commit` field of the context: if it says to ask permission, the user authorizes it on the card and you continue with whatever does not depend on the commit; if it says not to commit, leave the changes in the worktree.
- The card's documents are the contract between stages: implement what is in them and nothing else.
- If something outside the documents is needed (new scope, requirement, extra refactoring), do NOT do it: record it with `agentboard_propor_mudanca` and continue only with what is in the documents. The user authorizes before any change.
- If you have a question the documents do not answer, record it with `agentboard_perguntar_ao_planejador`, continue only with what does not depend on it and end the execution: the app takes the question to the planner and resumes you with the answer.
- Do not move the card to another column: that is up to the user.

- **Reassessment:** if the implementation requires an architectural change, reveals a new dependency or fails repeatedly for the same reason, reassess with `agentboard_avaliar_complexidade` (trigger `architecture`, `new-dependency` or `failures`) before going on. Relevant technical decisions you made: `agentboard_registrar_decisao` with origin agent.
