# Grant management alongside Authelia

Status: options assessment. The [platform architecture](C2A_PLATFORM_ARCHITECTURE.md) governs ownership: product services persist user/group assignments, while c2a supplies reusable policy and issuance contracts. References below to retaining existing management code describe code to extract behind those boundaries, not a new central entitlement authority.

Assessment dated 2026-11-04. This extends the [auth stack recommendation](AUTH_STACK_RECOMMENDATION.md) with an explicit requirement for shared permission administration. Sources describe available capabilities; the combinations below have not been deployed or interoperability-tested here.

The later clarification that each product will have its own management UI narrows the target to shared APIs and semantics. See [SCIM and component boundaries](SCIM_AND_COMPONENT_BOUNDARIES.md) for the preferred Authelia-based split, off-the-shelf SCIM candidates, and the directory integration still required. A universal administration console is not a requirement.

## Recommendation

**There are good companions for individual parts, but I did not find a turnkey, permissively licensed Authelia companion that combines external identity, Cedar schemas, scoped grants, an administration UI, object-storage publication, and embedded Go/Worker evaluation.** Several projects cover substantial portions. The remaining integration is meaningful, especially the administrator experience.

This changes the emphasis of the earlier recommendation. Completing the applications' existing security is still the shortest route to shipping them. If a common grant-management experience is a requirement, leaving three independent permission implementations is a less satisfactory destination. That is a stronger reason to keep a focused c2a than merely sharing JWT verification.

For your constraints, I would keep identity outside c2a, retain its authorization management and publication direction, and compare that slice against **OPA plus OPA Control Plane** before expanding it. If a ready-made administration suite matters more than decomposition, evaluate **Keycloak in place of Authelia**. If relationship queries become the main problem, evaluate **OpenFGA**.

## These are separate management problems

| Concern | Example | Proposed authority |
| --- | --- | --- |
| Identity and directory membership | Alice exists; Alice belongs to Engineering | External identity/directory service |
| Permission vocabulary | A repository has read/push actions; a project has reviewer/operator roles | Service-owned definitions managed through policy tooling |
| Grants | Engineering has reviewer on Cortex project A | External entitlement authority, optionally using an imported grant-management library |
| Resource facts | Job 123 belongs to tenant A and has a live lease | Application that owns the resource |
| Evaluation | May this authenticated actor perform this action now? | Embedded or remote evaluator using trusted inputs |
| Audit and detection | Who granted access, what was used, and what looks suspicious? | Auth/application event producers plus an external logging/SIEM system |

Directory groups and application roles are different. Membership in Engineering should not itself imply access to every service. A scoped binding gives that group a particular role on a particular resource or scope. Likewise, a role definition is different from the assignments of that role.

Managing `external-group:engineering → reviewer → cortex/project-A` does not require storing Alice's account. A binding can contain an immutable, provider-qualified group reference. Names and member lists can be fetched from the directory for display. User references should identify the trusted issuer and stable subject, not an email address.

This must preserve your earlier boundary: the issuer asks an external authority what grants the subject has. A product-owned grant manager **can be that authority**, including one built with an imported c2a administration library; its persistence belongs to the product. The c2a issuer and evaluator should not require that database or UI. Alternatively, an existing application remains the authority, and c2a only manages policy definitions and consumes its entitlement response. Choose one authoritative writer for each assignment; do not create competing copies.

## Concrete alternatives

### Directory management: Authelia's backend, optionally GLAuth

Authelia supports file and LDAP authentication backends. That is where account and directory-group management belongs. For a few operators, a reviewed users/groups file is a reasonable starting point. If an LDAP interface is useful, **GLAuth is MIT-licensed**, supports configurable backends, and can read a directory from a local file or S3. It supplies directory infrastructure, not Cedar resource policies or a complete grant-administration console. Adding it only makes sense if the LDAP integration itself is needed. [Authelia backends](https://www.authelia.com/configuration/first-factor/introduction/), [GLAuth](https://github.com/glauth/glauth).

**LLDAP** is a relevant Authelia companion with a user-management web UI, but its license is **GPL-3.0**, not the Apache/MIT/BSD preference expressed here. It also addresses directory administration, not your application permission model. I would not silently include it in a permissive-license recommendation. [LLDAP project and license](https://github.com/lldap/lldap).

### OPA + OPA Control Plane: closest alternative for policy distribution

Both projects declare Apache-2.0 licenses. OPA Control Plane can build policy/data bundles from Git and external data sources and distribute them to object storage. Its `opactl build` workflow offers a starting point without requiring an always-running control-plane service. OPA supports Go integration and compilation to WebAssembly, so evaluation need not require a sidecar. [OCP repository and license](https://github.com/open-policy-agent/opa-control-plane), [OPA integration](https://www.openpolicyagent.org/docs/integration).

This is a serious alternative to the policy-distribution portion of c2a. It uses Rego rather than Cedar. You still need to define scoped roles, assignments, trusted resource facts, administrator permissions, and the UI for changing grants. A Worker integration also needs its host bindings, supported built-ins, bundle loader, and resource limits verified; Wasm support alone is not proof of a turnkey Cloudflare deployment.

If deleting c2a while retaining the requirement for shared policy infrastructure, this is my first architecture to prototype. It would replace policy infrastructure, not automatically replace JobDB's capabilities or Gitvend's protocol enforcement.

### Cerbos OSS: good resource-policy model and S3 support

The Apache-2.0 **Cerbos PDP** supports resource-oriented policies and a blob storage driver for S3, GCS, and S3-compatible services. Its object-store polling directly demonstrates the architectural pattern you have in mind. It uses its own policy format rather than Cedar. [Cerbos repository](https://github.com/cerbos/cerbos), [storage configuration](https://docs.cerbos.dev/cerbos/latest/configuration/storage.html).

Keep the OSS PDP distinct from **Cerbos Hub**. Hub supplies managed policy workflows and the documented embedded PDP path; those are not all included simply by adopting the Apache-licensed PDP. Under your no-commercial-service requirement, I would evaluate standalone Cerbos with your own policy delivery and administration, not promise the entire Hub experience. [Hub scope](https://docs.cerbos.dev/cerbos-hub/), [embedded PDP documentation](https://docs.cerbos.dev/cerbos-hub/deployments-epdp-rules.html).

### OpenFGA: good when grants are a relationship graph

Apache-2.0 **OpenFGA** models user/group relationships, roles, object relationships, and conditional access. Its APIs include checks and listing accessible objects/users. This is attractive when the central questions become “which projects can this person see?” or “who can access this resource?” It does not need to own passwords or user profiles. [Project and license](https://github.com/openfga/openfga), [capabilities](https://openfga.dev/docs/fga).

It changes the architecture: relationship tuples need authoritative storage and updates. S3-hosted policy snapshots are not a substitute for that operational grant store. Its modeling tools are not a complete application-specific administration experience. You would still build the UX and rules governing who may change relationships. It also replaces the policy model rather than providing a Cedar management layer.

### Cedar Agent: useful Cedar API, incomplete management product

Apache-2.0 **Cedar Agent** exposes policy, schema, entity-data, and authorization APIs. Its documented stores are in-memory, with file-loading options; Redis is listed as unimplemented in the reviewed README. The supplied Swagger/RapiDoc interfaces are API exploration tools. They are not the end-user grant administration, durable publication workflow, or S3-backed management system being sought. It is useful for a remote Cedar evaluator, but does not eliminate the main management work. [Cedar Agent](https://github.com/permitio/cedar-agent).

### Keycloak: closest complete administration suite, different tradeoffs

Apache-2.0 **Keycloak** has identity administration and authorization services for resources, scopes, policies, and permissions, including role/group-based policies and evaluation tooling. If you want a substantial existing admin experience, it deserves a prototype before building more. I would normally consider it an alternative to Authelia here, rather than deploy both by default. [Project and license](https://github.com/keycloak/keycloak), [authorization services](https://www.keycloak.org/docs/latest/authorization_services/index.html).

Its integrated server model is a different choice from independently loadable Cedar bundles and embedded evaluators. Its authorization configuration is not a portable Cedar/S3 runtime artifact. It can keep identity outside c2a, but does not satisfy the rest of the desired decomposition merely by being open source.

## Yes: S3/R2 policies are already part of this project

The current implementation separates management state from runtime artifacts:

- D1 holds normalized drafts, subjects, memberships, grants, version records, and management audit state.
- R2 holds published service and scope configuration.
- The gateway reads published artifacts and caches them for evaluation.

See the existing [management service](MANAGEMENT_SERVICE.md), [publisher](../src/management/publisher.ts), and [runtime loader](../src/lib.ts). Published keys include:

```text
authz/{serviceId}/service/{version}/config.json
authz/{serviceId}/service/manifest.json
authz/{serviceId}/scopes/{scopeId}/{version}/config.yaml
authz/{serviceId}/scopes/{scopeId}/manifest.json
```

Thus the object-storage idea is present, not a new proposed feature. The current runtime is wired to R2; a generic S3/filesystem/HTTP artifact loader is additional work. The current local subject/membership management also needs refactoring to satisfy the target of no c2a user store.

Object storage can hold schemas, policy code, role definitions, and suitably bounded grant snapshots. It does not remove the need for an authoritative editing process. The product-owned entitlement authority can use either arrangement below; c2a policy configuration has its own publication lifecycle:

1. **Git-authoritative:** definitions and assignments are reviewed files; CI validates and publishes immutable artifacts. Start here for a few projects when grants change infrequently. No continuously running grant-management service is necessary.
2. **API-authoritative:** a grant API accepts concurrent administrative changes, records revisions and audit events, and publishes snapshots to object storage. A transactional backing store helps implement this; it can store grants referencing external subjects without becoming a user directory.

An S3-only writer is also possible, but must implement conditional writes, conflict handling, and coherent publication. Merely placing several mutable JSON files in a bucket does not provide those semantics.

For a portable bundle contract, define schema/version compatibility, dependency versions, content hashes, authenticated publication, and activation rules. Publish immutable objects before switching a manifest. Load and validate a complete compatible snapshot before activation. A signature is useful when artifacts cross an untrusted distribution boundary; a hash alone does not authenticate the publisher.

Specify freshness and failure behavior explicitly. A bounded last-known-good snapshot can keep ordinary evaluation available during a publishing outage; a stale snapshot must not silently remain authoritative forever. Cold starts without a valid policy should deny protected operations. Avoid implying that switching a manifest instantly updates every evaluator.

**Policy freshness and grant freshness are separate.** Removing a group membership does not invalidate an already-issued JWT containing that membership. A short token lifetime bounds this delay; immediate removal requires a live check, revocation/version mechanism, or another freshness contract. Likewise, broadening a role definition must not silently enlarge an attenuated capability whose grant ceiling was fixed when issued. JobDB lease validity remains live application state, not an S3 policy fact.

## What c2a's management slice should offer

The useful reusable deliverable is an administration workflow backed by a portable contract:

- Define each service's resource types, actions, scope hierarchy, and role vocabulary.
- Select external users/groups and submit scoped role assignments to the product-owned entitlement authority.
- Validate changes and show effective access, including the assignment and policy that explain it.
- Test proposed changes against representative requests before publication.
- Authorize grant administrators themselves: project A's administrator cannot grant project B access or enlarge their own grantable ceiling.
- Review, publish, roll back, and inspect which artifact version each evaluator has loaded.
- Export management changes and runtime decisions with correlation IDs and policy/grant versions.

A useful “why allowed?” answer must include credential limits, resolved grants, policy, resource facts, and any live lease checks. A policy editor alone cannot provide that explanation. Neither should the UI claim a complete “everyone with access” list unless the external directory and entitlement source support the necessary enumeration.

The first demonstration should be concrete: bind an external group as Cortex reviewers for one project in the product-owned grant store, preview allowed and denied operations, publish, and obtain the same decision in Go and a Worker. Then show a JobDB service grant and a Gitvend repository grant through the same management workflow while preserving their domain-specific checks. Finally, remove a grant and demonstrate the documented revocation delay. That proves more than another generic RBAC editor.

## SIEM, and possibly SCIM

If you mean **SIEM**, c2a should emit structured security events to an external system, not build a detection/incident platform. Capture actor, action/resource, result, grant/policy revision, correlation ID, and administrative before/after changes. Redact credentials and sensitive request contents. Record publish/approval failures and privilege changes as well as runtime denials.

If you mean **SCIM**, it is the identity provisioning protocol, a separate concern from permission evaluation. A connector can exchange user/group references with an external directory, but does not itself define Cedar permissions or grant semantics. Under the no-user-store design, account lifecycle remains external. The existing management service's SCIM-style routes should be reviewed against that boundary rather than treated as a reason to retain an internal directory. [SCIM protocol](https://www.rfc-editor.org/rfc/rfc7644).

## Decision

Keep Authelia if its login/backend model fits. Start directory management with its existing backend. Keep policy/grant administration separate and evaluator deployment optional.

Before building a broad control plane, compare a small c2a workflow with an OPA/OCP prototype on the same actual project grants. Prefer OpenFGA if mutable relationships and reverse queries dominate; prefer Keycloak if the integrated admin suite is worth the architectural tradeoff. A focused c2a remains defensible if it makes **external identities → understandable scoped grants → reviewed object-storage artifacts → consistent embedded enforcement** substantially easier, without assuming ownership of accounts.
