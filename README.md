# GearMod

**Multi-Agent Development Workspace.** *Shift gears. Build faster.*

GearMod is a local-first desktop app that organizes work as cards on a kanban board and runs coding agents (Claude Code and Codex; Gemini CLI support is disabled for now) on each card, every one in its own isolated Git worktree.

> **License:** GearMod is **source-available** under the [PolyForm Shield License 1.0.0](LICENSE.md). You can read, use, modify and redistribute the code, except to provide a product that competes with GearMod. This is **not** an OSI-approved open source license.

<!-- TODO: add a screenshot or GIF of the board here. -->

## What it does

- **Board of cards.** Each card has a summary, specification, plan, tasks and a checklist. Planning, implementation and testing are separate steps, each with its own chat.
- **Agents in worktrees.** Starting a card creates a Git worktree and a branch named after the card type, so agents never touch your main checkout. Commits, merges and conflicts are handled from a built-in Git page.
- **Your own agent accounts.** GearMod drives the CLIs you already have installed and logged in. It has no accounts or servers of its own.
- **Tools for the agents.** A local MCP server lets agents read and update their card, ask you questions and request commits. An optional code index gives them symbol search and "what tests does this change affect".
- **Editor, terminal and file explorer** next to the board, with the card's worktree as the working folder.
- **Optional extras:** voice dictation (local whisper.cpp or Groq), a PostgreSQL database manager (experimental), Playwright CLI for the tester agent.

## Requirements

- Windows 10 or 11, x64 (the only supported platform for now)
- [Git](https://git-scm.com/)
- At least one agent CLI, installed and logged in: [Claude Code](https://docs.claude.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex)

To build from source you also need Node.js 22+ and pnpm 11+.

## Install

Download the installer (`GearMod-Setup-<version>-x64.exe`) from the project's releases page. The installer is not code-signed yet, so Windows SmartScreen may warn you the first time.

## Build from source

```powershell
pnpm install
pnpm dev          # run the app in development mode
pnpm typecheck
pnpm lint
pnpm test
```

Build a runnable executable (no installer) or the NSIS installer:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1       # apps/desktop/dist/win-unpacked/GearMod.exe
powershell -ExecutionPolicy Bypass -File .\installer.ps1   # apps/desktop/dist/GearMod-Setup-<version>-x64.exe
```

Both scripts close any running `GearMod.exe` from `win-unpacked`, because that process locks the folder.

The tests swap the native `better-sqlite3` binary between Node and Electron (`pretest` / `posttest`). Don't run them while the app is open from the same folder.

## Where your data lives

Everything is stored under `%APPDATA%\GearMod`: the SQLite database, attachments and backups are in its `data` folder. Nothing is sent anywhere by GearMod itself. Set `GEARMOD_DATA_DIR` to use another data folder (useful for development).

## Security model

Agents run with access to your disk and to whatever the selected permission mode allows. GearMod narrows what agents inherit (a minimal environment instead of your full one) and asks before risky actions, but it is **not a sandbox**. See [SECURITY.md](SECURITY.md) for what is and isn't promised, and how to report a vulnerability.

## Project layout

```
apps/desktop        Electron app (main process, preload, React renderer)
packages/contracts  Shared types and IPC contracts (Zod)
scripts             Maintenance scripts (third-party notices, Codex protocol types)
spike               Code index experiments (generates the tree-sitter queries)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under the [Contributor License Agreement](CLA.md).

## License and trademarks

- Code: [PolyForm Shield License 1.0.0](LICENSE.md). See also [NOTICE](NOTICE).
- Third-party packages keep their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- The GearMod name and logo are not licensed under the PolyForm Shield License; see [TRADEMARKS.md](TRADEMARKS.md).
