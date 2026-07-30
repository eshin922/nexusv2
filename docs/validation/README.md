# Nexus validation harness

The validation harness is a first-class regression subsystem for quote
construction, pricing, lifecycle, permissions, artifacts, and integrations.
It is isolated from production identity, providers, storage, and network.

Start with [quick-start.md](quick-start.md). Architecture and extension rules
are in [architecture.md](architecture.md) and [writing-tests.md](writing-tests.md).
The authoritative scenario inventory is
[scenario-registry.md](scenario-registry.md).

Every harness architecture, fixture, provider, scenario, CI, policy, or
maintenance change must update this directory in the same change set.

The subsystem is jointly owned by the maintainers of costing, quote lifecycle,
provider integrations, and CI. Changes require review from the owner of the
protected business promise and from a harness maintainer.
