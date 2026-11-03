---
name: agentboard-specification
description: Writes the Specification document of an AgentBoard card in SDD style (user stories with priority, Given/When/Then acceptance scenarios, numbered functional requirements and measurable success criteria), without saying how to implement.
---

# Document: Specification

The Specification says **what** the card delivers and **how to know it is right**. **How to implement** goes in the Plan. The structure follows GitHub Spec Kit's specification template, lean for one card.

## Language

Write everything you produce for the user (headings, labels, descriptive IDs, text) in the language given in `idioma` (e.g. `pt-BR`, `en`). These instructions are in English; that does not change the output language. Use `templates/<idioma>.md`; if there is none, translate `templates/pt-BR.md` (the fallback the app uses), including headings, labels (Given/When/Then) and ID prefixes (FR, SC). The names below (Given/When/Then, FR, SC, the clarification marker) are the English forms; use the `idioma` equivalents shown in the template (in pt-BR: Dado/Quando/Então, RF, CS, `[PRECISA ESCLARECER: ...]`).

## Sections (in this order)

1. **Goal.** One sentence, from the point of view of whoever uses it.
2. **User stories** (required). Each story:
   - title `Story N: <short name> (Priority: P1|P2|P3)`; P1 is the minimum that already delivers value on its own (MVP);
   - one sentence "As a <role>, I want <action>, so that <benefit>";
   - **Why this priority:** one sentence;
   - **Independent test:** how to verify this story on its own;
   - **Acceptance scenarios:** numbered list in the format **Given** <state>, **When** <action>, **Then** <observable result>.
3. **Edge cases.** Questions about limits and errors ("What happens when ...?"). Remove if there are none.
4. **Functional requirements** (required). IDs `FR-001`, `FR-002`... One requirement per line, verifiable:
   - "The system MUST <capability>." or "The user MUST be able to <interaction>."
   - for triggers, use the form "WHEN <event>, the system MUST <response>."
   - a doubt that changes the outcome becomes `[NEEDS CLARIFICATION: <question>]` in the requirement itself. At most 3 markers; planning asks the user and removes the markers.
5. **Key entities.** Only if the card touches data: name, what it represents and relations, with no types or tables.
6. **Success criteria** (required). IDs `SC-001`... Measurable and technology-independent ("the user creates the card in up to 3 clicks", "no card changes column without a request").
7. **Assumptions and out of scope.** What was assumed and what this card does not do.

## Bug cards

Replace the stories with: **How to reproduce** (numbered steps), **Current behavior** and **Expected behavior**. Keep Functional requirements (what the fix guarantees) and Success criteria (including "the bug does not come back": a test that failed now passes).

## Rules

- No files, functions, libraries or tables: those belong to the Plan.
- Write so that whoever decides the product can understand it without reading code.
- Leave no section empty or "N/A": remove the optional section.

## Delivery

Send with `tipo` = `especificacao` (the `agentboard_write_document` tool or markers, as in `agentboard-planning`).
