# Security policy

## What GearMod promises

- **Your data stays on your machine.** GearMod has no server and no account. The database, attachments and backups are local files under the app's user-data folder.
- **Agents get a minimal environment.** Agent processes (Claude Code, Codex, Gemini CLI) receive a fixed allowlist of system variables (PATH, proxy, certificates, locale...) plus the variables you explicitly declare on the agent profile. Variables that look like tokens, keys or secrets are not passed unless declared. Docker Engine variables are never passed.
- **MCP configuration is not put on the command line.** Secrets in MCP server settings are written to a temporary file with restricted permissions and removed when the run ends.
- **Downloads are verified.** The dictation engine and models are downloaded from pinned versions and checked against a SHA-256 before use.
- **Risky actions ask first.** Destructive Git actions, backup restore and destructive SQL need confirmation, and the app refuses Git actions on a worktree while an agent is running in it.
- **The window is locked down.** IPC calls are accepted only from the app's own window, and every channel validates its input.

## What GearMod does not promise

- **It is not a sandbox.** An agent runs with your user's permissions and can read and write anything your account can, within the permission mode you chose. Modes such as "Ignore permissions" approve everything; use them only in a disposable environment. The app does not isolate agents from each other or from your system.
- **It does not guarantee that secrets stay out of your commits.** When an agent asks to commit, GearMod scans the files for unmistakable secrets (provider API keys, private keys, JWTs, passwords in connection URLs) and blocks the commit if it finds one. The scan is a safety net, not a guarantee: it skips files over 1 MB and binary files, does not catch secrets in other formats, and does not check commits you make yourself. Review diffs before you push.
- **The code is not audited.** Treat third-party MCP servers, skills and agent CLIs as code you are choosing to trust.
- **Optional features reach the network when you turn them on:** Groq dictation (sends audio to Groq with your key), author photos from Gravatar (sends a hash of commit e-mails; off by default), the update check for agent CLIs, and whatever MCP servers or agents you configure.

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue.

Use either of these:

- GitHub's **private vulnerability reporting** on the repository (Security tab → "Report a vulnerability").
- E-mail **sena.franciscolucas@gmail.com**.

Include the version, steps to reproduce and the impact you see.

You can expect an acknowledgement within a few days. Fixes ship in the next release; please give us a reasonable time to fix a problem before disclosing it.

## Supported versions

Only the latest release is supported.
