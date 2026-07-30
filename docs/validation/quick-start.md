# Quick start

Prerequisites: Node.js 22, npm dependencies installed with `npm.cmd install`,
Docker Desktop with Compose, Chromium installed for Playwright, and
`.env.validation.local` created from `.env.validation.example` using loopback
URLs and fake credentials.

Supported database and fixture commands:

```powershell
npm.cmd run validation:db:start
npm.cmd run validation:db:migrate
npm.cmd run validation:db:reset
npm.cmd run validation:prove-isolation
npm.cmd run validation:seed
npm.cmd run validation:fixtures:validate
npm.cmd run validation:fixtures:reset
npm.cmd run validation:db:teardown
```

Run server-free checks first:

```powershell
npm.cmd run test:unit
node --experimental-strip-types scripts/test-costing.ts
git diff --check
```

For browser checks, start/migrate/seed the isolated database and explicitly
manage the server on `127.0.0.1:3100`. Use one worker, zero retries, fail-fast,
a hard outer ceiling, and logs outside tracked paths.

```powershell
npm.cmd run validation:db:start
npm.cmd run validation:db:migrate
npm.cmd run validation:seed
npm.cmd run validation:app
node --env-file=.env.validation.local node_modules/@playwright/test/cli.js test <spec> --workers=1 --retries=0 --max-failures=1
```

On Windows, an owned Next server can hang after a passing test. Prefer an
explicit server and stop only the process tree created by the run.

Run headless by default. For headed inspection or Playwright Inspector:

```powershell
npm.cmd run test:e2e:headed -- <spec> --workers=1 --retries=0 --max-failures=1
$env:PWDEBUG="1"
npm.cmd run test:e2e -- <spec> --workers=1 --retries=0 --max-failures=1
Remove-Item Env:PWDEBUG
```

Capture a trace for a single diagnostic run without changing committed config:

```powershell
npm.cmd run test:e2e -- <spec> --workers=1 --retries=0 --max-failures=1 --trace=on
```

CI uses the same commands non-interactively, retains bounded logs/traces as job
artifacts, and tears down the isolated database after the job.
