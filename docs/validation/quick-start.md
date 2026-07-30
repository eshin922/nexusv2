# Quick start

Prerequisites: Node.js 22, npm dependencies installed with `npm.cmd install`,
Docker Desktop with Compose, Chromium installed for Playwright, and
an initially clean working tree.

Create and explicitly load the isolated environment:

```powershell
Copy-Item .env.validation.example .env.validation.local
Get-Content .env.validation.local |
  Where-Object { $_ -and -not $_.StartsWith('#') } |
  ForEach-Object {
    $name, $value = $_.Split('=', 2)
    Set-Item -Path "Env:$name" -Value $value
  }
npm.cmd run validation:prove-isolation
```

Creating `.env.validation.local` alone is not sufficient for database,
migration, fixture, or isolation npm commands; those inherit the active shell.
`validation:app`, `test:e2e`, and `test:e2e:headed` load the file themselves.
If the proof rejects missing or unsafe variables, no product test or mutation
ran—the safety gate worked.

Before Docker startup, inspect any existing `nexus-validation-db`,
`nexus-validation` network, and `nexus-validation-db-data` volume. Compose
project names default from working-directory context, so multiple worktrees can
collide on these explicit resource names. Fix `COMPOSE_PROJECT_NAME` only after
labels prove the existing project's identity and isolation; never delete an
unknown resource to clear a name collision.

For a local scenario, follow the environment and ownership steps in the
[operational runbook](operational-runbook.md), then run:

- server-free gates first;
- one unique run ID and external log/PID root, with exclusive worktree use;
- isolated database start, migrate, seed, and fixture validation;
- explicitly owned server with observable HTTP readiness;
- the selected Playwright project with one worker, zero retries, fail-fast,
  durable external logs, and hard ceilings;
- success-or-failure cleanup and residue checks.

Pre-existing generated directories and stale run roots are blockers, not
cleanup targets. The runbook records absence-before-run ownership and verifies
PID creation time plus command identity before stopping a server tree.

Use [merge-gate.md](merge-gate.md) for merge acceptance. It is the sole
authoritative checklist. Use validation—not development—when proving a
registered business promise, provider boundary, artifact, or lifecycle
contract. Use the normal development environment for exploratory feature work.
