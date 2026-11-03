## Tasks

### Phase 1: Foundation
- [ ] T001 Create the `card_documents` table and migration in `apps/desktop/src/main/migrations.ts`
  - [ ] The migration turns the old description into the Summary without losing text
  - [ ] Migration test written in `apps/desktop/src/main/database.test.ts` and passing
- [ ] T002 [P] Add the `cards:documents` channel in `packages/contracts/src/index.ts`
  - [ ] Input and output validated with Zod; invalid input is rejected

**Checkpoint:** documents are written and read by the main process.

### Phase 2: Story 1, edit the card documents (P1, MVP)
- [ ] T003 [S1] Show the 4 documents in the card editor in `apps/desktop/src/renderer/src/main.tsx`
  - [ ] The Summary, Specification, Plan and Tasks buttons switch the middle document
  - [ ] Edited text is still there after saving and reopening the card
- [ ] T004 [S1] Count the tasks on the board card
  - [ ] The card shows "2/3 tasks" counting only top-level items
  - [ ] Counting test written in `apps/desktop/src/main/projects.test.ts`

**Checkpoint:** Story 1 works on its own.

