# Contributing to AgentBoard

Thanks for your interest. AgentBoard is source-available under the [PolyForm Shield License 1.0.0](LICENSE).

## Set up

You need Windows 10/11, Git, Node.js 22+ and pnpm 11+.

```powershell
pnpm install
pnpm dev
```

`pnpm install` rebuilds `better-sqlite3` for Electron. Use `AGENTBOARD_DATA_DIR=<folder>` to run the app against a throwaway data folder.

## Before you open a pull request

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

- `pnpm test` swaps the native `better-sqlite3` binary for Node and back again (`pretest` / `posttest`). Close the app if it was started from the same folder, and let the command finish.
- A change that alters behavior should come with a test when practical.
- Don't commit build output, local data or secrets.

## Code style

- TypeScript, strict. Match the surrounding code: naming, comment density, idioms.
- UI text goes through the i18n dictionaries (`useT()` / `tr()` in the renderer, `tm()` in the main process), in English and Brazilian Portuguese. Don't hard-code user-facing strings, and don't make the UI depend on the wording of a message: use a code (see `packages/contracts/src/error-codes.ts`).
- Keep the IPC surface small and validated: every channel has a Zod contract in `packages/contracts`.

## Commits and pull requests

- Small, focused commits with a clear message.
- Describe what changed and why in the pull request, and how you tested it.

## Contribution terms

<!-- TODO(maintainer): decide between a CLA and a DCO sign-off and describe it here before accepting outside contributions. -->

The terms for contributions (CLA or DCO) are still to be defined. Until then, please open an issue to discuss a change before sending a large pull request.

## Reporting security problems

Please don't open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
