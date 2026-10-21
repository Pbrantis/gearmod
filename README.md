# AgentBoard

Desktop local-first para organizar tarefas e, nas próximas fatias, executar agentes de código em worktrees isoladas. Esta entrega implementa S0 (F01–F04): Electron + React + TypeScript, IPC validado, SQLite versionado e backup/restore.

## Requisitos

- Node.js 22+
- pnpm 10+
- Windows para validar o empacotamento final NSIS (previsto em F23)

## Comandos

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Os dados são gravados em `app.getPath('userData')/data`, nunca na instalação. Em desenvolvimento, defina `AGENTBOARD_DATA_DIR` para usar uma pasta isolada.
