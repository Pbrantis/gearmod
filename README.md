# AgentBoard

A local-first desktop app that organizes work as cards on a kanban board and runs coding agents (Claude Code, Codex, Gemini CLI) on each card, every one in its own isolated Git worktree.

> **License:** source-available under the [PolyForm Shield License 1.0.0](LICENSE). You can read, use, modify and redistribute the code, except to build a product that competes with AgentBoard. This is **not** an OSI-approved open source license.

<!-- TODO: add a screenshot or GIF of the board here. -->

## What it does

- **Board of cards.** Each card has a summary, specification, plan, tasks and a checklist. Planning, implementation and testing are separate steps, each with its own chat.
- **Agents in worktrees.** Starting a card creates a Git worktree and branch (`agentboard/*`) so agents never touch your main checkout. Commits, merges and conflicts are handled from a built-in Git page.
- **Your own agent accounts.** AgentBoard drives the CLIs you already have installed and logged in. It has no accounts or servers of its own.
- **Tools for the agents.** A local MCP server lets agents read and update their card, ask you questions and request commits. An optional code index gives them symbol search and "what tests does this change affect".
- **Editor, terminal and file explorer** next to the board, with the card's worktree as the working folder.
- **Optional extras:** voice dictation (local whisper.cpp or Groq), a PostgreSQL database manager (experimental), Playwright CLI for the tester agent.

## Requirements

- Windows 10 or 11, x64 (the only supported platform for now)
- [Git](https://git-scm.com/)
- At least one agent CLI, installed and logged in: [Claude Code](https://docs.claude.com/en/docs/claude-code), [Codex](https://github.com/openai/codex) or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

To build from source you also need Node.js 22+ and pnpm 11+.

## Install

Download the installer (`AgentBoard-Setup-<version>-x64.exe`) from the project's releases page. The installer is not code-signed yet, so Windows SmartScreen may warn you the first time.

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
powershell -ExecutionPolicy Bypass -File .\build.ps1       # apps/desktop/dist/win-unpacked/AgentBoard.exe
powershell -ExecutionPolicy Bypass -File .\installer.ps1   # apps/desktop/dist/AgentBoard-Setup-<version>-x64.exe
```

Both scripts close any running `AgentBoard.exe` from `win-unpacked`, because that process locks the folder.

The tests swap the native `better-sqlite3` binary between Node and Electron (`pretest` / `posttest`). Don't run them while the app is open from the same folder.

## Where your data lives

Everything is stored under the app's user-data folder (`%APPDATA%\@agentboard\desktop\data` by default): the SQLite database, attachments and backups. Nothing is sent anywhere by AgentBoard itself. Set `AGENTBOARD_DATA_DIR` to use another folder (useful for development).

## Security model

Agents run with access to your disk and to whatever the selected permission mode allows. AgentBoard narrows what agents inherit (a minimal environment instead of your full one) and asks before risky actions, but it is **not a sandbox**. See [SECURITY.md](SECURITY.md) for what is and isn't promised, and how to report a vulnerability.

## Project layout

```
apps/desktop      Electron app (main process, preload, React renderer)
packages/contracts  Shared types and IPC contracts (Zod)
docs              Design notes and plans
scripts           Maintenance scripts (third-party notices, Codex protocol types)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[PolyForm Shield License 1.0.0](LICENSE). Third-party packages keep their own licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
