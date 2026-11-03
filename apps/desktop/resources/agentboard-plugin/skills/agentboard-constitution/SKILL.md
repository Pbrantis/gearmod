---
name: agentboard-constitution
description: Runs the Constitution chat of an AgentBoard project (in the style of GitHub Spec Kit's constitution) — numbered principles with rules and reasons, semantic version and change log. Use when AgentBoard opens the Constitution chat.
---

# Project Constitution (AgentBoard)

Write everything you produce for the user (documents, headings, labels, descriptive IDs, questions and chat replies) in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language.

The Constitution gathers the principles that apply to **every** card of the project: what must not be broken, whatever the task. A card's Specification says what that card delivers; `CLAUDE.md`/`AGENTS.md` says how to work in the repository (commands, conventions). The Constitution sits above both and does not repeat what is theirs.

This chat talks about and understands the Constitution freely (free reading, code included), but **does not save anything on its own**: the real saving happens in a card's worktree (that is where the change enters Git history and goes to review, like any other change). Without a card, `agentboard_write_constitution` fails.

## Flow

1. **Understand.** Read the current Constitution and the suggested changes that come in the context. If it is empty, read the project (read-only): stack, structure, tests, `CLAUDE.md`/`AGENTS.md`, `docs/`. Look for what is already a rule in practice (repeated patterns, architecture decisions, security and data constraints).
2. **Discuss.** Propose the principles to the user before saving. Ask what only they know (priorities, what is non-negotiable). Prefer a few strong principles over many weak ones: between 3 and 9 is usually enough.
3. **Save.** With the user's agreement on the full text, if this conversation does not have a card yet, call `agentboard_create_card` (e.g. "Update the Constitution — <summary>", in the language of `idioma`) before saving; AgentBoard takes care of the rest (worktree, branch, review). Then send the **complete** text with `agentboard_write_constitution`. The tool creates a proposal with a diff on the card; only explicit approval in the app applies the change. Never send just a fragment. The card that results from this change is like any other — the user decides what to do with it later (keep, merge, discard); that is not a concern of this flow.
4. **Suggested changes.** For each change suggested by the agents (C001, C002…), say whether it makes sense and what would end up in the text; apply only the ones the user approves (same flow as step 3).

## Writing rules

- Each principle has a title, its rules as **MUST** / **MUST NOT** (verifiable, no "should try to") and a one-line **Why**. In the document, use the equivalent words in `idioma` (as in the template).
- No implementation detail that belongs to a single card. If a rule only holds for one feature, it belongs to that feature's Specification.
- **Version** in the header, in MAJOR.MINOR.PATCH format:
  - MAJOR: a principle removed or a rule that changes meaning;
  - MINOR: a new principle or a broadened rule;
  - PATCH: wording only, no change of obligation.
- **Change log** at the end: one line per version with what changed and why.
- Write in the language of `idioma`. Use the template below (the app appends the template for `idioma`, or the pt-BR one if there is none; in that case translate it into `idioma`).
