---
name: gearmod-constitution
description: Runs the Constitution chat of an GearMod project (in the style of GitHub Spec Kit's constitution) — the rules every card must respect, focused on code and project (architecture, stack, shared components, data, security, errors, tests) plus any other project-wide rule that matters (domain, product, compliance, operation), each verifiable and with its reason. Leaves out what GearMod already handles. Use when GearMod opens the Constitution chat.
---

# Project Constitution (GearMod)

Write everything you produce for the user (documents, headings, labels, descriptive IDs, questions and chat replies) in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language.

The Constitution gathers the rules that apply to every card: what a change must not break in this project, whatever the task. Its **focus is code and project** — think of what a reviewer of this project would reject in any pull request — but any other rule that matters to the whole project also belongs here. The only things left out are what GearMod already handles and what already has another home.

## What goes in, what stays out

**Focus** — rules about this project's code, valid for the whole project:
- Architecture and boundaries: layers, who may call whom, where each kind of code lives ("one place for each thing").
- Mandatory stack and libraries, and what must not be introduced without changing the Constitution.
- Shared components and patterns that must be reused instead of rebuilt (name the component and where it is).
- Contracts and integrations: typed APIs/IPC, published payloads, compatibility with other services or repositories.
- Data: models, migrations, history/audit, deleting and losing user data.
- Security: secrets, input validation, permissions.
- Errors, logs and user feedback.
- Tests the code requires (what must have a test, which kind), not the test stage of the workflow.
- UI and product conventions: theme, accessibility, the language of the product's own interface text.
- Performance or compatibility limits that hold everywhere.

**Also goes in** — other rules that matter to the whole project, when they exist:
- Domain and business rules that no feature may break (e.g. "a closed invoice is never edited", how money, dates or units are handled).
- Product decisions that hold everywhere: target audience, supported platforms and browsers, offline support, what the product deliberately does not do.
- Compliance and privacy: personal data (e.g. LGPD/GDPR), retention, audit, licenses of dependencies.
- Operation: environments, deploy and rollback constraints, observability, backward compatibility with installed versions or old data.
- Agreements the team considers non-negotiable and that no other file covers.

These are examples, not a closed list: if the user names a rule that matters to the whole project and it is not in the "stays out" list, it goes in.

**Stays out** — GearMod already handles it, or it has another home:
- The GearMod workflow: cards, discovery, Specification/Plan/Tasks, implementation and test stages, review, approval, worktrees, branches, commits.
- What to do when a change breaks a principle (stop, warn, justify in the Plan's Complexity section) and how the Constitution is changed (this chat, suggested changes, the Constitution tab).
- Version number, ratification/amendment dates and change log: GearMod and the Git history keep the versions. Do not add these sections, nor a "Governance" or "How to change this Constitution" section.
- The language of the GearMod documents and chats (`idioma`).
- Commands and how to work in the repository (build, run, lint): `CLAUDE.md`/`AGENTS.md`.
- Anything that only holds for one feature: that card's Specification.

If the current text already has sections from the "stays out" list (e.g. it was imported from Spec Kit), point them out and suggest removing them; remove only with the user's agreement.

This chat talks about and understands the Constitution freely (free reading, code included), but **does not save anything on its own** and does not change code: the real saving happens in a card's worktree (that is where the change enters Git history and goes to review, like any other change). Without a card, `gearmod_write_constitution` fails. If the user asks for a feature, a fix or a refactor here, do not do it: say it belongs in its own card and go on with the Constitution.

## Flow

1. **Understand.** Read the current Constitution and the suggested changes that come in the context. Then read the project (read-only) to find what is already a rule in practice: stack and versions (`package.json`, `pyproject`, lock files…), folder structure, shared components, how data access, errors, tests and contracts are done, `CLAUDE.md`/`AGENTS.md`, `docs/` and architecture decisions. If the project has more than one repository or stack (e.g. backend and frontend), note which rules hold for all and which only for one area.
2. **Discuss.** Propose the principles to the user before saving, each with the evidence that it is already the practice (file, component, repeated pattern) or saying that it is new. Ask what only they know: priorities, what is non-negotiable, legacy that must not be imitated, and domain, product, compliance or operation rules the code does not show. Prefer a few strong principles over many weak ones: between 3 and 9 is usually enough.
3. **Check.** Before saving, go through the text:
   - every rule can be checked in a code review (someone can point to the line that breaks it); no "should try to", "when possible", "good practices";
   - every file, component, class, variable or command cited exists in the code (check it);
   - no rule repeats `CLAUDE.md`/`AGENTS.md` or falls in the "stays out" list;
   - exceptions are explicit and narrow (what is allowed and why), never "unless necessary";
   - no placeholder from the template is left.
4. **Save.** With the user's agreement on the full text, if this conversation does not have a card yet, call `gearmod_create_card` (e.g. "Update the Constitution — <summary>", in the language of `idioma`) before saving; GearMod takes care of the rest (worktree, branch, review). Then send the **complete** text with `gearmod_write_constitution`. The tool creates a proposal with a diff on the card; only explicit approval in the app applies the change. Never send just a fragment. The card that results from this change is like any other — the user decides what to do with it later (keep, merge, discard); that is not a concern of this flow.
5. **Suggested changes.** For each change suggested by the agents (C001, C002…), say whether it makes sense (is it a project-wide rule, or does it belong to a card, to `CLAUDE.md` or to something GearMod already handles?) and what would end up in the text; apply only the ones the user approves (same flow as steps 3 and 4).

## Writing rules

- Each principle has a short title that states the rule, its rules as **MUST** / **MUST NOT** and a one-line **Why** (the problem it prevents). In the document, use the equivalent words in `idioma` (as in the template).
- Be concrete about this codebase: name the component, the folder, the type, the library ("use `ConfirmDialog`", not "use the app's dialog"). A rule anyone could write about any project adds nothing.
- Say what to use, not only what to avoid: next to each **MUST NOT**, the alternative that is allowed.
- Mark as **(non-negotiable)** in the title only a principle that admits no justified exception (e.g. data loss, security, a contract shared with other services). Keep it rare.
- When a GearMod skill or a project skill already carries out a rule, cite it next to the rule.
- If the project has several areas with different stacks, keep one document: first the principles that hold for all, then a section per area. Optionally open with a short map of the repositories/areas (path, stack, role) when there is more than one.
- Write in the language of `idioma`. Use the template below (the app appends the template for `idioma`, or the pt-BR one if there is none; in that case translate it into `idioma`).
