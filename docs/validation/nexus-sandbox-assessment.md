# Nexus sandbox — what exists, what would need building

**Assessment only. Nothing proposed as a next action.**

**Headline: most of this already exists.** Nexus has a working isolated harness — a
containerised Postgres, a provider-isolation layer covering five external systems, a
migration and fixture CLI, and a runbook that starts the real application against it and runs
browser suites. The question is therefore not *"build a sandbox"* but **"promote a validation
harness into a development environment"**, which is a materially smaller and differently
shaped piece of work.

Effort is in the same unit as the capability scope: **governed phases of the size this
repository ships** (≈5–14 files, 200–1,600 insertions, one PR). Measurements in
`od-032-capability-scope.md` §1.

---

## 1 · What already exists

### 1.1 Database isolation — **built**

`docker-compose.validation.yml` runs `postgres:16-alpine` as `nexus-validation-db`, published
**loopback-only** on `127.0.0.1:55432`, on its own network, with a healthcheck and a named
volume.

`src/lib/config/runtime-config.ts` is a dependency-free safety module — deliberately so, "so
Next configuration, server instrumentation, validation tooling, and unit tests all evaluate
the exact same safety rules." It enforces:

- `NEXUS_ISOLATED_TEST` mode
- a required `nexus_validation` database-name marker
- a local-host allowlist (`localhost`, `127.0.0.1`, `::1`, `nexus-validation-db`)
- `FORBIDDEN_ISOLATED_CREDENTIALS` — production credentials cannot be present in isolated mode
- an `allowedNetworkHosts` set

`npm run validation:prove-isolation` exists as a command. **Isolation is asserted, not
assumed** — which is the property that matters most and the one that is hardest to add later.

### 1.2 Migration workflow — **built**

`validation:db:start` · `:migrate` · `:reset` · `:teardown`, all through
`scripts/validation/cli.ts` against `.env.validation.local`. The isolated database is migrated
by the same Drizzle journal as production, so schema drift between the two is structurally
prevented rather than policed.

### 1.3 Fixture / seed strategy — **built, and governed**

`validation:seed` · `fixtures:validate` · `fixtures:reset` via `scripts/validation/fixtures.ts`.

Beyond that, the repo carries substantial provisioning machinery already used for real walks:
`provision-cb-step10-fixture.ts`, `cert-lineage-build.ts` and its verify/company-detail
siblings, `bv011-seed-legacy.ts`, `select-fixtures.ts`, and matched cleanup scripts.

**Pattern 53 governs their content** — fixtures read from the same source production code
reads from and never invent values. That rule was promoted to standing after five instances
where an invented fixture value either hid a defect or manufactured one, so the discipline
already exists and does not need establishing.

### 1.4 Provider isolation — **built, five systems**

`PROVIDER_KIND_ENV` switches each of `auth`, `hubspot`, `netsuite`, `artifacts`, `realtime`
between `"production"` and `"isolated"`.

### 1.5 HubSpot boundary — **built**

`HUBSPOT_DEV_ACCESS_TOKEN` / `HUBSPOT_DEV_HUB_ID` alongside the production pair, with
`src/lib/hubspot.ts` routing dev Products-domain reads to the DEV sandbox. Two production
tokens stay split read/write so accidental writes are structurally impossible, not merely
unlikely.

### 1.6 NetSuite boundary — **built, and fails safe**

`NETSUITE_ENV` with a **sandbox-first guardrail**: unset or `!== "production"` resolves to
sandbox, and the account id is used to infer the environment when the variable is absent. The
dangerous default is the safe one.

### 1.7 Application under isolation — **built**

`docs/validation/operational-runbook.md` covers preparing the environment, verifying
repository state, inspecting resource ownership, server-free gates, start/migrate/seed,
**starting an owned server and waiting for readiness**, running browser suites, cleanup on
success *or failure*, and final report evidence.

So the real application already runs against the isolated database with isolated providers.
This is the single biggest thing that would otherwise need building, and it is done.

---

## 2 · What does not exist

### 2.1 A second Supabase project — **the central gap**

Documented in `CLAUDE.md`: one Supabase project serves dev **and** production. Migrations
applied locally apply to production. Manual SQL applied locally applies to production.
Realtime publication membership is shared. Data is shared.

The isolated harness sidesteps this by not using Supabase at all — it runs plain Postgres in a
container. That is correct for validation and **insufficient for development**, because three
things exist only in Supabase and are therefore untested outside production:

- **Realtime** — the postgres_changes subscriptions, the 10-binding-per-channel cap, and
  publication membership
- **Storage** — PDF persistence and quote attachments
- **The pooler** — session-mode behaviour, `pool_size`, and the dual-budget constraint that
  has already caused one production incident

**Cost: ≈1 phase** for a second Supabase project plus env plumbing. **The ongoing cost is the
real one** — see §4.

### 2.2 Clerk isolation — **partial**

`auth` has an isolation switch, but there is one Clerk instance and one
`CLERK_SECRET_KEY` / publishable key pair. A separate Clerk development instance is
straightforward (Clerk supports dev/prod instances natively) but the **Microsoft Entra
single-tenant SSO** is not: it required a tenant-admin consent grant, recorded as §0.5 catch
#75. A second instance needs its own grant, which is an IT action rather than an engineering
one.

**Cost: ≈0.5 phase engineering + one external dependency outside our control.**

### 2.3 Vercel environment — **partial**

Preview deployments exist and are in active use. What does not exist is a **long-lived
non-production environment with its own database and provider set**. Vercel supports this
directly; the work is env-var configuration plus a branch/environment convention.

One live hazard worth naming: previews built before a destructive shared-DB migration go
stale and must be retired, judged by the code-compatibility commit rather than branch age. A
separate database removes that hazard entirely.

**Cost: ≈0.5 phase.**

### 2.4 Production-like data, safely — **the hardest unsolved piece**

Two honest options, and neither is free:

- **Synthesised** — extend the existing fixture machinery to build a representative
  population. Safe by construction, and **already the direction the repo has taken**. Its
  weakness is exactly the one Pattern 53 exists to guard: synthesised data cannot surprise
  you, and several of the most valuable findings this year came from real data behaving
  unexpectedly.
- **Cloned and scrubbed** — copy production and redact. Closer to reality; introduces a
  scrubber that must be correct every time it runs, and a scrubber that silently misses a
  field is worse than no clone at all.

**Cost: ≈1–2 phases for synthesised** (extending what exists), **≈3+ phases for a scrubbed
clone** plus permanent correctness responsibility. Given Pattern 53 and the fixture library
already in place, synthesised is the cheaper and more defensible path.

### 2.5 Promotion / release workflow — **partial**

Migration ordering discipline already exists and is well-established: classify additive vs
tightening vs destructive, prove deployed-writer compatibility, expand → backfill → validate →
contract. Four OD-032 migrations have followed it without incident.

What does not exist is **schema-drift detection between two databases**. With one database
the question cannot arise; with two it becomes the primary new failure mode, and it is silent
by nature. A drift check would need building.

**Cost: ≈1 phase**, and it is the piece most likely to be under-scoped, because nothing goes
wrong until it does.

---

## 3 · Summary

| Capability | State | To close |
|---|---|---|
| Database isolation (local) | **built** | — |
| Migration workflow (isolated) | **built** | — |
| Fixture / seed | **built + governed** | — |
| Provider isolation (5 systems) | **built** | — |
| HubSpot sandbox | **built** | — |
| NetSuite sandbox | **built, fails safe** | — |
| App runs isolated + browser suites | **built** | — |
| Second Supabase project | **missing** | ≈1 phase |
| Realtime / Storage / pooler coverage | **missing** | included above |
| Clerk isolation | partial | ≈0.5 phase + Entra grant |
| Vercel non-prod environment | partial | ≈0.5 phase |
| Production-like data | partial | ≈1–2 phases (synthesised) |
| Schema-drift detection | **missing** | ≈1 phase |

**≈4–5 phases to a genuinely isolated development environment**, on top of infrastructure
that is already substantially built.

---

## 4 · Ongoing maintenance — the part that outlives the build

The build is finite. These are not, and they are the reason a sandbox is a standing decision
rather than a one-off task:

- **Two databases drift.** Every migration must reach both, and the failure is silent until
  something breaks in one and not the other.
- **Fixtures rot.** Every schema change that touches a fixture-covered table needs the
  provisioner updated, or Pattern 53's guarantee lapses quietly.
- **Two credential sets per provider** — five providers, plus Clerk and Supabase.
- **Sandbox findings need re-proving against production**, because production is where the
  data that surprises you lives.
- **The Entra consent grant** is an external dependency that will resurface on rotation.

The current single-project arrangement is documented as *"a v1 simplification appropriate for
an internal tool with ~12 users"*, with a separate project being the right answer *"once the
team grows past the foot-gun's blast radius."*

**Nothing measured here contradicts that.** The isolated harness already covers the case a
sandbox is most needed for — running the real application against a database that cannot be
production — and it covers it today, with isolation proven rather than asserted.

The gap a second Supabase project would close is specifically **Realtime, Storage and pooler
behaviour**, which the container cannot reproduce. That is a real gap. Whether it is worth
~4–5 phases plus permanent dual-maintenance during a beta is a judgement about risk appetite,
not a technical question, and this document does not make it.
