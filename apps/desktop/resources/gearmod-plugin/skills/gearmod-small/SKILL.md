---
name: gearmod-small
description: Does an GearMod card in the short workflow from start to finish with a single agent (implements and validates), with no Specification, Plan, Tasks or separate test stage. Use when GearMod asks to do a card in the short workflow.
---

# Short workflow (GearMod)

Write everything you produce for the user (the Summary, questions and chat replies) in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language.

This card is in the short workflow (`fluxo: "curto"` in the context): a localized change. A single agent does everything, to spend less. The context carries only the title and the description of what to do; there is no Specification, Plan or Tasks.

1. Read what you need from the project (only what the task touches), using the code index instead of whole files: `gearmod_code_explore` for the area, `gearmod_code_node` for one symbol and `gearmod_code_impact` before changing or renaming something (Grep only for plain text). Then make the change in the current worktree, preserving existing changes.
2. Validate what you changed: run the project's tests, lint and typecheck and review your own diff. Fix what fails.
3. When done, update the Summary with `gearmod_write_document` (type `resumo`): keep the original text and add a "Result" section (in the language of `idioma`) with what changed, how it was validated and what is left pending, if anything.
4. Do only what the description asks. If the task turns out bigger than it seemed (several modules, design decisions, real risk), stop and tell the user instead of going on: it deserves full planning.
5. If you have a doubt only the user can resolve, ask in the conversation (closed options with the `gearmod-perguntas` block) and wait.
6. Do not move the card to another column: that is up to the user.
