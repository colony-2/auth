# Evaluation: is c2a worth building?

Assessment dated 2026-11-04. The objective is reusable open-source infrastructure, not monetization. This evaluates the direction rather than endorsing every feature in the preceding plans. Comparisons use the primary sources linked below; adoption predictions and recommendations are judgments, not interviews with prospective users or benchmark results.

## Judgment

**A focused c2a makes sense. A new universal identity-and-security platform does not yet have a convincing justification.** The strongest version of this project has a narrower boundary:

> Bring an authenticated identity and an external entitlement service. c2a turns their result into constrained credentials and consistently enforces access in your service or at a gateway, without another user database or a mandatory authorization daemon.

That is useful for the Colony projects, and plausibly useful elsewhere. It is also a credible explanation of why c2a exists despite mature alternatives. Its value would be the integration contract, deployment simplicity, and preservation of restrictions across delegated work. JWT, Cedar, and macaroons are available ingredients; making them straightforward to combine correctly can itself be a worthwhile open-source contribution.

My recommendation is to build and validate that bounded system, using the three controlled projects as demanding test cases. Treat broad external adoption as an unproven hypothesis. Do not take on an entire Auth0 replacement on the assumption that people will migrate because the underlying primitives are better. There is no need for a commercial moat or an empty category: the test is whether a clean maintained implementation saves others from repeatedly solving the same difficult problems.

## The boundary that makes this tractable

The latest requirement is definitive: **c2a never owns a user store.** This is not an optional directory waiting to become mandatory later.

| External application/identity services own | c2a owns |
| --- | --- |
| User accounts, profiles, passwords, recovery, identity linking | Verification of accepted identity evidence and issuer trust |
| Memberships, invitations, user/group assignments, entitlement source of truth | A contract for requesting and validating effective grants |
| Deciding what this person or workload may receive | Constraining issuance to the requested service, profile, lifetime, and issuer ceiling |
| Live facts: lease state, resource ownership, business state | Credential proofs, attenuation, policy evaluation, enforcement adapters |
| Account lifecycle and application administration | Policy/vocabulary configuration, key references, distribution and security diagnostics |

The principal flow is:

```text
validated identity evidence
          ↓
external service: what grants may this subject receive for this audience?
          ↓
c2a: validate and constrain those grants → issue JWT or capability
          ↓
embedded Go/Worker evaluator OR remote evaluator
          ↓
application checks the operation against authoritative resource/lifecycle facts
```

The question to the external service cannot be an unauthenticated client assertion that “I am Alice.” c2a needs verified upstream evidence or a specifically trusted caller. The entitlement service must receive an audience-qualified subject and authenticated request. Its response needs defined grant semantics, validity bounds, and failure behavior. Unavailable or invalid entitlement responses must not produce an unrestricted token.

Keep a namespaced subject reference, such as the verified issuer/subject pair or an application-issued immutable identifier. Do not require copying the user into c2a before issuance works. Policy definitions may name subjects, but c2a should not develop a parallel accounts table or membership source of truth. An entitlement editor in the console must delegate changes to the owning service or remain outside c2a.

The current repository is broader than this target: it contains D1-backed subjects, identities, sessions, credentials, memberships, and provisioning paths. Its external claim-preview integration is a useful start, but does not by itself eliminate the local identity dependency. This boundary therefore requires an architectural refactor, not merely a new description of existing behavior.

There will still be state. Policies, key references, published artifacts, operational audit, and possibly bounded caches or protocol transactions exist. “No user database” is a sound ownership rule; “no state and immediate revocation everywhere” is not a realistic guarantee. Persisting authoritative accounts and grants should remain the external service's job.

Under this model, c2a can replace access-control functions people currently obtain from a bundled identity platform. It is not a complete substitute for that platform's user lifecycle. For Cortex, a Google/OIDC login adapter can establish identity without becoming a directory, while an application-owned service decides project membership.

## Is REST + JWT + attenuation + Cedar the right recipe?

It is a coherent recipe for a subset of application access control. It is not a universal recipe for security, and each ingredient should earn its place.

### REST is a convenient adapter, not the security model

For ordinary HTTP services, OpenAPI plus explicit authorization metadata can reduce repetitive integration. The management API can also be REST. Those are good defaults.

But `POST /git-receive-pack` does not describe every branch update inside a Git push. A job-poll endpoint does not identify every cell a worker might acquire. One GraphQL or batch request can touch many objects. A stream can outlive the session that opened it. A background job can invoke the same operation without HTTP at all.

The durable abstraction is a structured principal/action/resource/context operation, with application hooks at the relevant boundary. Endpoint matching is one way to produce it. The existing JobDB and Gitvend requirements already demonstrate why route-level enforcement alone is insufficient.

OpenAPI cannot infer trustworthy ownership, prevent a direct-origin bypass, authorize every item in a result set, or eliminate a race between checking state and committing a mutation. c2a can standardize those integration points; it cannot make their application implementation disappear.

### JWT is a practical access envelope

JWTs support independent signature verification and fit existing HTTP infrastructure. They are a sensible first credential profile for services.

They also carry stale assertions, can become large, and are generally replayable bearer credentials unless additional binding is used. Revoking future issuance does not revoke a token already issued. A signed role name can even acquire new meaning if the corresponding policy changes.

Opaque sessions or reference tokens can be simpler where every request already reaches a stateful backend. JWT should be a supported default, not a requirement imposed on every browser session or internal call. Neither JWT nor an attenuated bearer token proves which process is holding it.

### Attenuation is valuable when work is delegated repeatedly

JobDB provides the strongest concrete case: a worker can derive a child that resolves one secret or reads selected chapters without receiving a signing key or contacting an issuer. The restriction survives handoff to a subprocess. That is substantially better than handing the child the parent's broad bearer token.

But ask whether other adopters actually need offline derivation. If a backend can cheaply request every child credential online, a controlled token exchange may be sufficient and easier to revoke or inventory. A child that needs live lease validation is not operating independently of the server merely because its derivation was offline.

Attenuation cannot revoke copies of the parent, stop a holder from sharing the credential it already has, or constrain activity through another credential/path. It also does not repair unsafe granted operations. Agents need constrained tools and, where appropriate, sandboxing; an allowed dangerous action remains dangerous.

### Cedar is a reasonable default, not a conclusion

Cedar matches explicit access decisions well and gives this project an existing runtime and policy ecosystem. However, it does not maintain the application relationship graph, discover current facts, prove arbitrary query filters safe, or authenticate a capability chain. Its language properties do not make the entire integration verified.

For mostly relational sharing and “list everything this user can access,” a relationship engine may be the better center of gravity. For simple roles, a small embedded library may be enough. If Biscuit can express both delegation checks and the needed policy, adding Cedar may duplicate concepts instead of simplifying them.

Support a stable evaluator boundary, with Cedar as the first implementation. Keep credential verification and mandatory capability restrictions outside any replaceable policy engine's ability to bypass them. Pluggability should not mean promising that all policy languages, error models, and query semantics are interchangeable.

The stronger thesis is **consistent access decisions and bounded delegation across deployment modes**, not that four technologies are universally correct.

## Good alternatives already exist

Yes. The closest alternatives depend on whether the need is login, policy evaluation, relationship queries, or delegated credentials. The table describes documented capabilities; the fit assessments are my evaluation. It does not assert that every unmentioned feature is absent.

| Alternative | What it already provides | Fit against our specific constraints |
| --- | --- | --- |
| **Cedar directly + JOSE/OIDC client + macaroon library** | The individual engines and credential primitives used by this proposal | The strongest baseline. No required directory or extra daemon. c2a must demonstrate that its shared lifecycle, tooling, and adapters eliminate meaningful integration work beyond a small library composition. See [Cedar Go](https://github.com/cedar-policy/cedar-go), [JOSE](https://github.com/panva/jose), and [macaroons](https://github.com/go-macaroon/macaroon). |
| **Biscuit** | Public-key-verifiable tokens, offline attenuation, and logic-based authorization | The closest conceptual alternative for delegated authority. Test whether Biscuit plus application facts solves the problem without a separate Cedar layer. Login and entitlement integration remain application work. [Biscuit documentation](https://doc.biscuitsec.org/). |
| **OPA** | General-purpose policy evaluation, including a native Go API and compiled WebAssembly | A serious embedded alternative; it does not inherently require a sidecar. Integration and Wasm builtin support need evaluation for the selected deployment. Credential/delegation composition remains separate. [OPA integration](https://www.openpolicyagent.org/docs/integration), [Wasm support](https://www.openpolicyagent.org/docs/wasm). |
| **Casbin** | Embedded access-control libraries, multiple models, storage/integration adapters | A strong simplicity baseline for ordinary application permissions. Do not build a platform if this plus existing authentication is sufficient. Its permission engine is not by itself our JobDB capability lifecycle. [Casbin overview](https://casbin.apache.org/docs/overview/). |
| **Cerbos** | Application policy decisions, management/distribution tooling, and embedded Wasm evaluation | Overlaps with the proposed control plane and local enforcement. Its documented ePDP workflow uses Cerbos Hub; evaluate the exact edition and dependencies rather than assume every deployment feature is standalone open source. [Platform](https://docs.cerbos.dev/cerbos/latest/), [embedded PDPs](https://docs.cerbos.dev/cerbos-hub/deployments-epdp-rules.html). |
| **OpenFGA / SpiceDB** | Relationship-oriented authorization and resource/subject queries | Particularly compelling when mutable sharing graphs and authorized lists dominate. They do not require owning application user accounts, but relationship data still needs storage and lifecycle management. OpenFGA also documents Go library embedding, so “they all require daemons” would be an unfair distinction. [OpenFGA](https://openfga.dev/docs/fga), [SpiceDB](https://authzed.com/docs). |
| **Ory components** | Kratos for identities, Hydra for OAuth/OIDC, Keto for permissions, Oathkeeper for access proxying | The closest comparison to the earlier broad modular-platform proposal. Select pieces rather than adopt the whole deployment. Kratos is not required by our no-user-store boundary; a protocol framework or existing issuer may be a better fit than operating the complete suite. [Ory project inventory](https://www.ory.com/docs/oss/open-source). |
| **Keycloak** | Integrated identity services and resource/scope/policy authorization services | A credible choice if someone wants an administered identity server. Its operating model is less aligned with embedding a small runtime and keeping identity entirely application-owned. Do not dismiss it as login-only. [Keycloak docs](https://www.keycloak.org/documentation), [authorization services](https://www.keycloak.org/docs/latest/authorization_services/index.html). |
| **Amazon Verified Permissions** | Managed Cedar policy management and authorization APIs | A useful managed comparison for AWS deployments. It assumes authentication occurs elsewhere, which fits the identity boundary; its service model does not meet a requirement for a self-contained Cloudflare/embedded open-source runtime. [AWS documentation](https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/what-is-avp.html). |
| **Existing sessions + application permission checks** | The minimum system many teams actually need | The default competitor. For a few stable roles in one service, introducing another model, toolchain, and trust boundary may be a net loss. |

For browser identity without a new directory, also evaluate a supported OIDC client directly. For example, MIT-licensed [openid-client](https://github.com/panva/openid-client) and [oauth4webapi](https://github.com/panva/oauth4webapi) provide client-side protocol building blocks for server runtimes; they are not hosted user databases or full authorization servers. Go has the corresponding upstream-client option discussed in the [architecture component survey](C2A_PLATFORM_ARCHITECTURE.md#reusable-components).

Verify licenses, maintenance, exact runtime support, and commercial feature boundaries at the release/version selected. An open-source engine and a vendor's hosted management features are different adoption decisions.

### The shortlist I would actually prototype

1. **Direct Cedar + external entitlement callback + existing macaroon implementation.** Establish how much of c2a can be a small shared SDK and configuration contract.
2. **Biscuit + external entitlement callback.** Test the same delegation cases without assuming a second policy language is necessary.
3. **OPA or Casbin + existing identity.** Establish the complexity floor for applications that do not need rich delegation. Pick one for an actual trial based on policy requirements; do not prototype every engine.
4. **OpenFGA or SpiceDB** if authorized listing and relationship changes turn out to be the dominant difficulty rather than token delegation.

Ory and Keycloak remain good alternatives to a broad identity platform, but they are no longer the closest comparison to the narrower c2a described here. “Use an existing issuer and add an embedded library” is now much closer.

## Where a reusable contribution could help

Local evaluation, pluggable authorization, policy management, and externally supplied identities already exist. Open-source licensing is useful but not unique. “Security for agents” is also an active category: [Ory](https://www.ory.com/agent-security) and [Auth0](https://auth0.com/solutions/ship-ai-agents) both position products there. Their public material is evidence of competitive activity, not proof of equivalence to JobDB's offline attenuation semantics or evidence of customer demand for c2a.

The potentially useful combination is narrower:

- A small, documented issuer-to-entitlement contract without account replication.
- A credential/delegation lifecycle that works inside ordinary Go services and in a tested Worker deployment.
- Preserved constraints across human → application → job → child process → downstream service.
- An operator can explain a denial in terms of identity, grant, caveat, policy version, and live condition.
- Initial installation does not require several services and a new database merely to authorize one request.

That combination is an integration hypothesis. The reviewed alternatives do not establish that our exact package already exists, but an absence from a documentation survey is not proof of an unmet need. We should be willing to discover that an existing stack meets the requirements with little glue. For an open-source effort, some overlap is acceptable; redundant maintenance and another incompatible format are the costs to avoid.

Standards also reduce the opportunity to differentiate merely by exposing an API. [OpenID AuthZEN](https://openid.net/wg/authzen/specifications/) defines an authorization-decision interface; OAuth [Token Exchange](https://www.rfc-editor.org/rfc/rfc8693) and [Rich Authorization Requests](https://www.rfc-editor.org/rfc/rfc9396) address parts of credential exchange and structured authority requests. These do not automatically supply our offline caveat or lease semantics, but c2a should align with them where appropriate rather than invent incompatible equivalents.

### The most useful thing to contribute

The opportunity may be a shared implementation contract plus a small toolkit, rather than another full platform. A concrete contribution would contain:

| Reusable piece | Work it could save others |
| --- | --- |
| External-entitlement contract | Repeatedly inventing subject namespaces, audience scoping, grant validity, and failure semantics |
| Versioned access/capability profiles | Repeatedly combining signature verification, issuer ceilings, caveats, and lifecycle checks incorrectly |
| Embedded runtime with fact hooks | Rewriting credential admission and policy composition for each service while keeping resource state application-owned |
| Go and Worker conformance fixtures | Discovering different interpretations of scopes, paths, expiry, and delegation only in production |
| Issuance/attenuation CLI and diagnostics | Passing broad keys around or relying on ad hoc token scripts to debug authorization |
| Complete examples using external identity | Having to adopt a user database or a large control plane to learn the intended integration |

These pieces are useful even if adopters never use a c2a-hosted service or management console. Independent implementations or an application that outgrows the reference runtime should be able to retain documented semantics. Compatibility fixtures and clear extension/versioning rules may be a more durable contribution than the UI.

Three valid outcomes are a standalone c2a toolkit, a thin integration distribution around existing libraries, or upstream contributions plus a reference application. Choose the shape that removes the most duplicated work with the least ongoing maintenance. Success does not require every useful feature to remain under the c2a name.

## Deployment simplicity must be a tested property

Offer three clear installation modes rather than asking every user to assemble all modules:

| Mode | What the adopter runs | Required dependencies |
| --- | --- | --- |
| Embedded | Existing application plus c2a library | Trusted issuer/key configuration, policy bundle, and application fact hooks; external entitlements are consulted when issuance requires them |
| Worker | A deployed Worker bundle with optional proxy routing/issuance | Explicit bindings and external entitlement endpoint; managed storage only for features that need it |
| Managed policy/remote decision | Optional c2a management or evaluation endpoints | Policy storage/distribution and operational services chosen for that deployment; still no c2a user directory |

Logical modules need not become separate daemons. A configuration file or immutable bundle should be enough for the smallest deployment. A console, approval workflow, and remote evaluator can be added without changing the application's principal model.

Cloudflare compatibility must be demonstrated with representative bundle size, CPU, startup, cryptography, streaming, and policy-refresh workloads. Wasm support alone does not prove that an engine or whole application runs well on Workers. Native Go support does not prove identical Worker behavior. Existing local Cedar/Worker integration is useful evidence, but the complete capability profile still needs cross-runtime tests.

Avoid trading deployment complexity for a permanent callback on every request. Entitlement lookup can occur at issuance, while evaluation uses bounded cached policy and trusted application facts. Operations requiring current lease or revocation state still pay that cost. Remote evaluation should be a selectable deployment, not a hidden mandatory dependency behind an “embedded” SDK.

## Would people adopt it?

There is a plausible early audience, but no evidence here supports a numeric adoption forecast.

| Potential adopter | Why it might fit | Why they might reject it |
| --- | --- | --- |
| Workflow/agent platform with subprocess delegation | Real need to hand off less authority and tie it to task lifetime | Existing online issuance is sufficient; caveat complexity does not buy enough |
| Small platform team running several Go/edge services | Shared checks without a fleet of security services or duplicated users | OPA, Casbin, or a direct Cedar wrapper already covers their needs |
| Software vendor shipping self-hosted infrastructure | Can embed enforcement while accepting the customer's identity system | New policy/credential formats increase compatibility and support burden |
| Application with extensive document/team sharing | Wants permissions outside business code | Relationship queries and consistency favor OpenFGA/SpiceDB |
| Team needing only Google login and basic roles | Wants a short setup path | c2a adds concepts without solving an unmet problem |

Control of three repositories makes internal adoption likely if we prioritize it. It does not validate outside demand: those projects share assumptions, maintainers, and a willingness to change together. Independent consumers will have different routers, deployment environments, entitlement services, and migration constraints.

Security adoption has a high trust cost. Stable profiles, documented limitations, upgrade compatibility, redaction, reproducible releases, review of the credential composition, and usable diagnostics matter more than a long feature list. An adopter needs to understand failure behavior without becoming an expert in Cedar plus macaroon caveats plus our role encoding.

Make the first successful integration small: accept the customer's issuer, connect their entitlement endpoint, authorize one real operation, and show one denial. Require explicit application integration for deeper guarantees, but do not require an account migration, policy-management database, or total rewrite first.

For this effort, adoption means independent people can reuse, understand, and maintain the solution. Repository stars and demo interest are weak signals. Stronger signals are removal of custom security code, successful upgrades, useful bug reports and fixes from others, and integrations that do not require the original authors to intervene.

No monetization plan is needed, but a maintenance plan is. Keep the supported matrix small, document profile compatibility, publish security reporting and release procedures, and make examples and tests useful to new contributors. A permissive license helps reuse; clear ownership of releases and vulnerability fixes determines whether people can responsibly depend on the code.

## The largest risks

**Composition bugs.** Individually sound libraries can be combined unsafely: an access JWT can bypass a child capability; a target token can lose the parent's deadline; a mutable role can widen an old grant; a local policy can trust attacker-supplied facts. The central engineering task is preserving these invariants, not choosing the strongest-sounding primitive.

**The permission callback becoming an underspecified escape hatch.** “Return this user's permissions” needs a stable service-specific schema, provenance, deadlines, limits, and error behavior. If each application invents a different response that c2a interprets loosely, the shared platform merely moves custom authorization bugs to a network boundary. The managed vocabulary and typed grants are valuable precisely here.

**Hidden operational state.** Immediate revocation, globally correct membership, safe key rotation, audit retention, and dynamic policy rollout require mechanisms and sometimes storage. Promise bounded freshness, not both unlimited disconnected operation and instant revocation.

**Too much configurability.** Several evaluators, credential types, stores, login adapters, and runtime targets multiply the combinations to test. Define narrow supported profiles. Start with one production evaluator and one attenuation profile; add alternatives because an integration needs them, not to fill a plugin catalog.

**A UI becoming another source of truth.** If the application owns memberships but the c2a console silently stores its own user assignments, the architecture has failed. The UI should manage c2a policy/configuration and integrate with the authoritative entitlement service for user-specific changes.

**Overstated coverage.** Access decisions do not solve injection, account compromise, dependency vulnerabilities, tenant leaks in unchecked queries, network egress, sandbox escape, or misuse of actions already authorized. c2a addresses a significant application-security layer, not a large measured fraction of “security” as a whole.

## Is the scope too big?

The earlier full platform—directory, login, sessions, MFA/recovery, provisioning, multiple policy engines, delegation, distributed management, and several deployment targets—is too broad as an initial reusable project. Making each feature a module does not eliminate its implementation, support, and assurance cost.

The no-user-store boundary removes a substantial category of work. Keep authentication evidence verification and external entitlements in scope; keep account lifecycle out permanently. A reusable login connector can be provided without committing to a general-purpose identity server.

The first c2a release should contain the Go/Worker enforcement contract, external entitlement adapter, one strict access-token profile, one capability profile, local tooling, and a minimal policy-distribution path. Existing management functionality can support internal deployments, but its current D1 subject model must not become a prerequisite for the lean path.

Treat polished administration, advanced approval workflows, generic graph querying, multiple policy backends, and a comprehensive OAuth authorization server as separate investments. The fact that code already exists for part of a feature is not evidence that maintaining it belongs in the reusable core.

## A decision experiment, rather than an architectural bet

Use the same scenarios for c2a and the strongest existing-library baseline. Measure integration effort, custom security code remaining, required services/storage, evaluation latency, artifact size, failure behavior, and how easily a new developer explains a denial. Define performance budgets against actual applications before testing; no benchmarks have been run for this evaluation.

| Experiment | Evidence in favor of c2a | Reason to narrow or stop |
| --- | --- | --- |
| JobDB child delegation | Shared c2a code replaces custom proof/selector code; child survives owner rotation but dies with the parent | Each consumer still reimplements proof or restriction semantics |
| Gitvend adoption | Same issuance model applies to parsed Git operations without weakening ref checks | Generic permissions need so many exceptions that c2a adds little beyond token parsing |
| Cortex identity and permissions | Google/existing identity plus application-owned entitlement service works with no copied user accounts | Login or issuance requires creating a c2a user/profile first |
| Embedded and Worker deployment | Minimal documented installations; same profile fixtures and bounded failure behavior | Extra mandatory services or significant runtime divergence are concealed by the SDK |
| External integration | Independent developers integrate without a fork and can operate failures/rotation | Success depends on the authors rewriting each application |
| Existing-component comparison | c2a substantially reduces repeated integration/operational work | Direct Cedar/macaroons or Biscuit meets the requirements with a thin adapter |

As proposed validation goals, find two or three independent teams with a real delegated-access problem, have them integrate one protected operation and one handoff, and observe whether they keep using it without continued author intervention. These are experiments, not evidence we already have. Ask them to compare against their preferred alternative, not just react to our demo.

If the baseline wins, a small c2a adapter/SDK or upstream improvement can still be worthwhile for Colony and others. There is no need to turn every useful internal library into a broad platform. If the combined contracts repeatedly remove custom token and permission code, expand the project around that demonstrated value.

## Recommendation

Proceed with c2a as a **small access-issuance and enforcement system that consumes external identity and entitlements**, with embedded evaluation and an optional Worker/remote deployment. Build it by composing existing engines and credential libraries. Keep Cedar as a starting choice and attenuation as an earned capability for delegated workloads.

The idea is technically reasonable; the universal-recipe claim is too strong. The ecosystem is crowded, but that does not disqualify a clean reusable solution. The strongest opportunity is making external entitlements, constrained credentials, and application-native enforcement fit together with few dependencies and clear guarantees. The scope becomes manageable only if “no user store, no mandatory daemons, no duplicate entitlement authority” remains a design constraint rather than a temporary implementation preference.
