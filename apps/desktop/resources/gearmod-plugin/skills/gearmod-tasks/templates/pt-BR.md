## Tasks

### Fase 1: Base
- [ ] T001 Criar a tabela `card_documents` e a migração em `apps/desktop/src/main/migrations.ts`
  - [ ] A migração converte a descrição antiga em Resumo sem perder texto
  - [ ] Teste da migração escrito em `apps/desktop/src/main/database.test.ts` e passando
- [ ] T002 [P] Adicionar o canal `cards:documents` em `packages/contracts/src/index.ts`
  - [ ] Entrada e saída validadas com Zod; entrada inválida é rejeitada

**Ponto de verificação:** os documentos são gravados e lidos pelo processo main.

### Fase 2: História 1, editar os documentos do card (P1, MVP)
- [ ] T003 [H1] Mostrar os 4 documentos no editor do card em `apps/desktop/src/renderer/src/main.tsx`
  - [ ] Os botões Resumo, Especificação, Plano e Tasks trocam o documento do meio
  - [ ] O texto editado continua lá depois de salvar e reabrir o card
- [ ] T004 [H1] Contar as tasks no card do quadro
  - [ ] O card mostra "2/3 tasks" contando só os itens de primeiro nível
  - [ ] Teste da contagem escrito em `apps/desktop/src/main/projects.test.ts`

**Ponto de verificação:** a História 1 funciona sozinha.

