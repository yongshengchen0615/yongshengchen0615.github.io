# PointsCard Architecture

This document defines the boundaries that new PointsCard changes should preserve.

## Runtime topology

```text
GitHub Pages
  ├─ user/          Member LIFF surface
  ├─ admin/         Admin LIFF surface
  └─ shared/        Browser transport/auth/observability
        │
        │ LINE ID Token + action + payload
        ▼
Google Apps Script Web App
  ├─ Code.gs                           API entrypoint, authentication, authorization, rate limits
  ├─ *Service.gs                       Domain/business rules
  ├─ *Storage.gs                       Google Sheets persistence and schema contracts
  ├─ MemberPointNotificationService.gs Member notification ownership/read-state rules
  ├─ AdminPointGrantPushService.gs     Point-grant LINE side-effect orchestration
  └─ LineMessagingService.gs           LINE Messaging API infrastructure boundary
        │
        ├─ Google Sheets
        └─ LINE Messaging API
```

## Security boundaries

### Authentication

The browser obtains a LINE LIFF ID Token. Every GAS request verifies that token with LINE before trusting the identity. Client-provided member IDs, roles, permissions, or account status are never an authorization source.

### Authorization

All `admin.*` actions must pass the server-side `requireAdmin_()` check. UI button visibility is only UX and is not a security boundary.

Resource ownership checks remain inside the relevant domain service. For example, member notification acknowledgement verifies that the notification belongs to `context.identity.sub` before mutation.

### Secrets

`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` is owned by `LineMessagingService.gs` and is loaded from Apps Script Script Properties. Domain services must not read, return, log, or persist the token.

Browser configuration must never contain the Messaging API channel access token or other server secrets.

## Layer responsibilities

### `shared/common.js`

Owns browser-side LIFF bootstrap, ID-token lifecycle, API transport, request timeout/retry policy, selected-card session state, and sanitized error reporting.

Only explicitly whitelisted read-only actions may be deduplicated or automatically retried. Mutations such as point grants, stamp recording, reward claims, and notification acknowledgement must not be automatically resent by the generic transport.

### `Code.gs`

Owns the public GAS entrypoint, LINE ID-token verification, request parsing, server-side admin authorization, rate limiting, public error mapping, and request trace IDs.

It should route actions to domain services rather than contain new feature persistence logic.

### Domain services

Domain services own validation, state transitions, idempotency, authorization/ownership rules, audit semantics, and side-effect ordering.

The manual point-grant feature is deliberately decomposed by responsibility:

- `AdminPointGrantService.gs`: point-grant validation, idempotency, recovery, progress mutation, transaction ordering, and audit semantics.
- `MemberPointNotificationService.gs`: deterministic point-grant notification creation, member-scoped listing, acknowledgement, and IDOR prevention.
- `AdminPointGrantPushService.gs`: post-transaction LINE push orchestration and persistence of push result state.
- `TicketNotificationService.gs`: unused-ticket reminder eligibility, retry schedule, notification state, and audit result.

Domain services should call infrastructure abstractions instead of constructing external HTTP requests directly.

### Storage modules

Storage modules own Sheet names, exact header contracts, row/object mapping, normalization, and spreadsheet-safe cell serialization.

`AdminPointGrantStorage.gs` owns `CardPointGrants` and `MemberPointNotifications`. Its schema is additive to the existing PointsCard model and must not be changed without an explicit migration/backward-compatibility plan.

All untrusted strings written to Sheets must continue through `safeCellText_()` or an equivalent proven spreadsheet-formula-injection defense.

### `LineMessagingService.gs`

This is the single infrastructure boundary for LINE Messaging API push transport used by PointsCard GAS features.

It owns:

- Script Property lookup for `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`
- Push endpoint and authorization header
- deterministic `X-Line-Retry-Key` formatting
- HTTP/network result normalization

It does not own business message content, recipient eligibility, point transactions, ticket eligibility, or audit event meaning.

## Manual point-grant transaction

```text
Verified LINE identity
  → requireAdmin_
  → AdminPointGrantService
      → validate member/card/amount/reason/requestId
      → ScriptLock
      → write pending audit intent
      → append processing grant record
      → mutate MemberCardProgress
      → MemberPointNotificationService creates deterministic notification
      → write success audit
      → finalize grant record
      → release ScriptLock
  → AdminPointGrantPushService
      → LineMessagingService
      → persist push result
```

The LINE push is deliberately outside the point transaction. A push failure must not roll back or duplicate an already completed point grant.

The member notification service is separate from the admin grant transaction so member-scoped read/acknowledgement authorization can evolve without mixing it with privileged point mutation code.

## Observability

Frontend errors pass through `PointsCard.reportError()`, which sanitizes URLs, LINE user IDs, token-like hex values, and JWT-like values before forwarding to Sentry when an SDK is present.

Expected user/business errors are not treated as application exceptions. Network failures, invalid server responses, and unexpected/system error codes remain reportable. The server trace ID and safe error code may be attached for correlation; secrets and raw identity values must not be attached.

The repository currently does not initialize a Sentry SDK or DSN. Production Sentry verification therefore requires deployment/environment configuration outside this source-level contract.

## Test and change rules

Every architecture change should preserve these invariants:

1. Authentication and admin authorization remain server-side.
2. Mutations are not automatically retried by generic browser transport.
3. Request/idempotency identifiers remain stable across user-initiated retries where required.
4. LINE push failure cannot roll back a completed business transaction.
5. External-service secrets never enter browser code, Sheet rows, audit details, or public errors.
6. Member-scoped reads/writes enforce ownership and prevent IDOR.
7. Existing Sheet schemas are not changed without migration and rollback analysis.
8. New GAS files are syntax-checked and all `tests/*.test.js` run in CI.
9. Privileged point mutation, member notification ownership, and external LINE side effects remain separate responsibilities.
