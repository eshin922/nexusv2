# Validation operational runbook

This is the authoritative execution procedure for the
[merge-gate checklist](merge-gate.md). Commands below target Windows
PowerShell, the supported environment used to verify Slice 12.

## Prerequisites

- Node.js 22 and `npm.cmd install` completed.
- Docker Desktop with Compose.
- Playwright Chromium installed for the repository dependencies.
- Git and GitHub remotes available.
- A clean feature branch based on the expected `origin/main`.
- No production credentials in the validation shell.

## 1. Prepare and load the environment

Create the temporary file, then load it into the active PowerShell process.
The example contains local placeholders, not production secrets.

```powershell
Copy-Item .env.validation.example .env.validation.local

Get-Content .env.validation.local |
  Where-Object { $_ -and -not $_.StartsWith('#') } |
  ForEach-Object {
    $name, $value = $_.Split('=', 2)
    Set-Item -Path "Env:$name" -Value $value
  }
```

The active process requires:

- `NODE_ENV=test`, `NEXUS_ISOLATED_TEST=1`
- loopback `DATABASE_URL` and `DIRECT_URL` whose database name contains
  `nexus_validation`
- `NEXUS_AUTH_PROVIDER`, `NEXUS_HUBSPOT_PROVIDER`,
  `NEXUS_NETSUITE_PROVIDER`, `NEXUS_ARTIFACT_PROVIDER`, and
  `NEXUS_REALTIME_PROVIDER` all set to `isolated`
- a supported `NEXUS_VALIDATION_IDENTITY`
- loopback `NEXT_PUBLIC_APP_URL`
- `NEXUS_VALIDATION_RUN_ID`
- `NEXUS_VALIDATION_ARTIFACT_DIR` as the run-owned root
- `NEXUS_VALIDATION_ARTIFACT_ROOT` as its binary-artifact child
- loopback `NEXUS_VALIDATION_ARTIFACT_ORIGIN`
- `NEXUS_FAKE_HUBSPOT_LEDGER` beneath the run-owned root
- none of the production credential variables rejected by
  `src/lib/config/runtime-config.ts`

Prove the active process before any database mutation:

```powershell
npm.cmd run validation:prove-isolation
```

The command must report isolated mode, the local validation database, every
provider as isolated, credentials absent, and loopback-only networking. If
variables are absent or unsafe, the command fails before mutation. That is an
expected safety-gate rejection; correct the environment and rerun.

`validation:app`, `test:e2e`, and `test:e2e:headed` load
`.env.validation.local` themselves. The database, migration, fixture, and
isolation commands do not; they inherit this PowerShell environment.

## 2. Verify repository state

```powershell
git status -sb
git branch --show-current
git fetch origin
git rev-list --left-right --count origin/main...HEAD
git diff --check
```

Stop if the branch, base, divergence, or working tree is unexpected.

## 3. Inspect validation resource ownership

Compose normally derives its project name from the working directory. Named
resources in `docker-compose.validation.yml` can therefore collide across
worktrees even when their Compose project identities differ.

Inspect before starting or deleting anything:

```powershell
docker inspect nexus-validation-db --format '{{json .Config.Labels}}' 2>$null
docker network inspect nexus-validation --format '{{json .Labels}}' 2>$null
docker volume inspect nexus-validation-db-data --format '{{json .Labels}}' 2>$null
```

No output means the named resource is absent. Existing output must show the
expected validation service and a known Compose project. If a verified stack
belongs to another worktree's project, explicitly reuse that identity:

```powershell
$env:COMPOSE_PROJECT_NAME = '<verified-project-name>'
```

During final Slice 12 verification, the existing resources belonged to
`nexusv2`, while the reconstruction worktree defaulted to
`nexusv2-val601-clean`. Inspection and explicit
`COMPOSE_PROJECT_NAME=nexusv2` allowed safe reuse. Never remove an unknown
container, network, or volume merely to resolve a collision.

Resources are owned by this run only after their project/service labels,
validation database marker, loopback binding, and run intent agree. Unknown
resources must not be changed.

## 4. Run server-free gates

```powershell
npm.cmd run test:unit
node --experimental-strip-types scripts/test-costing.ts
npm.cmd run prebuild
npx.cmd tsc --noEmit
```

Stop on the first failure and diagnose it before changing behavior.

## 5. Start, migrate, and seed

```powershell
npm.cmd run validation:db:start
npm.cmd run validation:db:migrate
npm.cmd run validation:prove-isolation
npm.cmd run validation:seed
npm.cmd run validation:fixtures:validate
```

Migration is complete only when the CLI's migration-count and `schema-ready`
assertions pass. Fixture validation must report five projects, five quotes, ten
tiers, two push records, and zero invalid external IDs for the current fixture
contract.

## 6. Start an owned server and wait for readiness

Use an external log root. Record the wrapper PID before readiness polling:

```powershell
$validationLogRoot = 'C:\Code\nexus-validation-runs\slice-12-merge-gate'
New-Item -ItemType Directory -Force -Path $validationLogRoot | Out-Null

$existingListener = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
if ($existingListener) {
  throw "Port 3100 already has a listener; prove ownership before continuing."
}

$validationServer = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'validation:app') `
  -WorkingDirectory (Get-Location).Path `
  -RedirectStandardOutput "$validationLogRoot\validation-app.stdout.log" `
  -RedirectStandardError "$validationLogRoot\validation-app.stderr.log" `
  -WindowStyle Hidden `
  -PassThru

Set-Content "$validationLogRoot\validation-app.pid" $validationServer.Id

curl.exe --silent --show-error --fail `
  --retry 120 --retry-connrefused --retry-delay 1 --max-time 130 `
  --output NUL --write-out "HTTP_STATUS=%{http_code}`n" `
  http://127.0.0.1:3100/
```

Readiness is the successful HTTP response, not elapsed sleep time. If readiness
fails, preserve both logs and enter failure cleanup.

## 7. Run exact browser suites

This helper gives every suite durable external logs and a hard 180-second outer
ceiling. Playwright gets a 90-second per-test ceiling. Zero retries is explicit
because current configuration otherwise selects one retry when `CI` is set.

```powershell
function Stop-OwnedProcessTree {
  param([Parameter(Mandatory)] [int] $RootPid)

  $processes = Get-CimInstance Win32_Process
  $owned = [System.Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($RootPid)
  do {
    $before = $owned.Count
    foreach ($process in $processes) {
      if ($owned.Contains([int]$process.ParentProcessId)) {
        [void]$owned.Add([int]$process.ProcessId)
      }
    }
  } while ($owned.Count -gt $before)

  $owned |
    Sort-Object -Descending |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

function Invoke-ValidationSuite {
  param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string[]] $Arguments
  )

  $stdout = "$validationLogRoot\$Name.stdout.log"
  $stderr = "$validationLogRoot\$Name.stderr.log"
  $process = Start-Process `
    -FilePath 'node.exe' `
    -ArgumentList $Arguments `
    -WorkingDirectory (Get-Location).Path `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden `
    -PassThru

  if (-not $process.WaitForExit(180000)) {
    Stop-OwnedProcessTree -RootPid $process.Id
    throw "$Name exceeded the 180-second outer ceiling."
  }
  if ($process.ExitCode -ne 0) {
    throw "$Name failed with exit code $($process.ExitCode). See $stdout and $stderr."
  }
}

$playwright = @(
  '--env-file=.env.validation.local',
  'node_modules/@playwright/test/cli.js',
  'test'
)
$bounds = @('--workers=1', '--retries=0', '--max-failures=1', '--timeout=90000')

Invoke-ValidationSuite 'quote-deep-links' ($playwright + @(
  'tests/e2e/smoke/quote-deep-links.spec.ts',
  '--project=read-only'
) + $bounds)

Invoke-ValidationSuite 'VAL-101' ($playwright + @(
  'tests/e2e/costing/basic-quote-persistence.spec.ts',
  '--project=costing-serial',
  '--grep=VAL-101'
) + $bounds)

Invoke-ValidationSuite 'VAL-103' ($playwright + @(
  'tests/e2e/costing/basic-quote-persistence.spec.ts',
  '--project=costing-serial',
  '--grep=VAL-103'
) + $bounds)

Invoke-ValidationSuite 'VAL-601' ($playwright + @(
  'tests/e2e/slice-12/primary-send-lifecycle.spec.ts',
  '--project=lifecycle-serial'
) + $bounds)
```

## 8. Cleanup on success or failure

Run cleanup in a `finally` path whenever this procedure is automated. First
stop only the process tree rooted at the PID recorded by this run:

```powershell
$rootPid = [int](Get-Content "$validationLogRoot\validation-app.pid")
Stop-OwnedProcessTree -RootPid $rootPid
```

Then remove fixture and Docker state through the safety-checked commands:

```powershell
npm.cmd run validation:fixtures:reset
npm.cmd run validation:db:teardown
```

Verify operational cleanup:

```powershell
if (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 3100 still has a listener.'
}

if (docker ps -a --filter 'name=^/nexus-validation-db$' --format '{{.ID}}') {
  throw 'The owned validation container remains.'
}

docker network inspect nexus-validation *> $null
if ($LASTEXITCODE -eq 0) { throw 'The owned validation network remains.' }

docker volume inspect nexus-validation-db-data *> $null
if ($LASTEXITCODE -eq 0) { throw 'The owned validation volume remains.' }
```

Remove only known temporary paths created by this run:

```powershell
Remove-Item .env.validation.local -Force -ErrorAction SilentlyContinue
Remove-Item .next, test-results, playwright-report -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path .artifacts\validation) {
  throw 'Validation artifacts remain.'
}

git diff --check
if (git status --short) {
  throw 'Working tree is not clean.'
}
```

Do not delete external durable logs until the result has been reported. Never
delete an unknown process or Docker resource without ownership proof.

## 9. Final report evidence

Record:

- branch, base/head, and divergence
- every command and pass/fail result
- unit count and browser scenario counts/runtimes
- migration/schema and fixture counts
- isolation proof and any expected safety rejection
- environment/setup failures that ran no tests
- strict browser-diagnostic result
- server PID and readiness evidence
- cleanup verification for process, port, fixtures, container, network, volume,
  artifacts, temporary files, diff check, and working tree
- paths to retained external logs
