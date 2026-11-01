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

## Empacotamento Windows

```powershell
# Executável para teste rápido (sem instalador)
powershell -ExecutionPolicy Bypass -File .\build.ps1

# Instalador NSIS para distribuição
powershell -ExecutionPolicy Bypass -File .\installer.ps1
```

O executável de teste fica em `apps/desktop/dist/win-unpacked/AgentBoard.exe`; o instalador fica em `apps/desktop/dist/AgentBoard-Setup-<versão>-x64.exe`.

Os dados são gravados em `app.getPath('userData')/data`, nunca na instalação. Em desenvolvimento, defina `AGENTBOARD_DATA_DIR` para usar uma pasta isolada.
