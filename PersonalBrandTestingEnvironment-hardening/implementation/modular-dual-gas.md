# Implementation Plan: Modular dual-GAS applications

## Selected Design And Constraints

The selected design is Option 2, `modular-dual-gas`. We will keep the existing GitHub Pages deployment, separate member and administrator LIFF applications, separate GAS web apps, public config shape, Spreadsheet schema, request IDs, retry semantics, and fetch-first/bridge-fallback transport. The implementation may reorganize source and internal ownership, but it must not merge LINE audiences, expose privileged configuration, migrate data, deploy an external service, or change a public action without a compatibility path.

## Source Revision And Drift Check

- Selected design evidence digest: `569429a7bbc36b4aa65966c7e94814467a34e2ffa5f53ae80ba6f5cccc4e225b`.
- Implementation revision: `32e23b995679a046f25a783647d94de3acb811b2`.
- Drift: no material source drift. The previously recorded whitespace-only `client/index.html` change is no longer present; all security-relevant evidence files match the selected design snapshot.
- Existing generated hardening artifacts are outside the source evidence directory and are not runtime inputs.

## Affected Components

- `shared/gas-api.js`: envelope-only transport with a bounded compatibility serializer.
- `client/member-api.js`: member action contract and request adapter.
- `client/script.js` plus a member composition root: lifecycle handoff without changing the public lottery facade.
- `admin/admin-api.js`, page modules, `admin/script.js`, and three admin HTML files: action contract and page-specific composition.
- `gas/client` and `gas/admin`: deployment-owned command registries, with GAS validation remaining authoritative.
- Tests, `README.md`, and `ARCHITECTURE.md`: action inventory, boot boundaries, deployment and rollback documentation.

## Ordered Work Packages

- WP1 freezes the action inventory in browser and GAS contract tests.
- WP2 introduces action-specific browser adapters and removes domain field knowledge from shared transport while retaining the current flattened wire format for deployed-GAS compatibility.
- WP3 introduces a member composition root and page-specific administrator composition modules behind current facades.
- WP4 replaces member and administrator conditional dispatch ownership with deployment-owned command registries that bind validator and handler functions while preserving fail-fast ordering.
- WP5 updates documentation and adds static performance proxies: per-entry script inventory and page-specific module loading. No unmeasured runtime speedup will be claimed.
- WP6 runs targeted, affected-module, full-suite, syntax, JSON, diff, and secrets checks and inspects the final status.

## Compatibility And Migration

The browser will continue to send action payload keys as top-level request fields so older deployed GAS versions remain compatible. The transport will copy only own payload properties, reject envelope-key collisions, and cap field count and key shape; action adapters remain responsible for selecting fields. GAS continues to ignore unparsed fields and validates every accepted field server-side.

No Spreadsheet migration is allowed. Existing response envelopes, request IDs, action names, public facades, script URLs, and LIFF configuration remain stable. New composition roots are loaded explicitly by each HTML entry and can be removed independently.

## Tactical Protections During Migration

- Unknown and cross-role actions must fail before config, LINE verification, or Sheets access.
- LINE token verification and `Admins.status` remain server-side authority.
- The browser contract is a usability and drift-control layer, never an authorization control.
- Retryable point and lottery mutations preserve their existing request ID ownership.
- The old top-level payload wire format remains until live GAS versions are explicitly coordinated in a separately authorized deployment.

## Tests And Security Validation

- Browser contract tests cover every member/admin action, allowed fields, rejected unknown fields, and envelope collision resistance.
- GAS registry tests prove action inventory, validators, handlers, fail-fast unknown action behavior, and member/admin separation.
- Existing client/admin GAS tests continue to exercise identity, authorization, idempotency, lock, schema, and projection behavior.
- Frontend structure tests prove each admin page loads only its page composition module and that lifecycle starts through a composition root.
- A secrets scan checks changed files for credential-like material.

## Performance And Resource Benchmarks

This repository has no browser benchmark harness and no production row-count or latency data. We will report only static measurements available locally: script bytes per entry page, number of loaded page modules, and test duration. A runtime performance claim requires later browser instrumentation under consistent cache/device conditions and production-like Sheet workloads.

## Rollout And Rollback

Local rollout order is browser action contracts, transport, composition roots, GAS registries, then documentation. Production rollout is not authorized here. When later authorized, the safe order remains administrator GAS, member GAS, health/version checks, then frontend.

Rollback is file-scoped: restore the previous HTML script tags and lifecycle calls, restore the transport field whitelist, and select prior GAS deployment versions. No data rollback is required because no schema or persistent-data change is permitted.

## Acceptance Criteria

- Shared transport contains no domain-specific field-name inventory.
- Every browser action is defined by exactly one member or administrator contract adapter.
- Each admin HTML entry loads only its own page composition module.
- Member and administrator GAS use separate command registries with validator and handler ownership.
- Unknown/cross-role actions still fail before privileged operations.
- Existing public behavior, data schema, request IDs, and retry behavior remain compatible.
- Targeted and full tests pass except any clearly evidenced pre-existing failure; no new failure is accepted.
- No secret, dependency, configuration, deployment, or data migration is introduced.

## Open Decisions

- A reproducible `clasp` deployment workflow remains deferred because it needs separate Google-account and credential authorization.
- Production latency, Sheet row counts, and lock contention remain unmeasured and are not blockers for this source-only modularization.
- The pre-existing `.lottery-center-button` structural CSS test is outside this implementation unless a changed file makes it relevant.

## Local Execution Result

Status: implemented in the local working tree; not deployed.

- Browser action inventories match their corresponding GAS registries: 8 member actions and 13 administrator actions.
- Shared transport no longer contains `EXTRA_FIELD_NAMES`; it rejects envelope collisions, invalid key shapes, and payloads above 32 fields while preserving the flattened GAS wire format.
- Member home, legacy member lottery, and all three administrator pages route domain requests through their application adapter.
- Two GAS projects retain separate command registries and reject cross-role actions before config, LINE verification, or Sheet access.
- Targeted action, transport, member GAS, admin GAS, and shared contract tests passed: 112/112.
- Full suite after implementation: 201/202 passed. The only failure is the baseline `lottery-center-button` CSS structural assertion documented above; no new failure remains.
- All changed JavaScript and GAS files passed syntax checks; all JSON manifests/configs parsed; workflow YAML parsed; `git diff --check` and the credential-pattern scan were clean.

Static entry bytes increased because this batch adds explicit adapters and composition roots without yet extracting the large page controllers: member home `248352 -> 252247`, legacy lottery `102264 -> 108135`, member admin `143815 -> 151413`, points admin `158771 -> 166367`, and lottery admin `146841 -> 154439` bytes. This is an ownership/security modularization result, not a runtime performance improvement. Runtime latency remains unmeasured.
