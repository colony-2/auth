# Operational Hardening

This document describes the controls around management identity, publication approval, emergency access, entitlement projection, and policy artifact replication.

## Management Identity Boundary

Production management requests should pass through an authorization gateway. The gateway authenticates the administrator, evaluates the management policy, and injects `x-authz-decision` and `x-authz-principal-id` headers. The management Worker accepts those headers only when the request also contains the shared `x-authz-gateway-token` value configured as the `AUTHZ_GATEWAY_TOKEN` secret.

Do not expose that secret to the React application. The browser sends its bearer credential to the gateway; only the gateway adds the trust token before forwarding. `MANAGEMENT_BOOTSTRAP_TOKEN` is for initial provisioning and controlled recovery, not routine administration.

Every mutation records the resolved actor and request metadata in the audit log. Use separate service-account credentials for automation so human and machine changes remain distinguishable.

## Publication Approval

Set `REQUIRE_PUBLISH_APPROVAL=true` in staging and production. Direct service and scope publish endpoints then reject unapproved publication attempts.

The publication flow is:

1. Update and validate the service or scope draft.
2. Create a change request with a summary and requested immutable version.
3. Review its generated field-level diff and impact counts in the React console or API.
4. Approve or reject it as a second actor. A requester cannot approve their own request.
5. On approval, the management Worker verifies that the draft and active version still match the reviewed diff, revalidates and publishes the draft, records the immutable artifact version, and marks the request executed.

Approval returns `change_request_stale` when the draft or active artifact changed after the request was created. Reject that request and create a new one so the recorded review context matches the intended publication.

## Break-Glass Access

Break-glass grants are time bounded and vocabulary validated. A grant request identifies one subject, service, scope, role, reason, and duration. `BREAK_GLASS_MAX_SECONDS` limits requested duration; deployed examples use one hour.

A second actor must approve the grant. Active grants are added only to newly generated compact claims, so they do not alter durable bindings and do not retroactively change an existing JWT. Revoke the grant when the incident ends. Expiry, approval, rejection, and revocation are retained for audit.

Monitor active grants through `GET /operations/status` and the Operations view. Operational response should include reviewing the audit trail and rotating any credentials exposed during the incident.

## Entitlement Projections

The authentication service asks the management API for projected compact claims. The management Worker caches each subject/service projection in D1 with a dirty flag and earliest validity boundary. Entitlement mutations append invalidation events and mark affected projections dirty.

Dirty or expired projections rebuild synchronously on the next claim request. A scheduled handler also processes dirty projections every five minutes to reduce token-issuance latency. `POST /operations/projections/rebuild` allows an operator to trigger a bounded rebuild batch.

Projection data is an optimization, not an independent source of truth. Scopes, memberships, bindings, path grants, and active break-glass records remain authoritative.

## Artifact Replication

Published service and scope versions are immutable. The management Worker writes the versioned config and manifest to `POLICY_BUCKET`, then copies both objects to `POLICY_REPLICA_BUCKET` when configured. Each object result is recorded in `artifact_replication_events` and exposed by `GET /operations/status`.

A replica failure does not rewrite or delete the successful primary publication. Alert on failed replication records, resolve the R2 or binding problem, and republish as a new immutable version. The authorization gateway continues reading the primary bucket unless a separately reviewed failover changes its binding.

## Operational Checks

Before promotion, run:

```bash
npm run typecheck
npm run typecheck:ui
npm test
npm run test:integration
npm run demo:test
npm run deploy:cloudflare:dry-run -- --env staging
```

In a deployed environment, run `npm run smoke:cloudflare` and verify:

- JWKS and management health are reachable.
- one known request is allowed and one is denied;
- no dirty projections are accumulating;
- no break-glass grants remain active unexpectedly;
- recent primary and replica publication events succeeded;
- audit events identify expected administrators and automation subjects.
