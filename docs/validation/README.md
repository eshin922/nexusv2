# Nexus validation harness

The validation harness is a first-class regression subsystem for quote
construction, pricing, lifecycle, permissions, artifacts, and integrations.
It is isolated from production identity, providers, storage, and network.

## Documentation map

- **Governing philosophy:** [VALIDATION_PRINCIPLES.md](VALIDATION_PRINCIPLES.md)
- **Architectural reasons:** [architecture.md](architecture.md) and
  [ADRs 008–012](../adr/008-validation-environment-isolation.md)
- **Sole acceptance checklist:** [merge-gate.md](merge-gate.md)
- **Authoritative execution procedure:**
  [operational-runbook.md](operational-runbook.md)
- **Minimal entry path:** [quick-start.md](quick-start.md)
- **Failure diagnosis:** [troubleshooting.md](troubleshooting.md)
- **Ownership and upkeep:** [maintenance.md](maintenance.md)
- **Scenario inventory:** [scenario-registry.md](scenario-registry.md)
- **Adding tests:** [writing-tests.md](writing-tests.md)
- **Current state and Slice 13 transition:**
  [slice-12-handover.md](slice-12-handover.md)
- **Institutional knowledge:** [lessons-learned.md](lessons-learned.md)

Detailed commands belong only in the merge gate and operational runbook. Other
documents link to those authorities instead of creating alternate checklists.

Every harness architecture, fixture, provider, scenario, CI, policy, or
maintenance change must update this directory in the same change set.

The subsystem is jointly owned by the maintainers of costing, quote lifecycle,
provider integrations, and CI. Changes require review from the owner of the
protected business promise and from a harness maintainer.
