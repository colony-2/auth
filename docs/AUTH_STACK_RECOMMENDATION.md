# Recommended auth stack, and what I would do without c2a

Status: alternative considered. This explores completing the applications without a shared c2a platform; it is not the adopted implementation plan. The [platform architecture](C2A_PLATFORM_ARCHITECTURE.md) defines the intended direction, and [SCIM and component boundaries](SCIM_AND_COMPONENT_BOUNDARIES.md) records the later external-directory requirement.

Recommendation dated 2026-11-04, based on the repository review recorded in [Project adoption](PROJECT_ADOPTION_PLAN.md). This is a design recommendation; no deployment or interoperability test was performed. “Without c2a” is a hypothetical architecture, not an instruction to delete this repository.

For the additional requirement of a shared grant-management experience, see [Grant management options](GRANT_MANAGEMENT_OPTIONS.md). That requirement strengthens the case for retaining c2a's management/publication slice; completing three separate implementations does not itself deliver common administration.

## My choice

**If the immediate objective is to finish JobDB, Gitvend, and Cortex, my first alternative to c2a is to complete their existing security implementations using established libraries and one external identity provider.** I would retain JobDB's lease capabilities and Gitvend's protocol-aware permissions, add real login and authorization to Cortex, and close the service-authentication gaps between them.

I would not replace all three with a different general-purpose security platform, and I would not start three new cryptographic implementations. Some application-specific authorization code is unavoidable and already exists. The question is how much of it actually needs to become a shared abstraction.

The previous recommendation—Cedar, JWT, and macaroons behind a shared c2a library—is a reasonable destination if shared permission management is the goal. It is not a prerequisite for deploying these projects securely. A reusable c2a should earn its place by making the working baseline simpler to maintain or extend.

## Components I would use

All listed projects declare permissive licenses. Check the actual pinned versions and transitive dependencies when packaging a release.

| Responsibility | Component | License | Use |
| --- | --- | --- | --- |
| Go JWT issuance/verification | [golang-jwt/jwt](https://github.com/golang-jwt/jwt) | MIT | Already used by Gitvend; use the same maintained primitive for new Go access-token handling |
| Go OIDC client | [coreos/go-oidc](https://github.com/coreos/go-oidc) | Apache-2.0 | Verify browser login through an existing OIDC provider |
| Restricted lease capabilities | [go-macaroon](https://github.com/go-macaroon/macaroon) | BSD-3-Clause | Preserve JobDB's existing use and its application-specific lifecycle checks |
| Shared embedded policy, if needed | [cedar-go](https://github.com/cedar-policy/cedar-go) | Apache-2.0 | First choice for a c2a evaluator given this project's existing Cedar model; not mandatory for the incremental alternative |
| Worker JWT handling | [jose](https://github.com/panva/jose) | MIT | Use if a Worker actually needs to verify or issue credentials |
| Self-hosted human login, if no provider exists | [Authelia](https://github.com/authelia/authelia) | Apache-2.0 | One external OIDC identity service for Cortex and administrative interfaces |

For a small self-hosted installation, Authelia can use [file-backed accounts](https://www.authelia.com/configuration/first-factor/file/), [SQLite storage](https://www.authelia.com/configuration/storage/sqlite/), and [in-memory sessions](https://www.authelia.com/configuration/session/introduction/). This avoids a separate database server and mandatory Redis in that deployment; it is not a highly available configuration. Accounts belong to that identity service, never to c2a. Applications still need their own secure session integration through [OIDC](https://www.authelia.com/configuration/identity-providers/openid-connect/provider/).

If “no commercial services” means no externally operated identity service at all, use the self-hosted provider. Google login necessarily relies on Google's service. If Google is acceptable as an upstream identity provider and the restriction is against commercial auth platforms, an OIDC client can use it without adding Authelia. Neither option requires a c2a directory.

## The no-c2a implementation I would ship

### JobDB: finish service authentication around existing authority

Keep its existing HTTP server, cell authority, owner leases, macaroons, delegation selectors, and authoritative parent-lease checks. Those are already a substantial authorization implementation.

Add a strict service-access JWT verifier and a trusted adapter that maps authenticated identities and externally owned grants into JobDB's authority context. Tenant and cell restrictions must come from trusted configuration or the entitlement service, not from a client-supplied tenant header or job metadata.

For the initial few projects, I would make assignments explicit and understandable: a configured service identity can observe, submit, or acquire work in specified tenants/cells, with configuration administration and secrets handled separately. Existing permission selectors can express the finer execution limits. Simple typed rules are sufficient until policy requirements demonstrate a need for Cedar or another engine.

The adapter must cover the entire serving surface. Existing cell checks are not automatically authorization for history, goals, cancellation, deletion, configuration, or every artifact route. Polling and listing must restrict eligible work/results before acquisition and pagination. Lease operations must continue checking the correct tenant/job/worker/lease and live state.

A trusted local operator can issue audience-bound access JWTs using a small CLI built on the JWT library. A service-specific signing key is issuer authority and stays with that operator or issuer. Workers receive access tokens and lease capabilities, not signing keys. Keep API access credentials separate from the owner/child lease credentials.

This is custom integration with JobDB's domain. It does not require inventing a new token primitive, replacing its macaroons, or deploying an authorization daemon.

### Gitvend: retain its working gateway and issuer

Keep the existing Ed25519 JWT profile, signing CLI, credential helper, owner ceilings, repository/ref permission rules, and deny behavior. They fit the actual Git operations and already support local issuance.

Keep the JobDB secret-provider plugin as the handoff mechanism. It issues a Gitvend credential bounded by the permitted repository/ref grants and the verified lease authority. Confirm configuration uses the intended tenant and target-cell restrictions rather than broad example grants.

Deploy the gateway with HTTPS, protected upstream GitHub credentials, explicit issuer keys, rotation procedures, and a real allowed/denied Git smoke test. A generic HTTP policy engine cannot replace its checks inside a multi-ref push or its discovery behavior.

There is no immediate technical requirement for a JobDB access token to work at Gitvend. Distinct audiences and formats are acceptable when the plugin performs an explicit, authorized issuance step. Preserve a common subject/correlation convention for audit without exposing parent bearer credentials.

The cost of this choice is maintaining Gitvend's permission grammar and issuer rules separately. That becomes a reason to extract a shared model only if the duplication is causing actual problems or new services need the same semantics.

### Cortex: add the missing identity and enforcement boundary

Replace the email-cookie convention with OIDC login through its Go backend and a secure application session. Derive review actors and access decisions from verified identity, never a browser-written email field.

Use an application-owned entitlement function or service to resolve the subject's permitted projects and actions. For a small deployment, this can use application configuration or existing storage. It need not be a new daemon or an auth-system user database.

Enforce project/action permissions in the Go handlers and shared internal operations. Cover the main API, downloads, reviews, SSE, and c2j input handlers mounted outside the main subrouter. Validate actual resource ownership and constrain project listings. Define session expiry and access-removal behavior for streams as well as new HTTP requests.

For downstream JobDB access, my first implementation would use narrowly scoped Cortex service credentials, preferably separated by tenant where practical. Cortex authorizes the human before calling JobDB. This explicitly trusts Cortex to act for those users; JobDB sees the authenticated service, and Cortex records the verified human actor.

If JobDB needs to independently enforce the human's authority, add a trusted audience-specific token exchange/issuer integration with explicit grant translation. Do not pretend forwarding an email header provides that guarantee. This stronger design is useful, but it should be a stated requirement rather than hidden complexity in the first release.

## What would be shared without becoming another platform?

I would standardize these few contracts first:

- Stable subject identifiers and explicit service audiences.
- Required token claims, allowed algorithms, key IDs, lifetime limits, and rotation behavior for each profile.
- A typed external entitlement response for new issuance, with provenance and validity bounds.
- Authenticated context, error handling, redaction, and audit correlation conventions.
- Tests for wrong issuer/audience, expired authority, cross-tenant access, and invalid delegation.

Share a small Go package when the same implementation is genuinely used by multiple services—for example strict access-token verification and context handling. Keep JobDB delegation code in JobDB initially unless another consumer needs it. Keep Git-specific operation parsing in Gitvend permanently.

That package would not need its own service, user store, management console, universal permission grammar, or policy distribution system. If it starts acquiring those responsibilities, we are reintroducing a platform and should evaluate that decision explicitly rather than call it “just helpers.”

Thus my answer to “custom implementation in each?” is **some domain-specific enforcement in each, using shared maintained primitives and a small number of common contracts**. That is a reasonable architecture. The undesirable duplication is independent crypto, inconsistent credential verification, and subtly different interpretations of the same security contract—not every application-specific permission check.

## How this compares with keeping c2a

| Question | Complete existing applications | Adopt a focused c2a |
| --- | --- | --- |
| Immediate work | Fill gaps and harden interfaces | Fill gaps plus migrate token/permission contracts |
| Existing behavior | Preserved directly | Must demonstrate parity during extraction/migration |
| New daemons | None for evaluation; one identity provider if needed | None required if c2a is embedded; optional management/remote services |
| User storage | External identity/application services | Same: c2a must never own it |
| Permission administration | Application-specific configuration/APIs | Common vocabulary, policy tooling, and diagnostics where supported |
| Delegation | JobDB's existing implementation | Shared capability module reusable by other applications |
| Adding a fourth service | Reuse basic helpers; implement its domain checks | Reuse more issuance/enforcement infrastructure; still implement domain facts and boundaries |
| Main maintenance risk | Divergence between application security contracts | A broader abstraction and runtime compatibility surface maintained centrally |
| Best reason to choose it | Finish these three applications with limited migration | Repeatedly remove custom issuance/enforcement work across several different consumers |

If I were responsible only for getting the three applications operational, I would choose the first column now. If I were also responsible for producing reusable infrastructure for many applications, I would first establish that baseline and extract the pieces whose contracts survive all three integrations.

That is not an argument for discarding c2a's useful code. Its Cedar runtime, policy publication, and simulation may shorten that extraction. It is an argument against migrating working security machinery solely to satisfy a platform design.

## Would I choose a different off-the-shelf platform instead?

Not as the default for this particular estate. The requirements combine embedded enforcement, application-owned entitlements, Git protocol checks, and live-lease delegation. A replacement suite would still need those integrations while adding its own operating model.

If a shared policy engine became necessary without c2a, I would first embed Cedar directly. If delegated credentials needed verification by independent services without shared MAC keys, I would evaluate [Biscuit](https://doc.biscuitsec.org/) before designing another capability format. If relationship queries became the dominant problem, I would reconsider the relationship engines discussed in [the evaluation](C2A_EVALUATION.md). None of those needs has to be presumed just to finish the present applications.

The closest alternative is therefore not a single competing product. It is **Authelia or an existing identity provider, ordinary JWT/OIDC libraries, JobDB's existing capabilities, Gitvend's existing gateway, and explicit application permission adapters**.

## A sensible sequence

1. Finish Cortex login and project authorization; remove the email-cookie trust boundary.
2. Complete JobDB service authentication and route/internal-operation coverage while preserving cell and lease behavior.
3. Deploy Gitvend using its existing issuer and JobDB plugin; test restrictions with actual Git operations.
4. Prove the complete path across two tenants, including allowed/denied operations, token/key rotation, and parent-lease loss. Coordinate the actual JobDB/c2j/Cortex versions used.
5. Measure what remains duplicated. Extract common issuance, verification, and capability semantics into c2a only where that reduces code and independent reasoning.

c2a's strongest justification would be that the fourth application can adopt those shared guarantees with materially less custom security work. Until then, the existing applications plus well-chosen libraries are a credible, favorable-license solution in their own right.
