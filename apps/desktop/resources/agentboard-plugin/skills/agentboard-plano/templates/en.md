## Plan

### Summary
<main requirement and technical approach in 2 or 3 sentences>

### Technical context
- **Language/version:** <e.g. TypeScript 5, Electron, React 19>
- **Primary dependencies:** <...>
- **Storage:** <e.g. local SQLite (better-sqlite3) or N/A>
- **Testing:** <e.g. Vitest, `pnpm test`>
- **Platform:** <e.g. Windows 11, desktop app>
- **Constraints:** <e.g. renderer without Node access; IPC validated with Zod>

### Principles check
- ✅ <project principle that applies>: <how the plan respects it>
- ⚠️ <principle the plan does not respect>: <why; see Complexity>

### Decisions
- **Decision:** <what was decided>
  **Rationale:** <why>
  **Alternatives rejected:** <what was considered and why not>

### Data model
- <new or changed table/field>; migration: <what happens to existing data>

### Contracts
- `<channel or endpoint>`: input <...>; output <...>; validation <...>

### Affected areas
- `<real/path/file.ts>`: <what changes>
- `<new/path.ts>` (new): <what it is for>

### Risks
- <what can break>: <how to avoid it>

### How to validate
- `<project test command>`
- Story 1: <manual step that proves the story>

### Complexity
| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| <...> | <...> | <...> |
