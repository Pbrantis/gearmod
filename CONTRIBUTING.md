# Contributing to GearMod

Thanks for your interest. GearMod is source-available under the [PolyForm Shield License 1.0.0](LICENSE.md).

## Set up

You need Windows 10/11, Git, Node.js 22+ and pnpm 11+.

```powershell
pnpm install
pnpm dev
```

`pnpm install` rebuilds `better-sqlite3` for Electron. Use `GEARMOD_DATA_DIR=<folder>` to run the app against a throwaway data folder.

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

### Commit messages

Write commit messages in English, with one of these prefixes:

| Prefix | Use it for |
|---|---|
| `feature:` | A new capability the user can see or use. |
| `improvement:` | An enhancement to something that exists: UX polish, performance, refactoring, docs, tests, build and tooling. |
| `bugfix:` | A fix for a defect. |
| `hotfix:` | An urgent fix for something broken in a released version. Use it rarely. |

Rules:

- **Title:** `<prefix>: <summary>`, in sentence case, up to about 72 characters, with no period at the end. Say what the change does, for example `bugfix: Center the page arrows in the table pager`.
- **Body (optional):** a blank line after the title, then short bullets with what changed and why. Wrap lines at about 100 characters.
- **One topic per commit.** If a commit needs two prefixes, split it.
- **No trailers** such as `Co-Authored-By:` and no references to other repositories' issues or pull requests.
- If a commit mixes kinds, use the prefix of the main change.

```
feature: Slash skill picker in free chats

- Typing "/" lists the agent's skills, as in card chats
- The chosen skill applies to that message
```

### Branches

Name branches after the kind of change: `feature/<short-name>`, `improvement/<short-name>`, `fix/<short-name>` or `hotfix/<short-name>`, in lowercase with hyphens (for example `fix/pager-arrows`). GearMod uses the same prefixes for the branches it creates for cards.

Open pull requests against `dev`. `main` only receives what is ready for a release.

### Pull requests

- Use the same format as a commit title for the pull request title.
- Describe what changed and why, and how you tested it (commands you ran, screens you checked).
- Keep pull requests small and focused; CI must pass before review.

## Contribution terms

Contributions are accepted under the [GearMod Contributor License Agreement](CLA.md). You keep the copyright in your work and give the project a license to use it, including in commercial editions of GearMod. On your first pull request, an automated check (the `CLA` status) asks you to accept it by replying with a comment; you only do this once. If you contribute on behalf of a company, the company must also sign the [Corporate CLA](CLA-CORPORATE.md).

For a large change, open an issue to discuss it before you send the pull request.

Only send code you wrote yourself or that you have the right to contribute. Name any third-party code and its license in the pull request.

## Trademarks

The GearMod name and logo are not covered by the code license. See [TRADEMARKS.md](TRADEMARKS.md).

## Reporting security problems

Please don't open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).
