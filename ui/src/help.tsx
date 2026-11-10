import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Database,
  Gauge,
  KeyRound,
  Network,
  PlayCircle,
  Search,
  ServerCog,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

export type GuideTopic = "architecture" | "concepts" | "demo" | "integration" | "configuration" | "troubleshooting";
export type GuideDestination = "overview" | "vocabulary" | "scopes" | "subjects" | "publishing" | "operations" | "audit" | "simulator" | "help";

const TOPICS: Array<{ id: GuideTopic; label: string; detail: string; keywords: string; icon: typeof Activity }> = [
  { id: "architecture", label: "Architecture", detail: "Components and request flow", keywords: "diagram authn authz management cedar worker r2 d1", icon: Network },
  { id: "concepts", label: "Concepts", detail: "Vocabulary and entitlement model", keywords: "scope subject role group binding path action claims azs", icon: BookOpen },
  { id: "demo", label: "Demo walkthrough", detail: "Explore the seeded project", keywords: "local ports alice carol admin automation test", icon: PlayCircle },
  { id: "integration", label: "Integration", detail: "Adopt all or part of the stack", keywords: "proxy embedded external entitlement custom management identity", icon: Code2 },
  { id: "configuration", label: "Configuration", detail: "Workers, tokens and artifacts", keywords: "environment variables r2 jwks issuer openapi cedar", icon: Settings2 },
  { id: "troubleshooting", label: "Troubleshooting", detail: "Errors and diagnostic checks", keywords: "cors token forbidden scope policy config cache", icon: Gauge },
];

export const PAGE_GUIDES: Record<Exclude<GuideDestination, "help">, { title: string; body: string; topic: GuideTopic }> = {
  overview: {
    title: "Start with the service boundary",
    body: "This page summarizes one protected service. Its vocabulary defines the concepts that scopes, policies, claims, and Cedar decisions may use.",
    topic: "architecture",
  },
  vocabulary: {
    title: "Vocabulary is the service contract",
    body: "Define known scope types, resources, actions, path spaces, permission profiles, and roles before creating entitlements. OpenAPI can derive actions and resources.",
    topic: "concepts",
  },
  scopes: {
    title: "Scopes contain access",
    body: "A scope is a project, workspace, organization, account, or other service-defined container. Groups, bindings, and named paths are evaluated within it.",
    topic: "concepts",
  },
  subjects: {
    title: "Subjects become principals",
    body: "Users and service accounts receive effective roles, groups, and path grants. Claim preview shows the compact scope entries authn will place in the next JWT.",
    topic: "concepts",
  },
  publishing: {
    title: "Publishing changes runtime behavior",
    body: "Drafts are validated and reviewed before immutable service or scope artifacts are written to R2. The gateway reads manifests and never writes policy state.",
    topic: "configuration",
  },
  operations: {
    title: "Operational state is separate from policy design",
    body: "Use this view for projection freshness, emergency access, review queues, and artifact replication. Break-glass grants affect newly minted tokens only.",
    topic: "troubleshooting",
  },
  audit: {
    title: "Every control-plane change has an actor",
    body: "Audit events connect mutations and publication to the human or automation identity that performed them. Filter by action, actor, or target during review.",
    topic: "configuration",
  },
  simulator: {
    title: "Simulate before publishing",
    body: "Select a subject, scope, and service action to inspect the expected decision and matching bindings without calling the protected upstream.",
    topic: "demo",
  },
};

const TOUR_STEPS: Array<{ view: GuideDestination; eyebrow: string; title: string; body: string }> = [
  { view: "overview", eyebrow: "1 · System", title: "Three services, one decision path", body: "Authn proves identity and mints claims. Authz verifies the token and evaluates Cedar. Management defines and publishes the authorization vocabulary and entitlements." },
  { view: "vocabulary", eyebrow: "2 · Model", title: "Inspect the service vocabulary", body: "Actions, resources, scope types, path spaces, permission profiles, and role templates are the allowed language for this service." },
  { view: "scopes", eyebrow: "3 · Entitlements", title: "Follow access inside a scope", body: "Open Project Alpha and inspect its groups, role bindings, and named path grants. Scope-local state compiles into one runtime artifact." },
  { view: "subjects", eyebrow: "4 · Tokens", title: "Preview a subject's compact claims", body: "Claim preview resolves direct and group-derived access into the azs strings embedded in the subject's next access token." },
  { view: "simulator", eyebrow: "5 · Decisions", title: "Evaluate a decision safely", body: "Choose a subject, scope, and action. The result explains whether current entitlement state would allow the request." },
  { view: "publishing", eyebrow: "6 · Runtime", title: "Review immutable publication", body: "A second actor reviews the diff and impact before a version is published. Manifests point the gateway at active immutable artifacts." },
  { view: "help", eyebrow: "7 · Integration", title: "Choose only the services you need", body: "The Help center covers full-stack, authz-only, authn-plus-authz, proxy, embedded, and external-entitlement integration paths." },
];

export function HelpTip({ label, children }: { label: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className="help-tip">
    <button type="button" className="help-tip-trigger" aria-label={`Help: ${label}`} aria-expanded={open} title={label} onClick={() => setOpen(!open)}><CircleHelp /></button>
    {open && <span className="help-tip-popover" role="tooltip">{children ?? label}</span>}
  </span>;
}

export function ContextGuide({ destination, onOpen }: { destination: Exclude<GuideDestination, "help">; onOpen: (topic: GuideTopic) => void }) {
  const guide = PAGE_GUIDES[destination];
  return <aside className="context-guide">
    <BookOpen />
    <div><strong>{guide.title}</strong><p>{guide.body}</p></div>
    <button type="button" onClick={() => onOpen(guide.topic)}>Learn more<ArrowRight /></button>
  </aside>;
}

export function NewUserTour({
  open,
  step,
  onStep,
  onNavigate,
  onClose,
  onFinish,
  onDisable,
}: {
  open: boolean;
  step: number;
  onStep: (step: number) => void;
  onNavigate: (view: GuideDestination) => void;
  onClose: () => void;
  onFinish: () => void;
  onDisable: () => void;
}) {
  if (!open) return null;
  const item = TOUR_STEPS[step]!;
  function move(next: number) {
    onStep(next);
    onNavigate(TOUR_STEPS[next]!.view);
  }
  return <aside className="tour-panel" aria-live="polite" aria-label="New user walkthrough">
    <div className="tour-progress" aria-label={`Step ${step + 1} of ${TOUR_STEPS.length}`}>
      {TOUR_STEPS.map((value, index) => <span key={value.title} className={index <= step ? "complete" : ""} />)}
    </div>
    <button type="button" className="tour-close" aria-label="Pause walkthrough" title="Pause walkthrough" onClick={onClose}><X /></button>
    <span className="eyebrow">{item.eyebrow}</span>
    <h2>{item.title}</h2>
    <p>{item.body}</p>
    <div className="tour-actions">
      {step > 0 && <button type="button" onClick={() => move(step - 1)}>Back</button>}
      <button type="button" className="text-command" onClick={onDisable}>Hide learning aids</button>
      {step < TOUR_STEPS.length - 1
        ? <button type="button" className="primary" onClick={() => move(step + 1)}>Next step<ArrowRight /></button>
        : <button type="button" className="primary" onClick={onFinish}><Check />Finish</button>}
    </div>
  </aside>;
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="guide-code"><code>{children}</code></pre>;
}

function ArchitectureGuide() {
  return <>
    <GuideHeading eyebrow="System map" title="How a request becomes a Cedar decision" detail="The services are separable. Only authz is required on the protected request path." />
    <div className="architecture-diagram" role="img" aria-label="Client authenticates with authn, calls authz, and authz protects the application while reading R2 artifacts published by management">
      <div className="architecture-lane">
        <ArchitectureNode icon={<Users />} title="User or client" detail="Presents credentials" />
        <ChevronRight />
        <ArchitectureNode icon={<KeyRound />} title="Authentication" detail="Issues JWT + azs" accent />
        <ChevronRight />
        <ArchitectureNode icon={<ShieldCheck />} title="Authorization" detail="Verifies + evaluates" accent />
        <ChevronRight />
        <ArchitectureNode icon={<ServerCog />} title="Application" detail="Runs after allow" />
      </div>
      <div className="architecture-lane control-lane">
        <ArchitectureNode icon={<Users />} title="Administrator" detail="Changes access" />
        <ChevronRight />
        <ArchitectureNode icon={<Settings2 />} title="Management" detail="Validates + publishes" />
        <ChevronRight />
        <ArchitectureNode icon={<Database />} title="D1 source of truth" detail="Drafts + entitlements" />
        <ChevronRight />
        <ArchitectureNode icon={<Cloud />} title="R2 artifacts" detail="Read by authz" />
      </div>
    </div>
    <section className="guide-section"><h2>Component boundaries</h2>
      <div className="guide-table-wrap"><table className="guide-table"><thead><tr><th>Component</th><th>Owns</th><th>Does not own</th></tr></thead><tbody>
        <tr><th>Authentication</th><td>Identity proofing, sessions, signing keys, JWT issuance</td><td>Cedar evaluation or policy publication</td></tr>
        <tr><th>Authorization</th><td>Token verification, scope resolution, route mapping, Cedar decisions</td><td>User login or control-plane writes</td></tr>
        <tr><th>Management</th><td>Vocabulary, scopes, entitlements, drafts, audit, immutable publication</td><td>Protected request handling</td></tr>
      </tbody></table></div>
    </section>
    <section className="guide-section"><h2>Protected request lifecycle</h2><ol className="guide-steps">
      <li><strong>Match the route.</strong><span>The compiled OpenAPI auth descriptor supplies the action, resource, and path-space metadata.</span></li>
      <li><strong>Resolve the scope.</strong><span>An ordered path, header, JSON-body, or text-body resolver yields the current authorization container.</span></li>
      <li><strong>Verify identity.</strong><span>The gateway verifies signature, issuer, audience, expiry, suspension state, and the matching compact scope claim.</span></li>
      <li><strong>Load policy.</strong><span>Service-global policy and snippets combine with the active scope-local artifact from R2.</span></li>
      <li><strong>Evaluate Cedar.</strong><span>Allow continues to the application; deny returns 403 before application behavior runs.</span></li>
    </ol></section>
  </>;
}

function ArchitectureNode({ icon, title, detail, accent = false }: { icon: ReactNode; title: string; detail: string; accent?: boolean }) {
  return <div className={`architecture-node${accent ? " accent" : ""}`}>{icon}<span><strong>{title}</strong><small>{detail}</small></span></div>;
}

function ConceptsGuide() {
  const concepts = [
    ["Service vocabulary", "The versioned set of concepts administrators may use for one protected service."],
    ["Scope", "A service-defined authorization container such as an organization, workspace, project, account, or environment."],
    ["Subject", "A user, service account, or group that can receive access."],
    ["Principal", "The request-time Cedar actor assembled from the verified subject and current scope claim."],
    ["Action", "A service operation derived from OpenAPI and mapped to one permission."],
    ["Resource", "The object or scope on which the action is attempted."],
    ["Role template", "A reusable service-level bundle of grants that can be bound within scopes."],
    ["Binding", "An edge assigning a role or direct permission to a subject in a scope."],
    ["Group", "A scope-local subject collection; nested membership is expanded and cycle checked."],
    ["Path space", "A named hierarchical resource system with service or resource anchoring."],
    ["Named path", "A reusable, vocabulary-validated path prefix referenced by compact claims."],
    ["Permission profile", "A catalog such as object or path that gives permission IDs their service-local meaning."],
  ];
  return <>
    <GuideHeading eyebrow="Mental model" title="The vocabulary behind a decision" detail="Management validates these concepts; authn compacts them; authz expands and evaluates them." />
    <dl className="glossary-grid">{concepts.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
    <section className="guide-section"><h2>Compact scope claim</h2><p>Each <code>azs</code> entry carries effective access for one scope without putting policy text in the token.</p>
      <CodeBlock>{`pa|rviewer|gcontractors|Pr:files:shared-docs|pw:files:home/alice/drafts/`}</CodeBlock>
      <dl className="claim-legend">
        <div><dt><code>pa</code></dt><dd>Scope claim reference, usually a compact claimId.</dd></div>
        <div><dt><code>rviewer</code></dt><dd>Effective role template ID.</dd></div>
        <div><dt><code>gcontractors</code></dt><dd>Effective group membership.</dd></div>
        <div><dt><code>Pr:files:shared-docs</code></dt><dd>Read permission on a named path in the files namespace.</dd></div>
        <div><dt><code>pw:files:...</code></dt><dd>Write permission on an inline prefix.</dd></div>
      </dl>
    </section>
  </>;
}

function DemoGuide({ onNavigate }: { onNavigate: (view: GuideDestination) => void }) {
  return <>
    <GuideHeading eyebrow="Executable example" title="Project Workspace demo walkthrough" detail="The seed data is designed to show allowed, denied, inherited, path-aware, emergency, and publication behavior." />
    <section className="guide-section first"><h2>Start and verify</h2>
      <CodeBlock>{`npm run demo:up\n# In another terminal\nnpm run demo:request -- --user alice --method GET --path /projects/proj-alpha --scope proj-alpha\nnpm run demo:test`}</CodeBlock>
      <div className="guide-table-wrap"><table className="guide-table"><thead><tr><th>Local service</th><th>URL</th><th>Purpose</th></tr></thead><tbody>
        <tr><th>Authorization gateway</th><td><code>127.0.0.1:8787</code></td><td>Protected request entrypoint</td></tr>
        <tr><th>Authentication</th><td><code>127.0.0.1:8788</code></td><td>Login, sessions, tokens, JWKS</td></tr>
        <tr><th>Management</th><td><code>127.0.0.1:8789</code></td><td>OpenAPI control plane</td></tr>
        <tr><th>Sample API</th><td><code>127.0.0.1:8790</code></td><td>Protected upstream</td></tr>
        <tr><th>Console</th><td><code>127.0.0.1:5173</code></td><td>This user interface</td></tr>
      </tbody></table></div>
    </section>
    <section className="guide-section"><h2>Seeded identities</h2>
      <div className="guide-table-wrap"><table className="guide-table"><thead><tr><th>Identity</th><th>What to observe</th><th>Local credential</th></tr></thead><tbody>
        <tr><th>Alice Viewer</th><td>Reads projects and named paths; cannot update projects.</td><td><code>alice / alice-password</code></td></tr>
        <tr><th>Carol Manager</th><td>Inherits project-manager through nested group membership.</td><td><code>carol / carol-password</code></td></tr>
        <tr><th>Admin</th><td>Manages scope bindings and demonstrates reviewed changes.</td><td><code>admin / admin-password</code></td></tr>
        <tr><th>Dataset automation</th><td>Reads the dataset namespace but not the files namespace.</td><td><code>automation-client-secret</code></td></tr>
      </tbody></table></div>
    </section>
    <section className="guide-section"><h2>Suggested console path</h2><ol className="guide-steps compact">
      <li><strong>Vocabulary</strong><span>Compare actions and path spaces imported from the sample OpenAPI document.</span><button onClick={() => onNavigate("vocabulary")}>Open<ArrowRight /></button></li>
      <li><strong>Scopes & access</strong><span>Inspect Project Alpha groups, bindings, and named paths.</span><button onClick={() => onNavigate("scopes")}>Open<ArrowRight /></button></li>
      <li><strong>Subjects</strong><span>Preview Alice and Carol's compact claims.</span><button onClick={() => onNavigate("subjects")}>Open<ArrowRight /></button></li>
      <li><strong>Simulator</strong><span>Compare readProject with updateProject for different subjects.</span><button onClick={() => onNavigate("simulator")}>Open<ArrowRight /></button></li>
      <li><strong>Publishing</strong><span>Review diff, impact, immutable version history, and two-person approval.</span><button onClick={() => onNavigate("publishing")}>Open<ArrowRight /></button></li>
    </ol></section>
  </>;
}

function IntegrationGuide() {
  return <>
    <GuideHeading eyebrow="Composable adoption" title="Choose the services your system needs" detail="The services have explicit contracts so existing identity, entitlement, policy-management, and application systems can stay in place." />
    <div className="adoption-grid">
      <AdoptionOption title="Authorization only" services={[false, true, false]} detail="Keep your identity provider and policy-management tooling. Mint compatible JWTs and publish runtime artifacts directly to R2." />
      <AdoptionOption title="Authn + authorization" services={[true, true, false]} detail="Use this token issuer and gateway while your existing entitlement service supplies compact claims through a web-service contract." recommended />
      <AdoptionOption title="Management + authorization" services={[false, true, true]} detail="Keep your issuer. The JWT must expose the expected subject, audience, suspension state, and compact azs claims." />
      <AdoptionOption title="Complete stack" services={[true, true, true]} detail="Use D1 management state, projected claims, bundled authn, R2 publication, Cedar enforcement, and the reference console." />
    </div>
    <section className="guide-section"><h2>Authn with an external entitlement service</h2>
      <p><code>MANAGEMENT_API_URL</code> is a compatibility endpoint, not a requirement to deploy this management service. Point it at any trusted internal service that implements the claim-preview contract. Set <code>MANAGEMENT_API_TOKEN</code> as a Worker secret, or bind the service as <code>MANAGEMENT_API</code>.</p>
      <CodeBlock>{`GET {MANAGEMENT_API_URL}/services/{serviceId}/subjects/{subjectId}/claim-preview\nAuthorization: Bearer {MANAGEMENT_API_TOKEN}\n\n200 OK\n{\n  "subjectId": "user-alice",\n  "serviceId": "projects-api",\n  "azv": 1,\n  "azs": ["pa|rviewer|Pr:files:shared-docs"]\n}`}</CodeBlock>
      <div className="callout"><CircleHelp /><p>The external endpoint owns entitlement calculation. Authn still owns identities, credentials, refresh sessions, key material, and token issuance. A failed entitlement lookup fails token issuance rather than minting an under-specified token.</p></div>
    </section>
    <section className="guide-section"><h2>Existing policy management with authz</h2>
      <p>Your publisher can bypass the management service. Validate and write immutable service and scope config objects, update each manifest last, then call the authenticated cache-invalidation route when immediate rollout is required.</p>
      <CodeBlock>{`authz/{serviceId}/service/{version}/config.json\nauthz/{serviceId}/service/manifest.json\nauthz/{serviceId}/scopes/{scopeId}/{version}/config.yaml\nauthz/{serviceId}/scopes/{scopeId}/manifest.json`}</CodeBlock>
    </section>
    <section className="guide-section"><h2>Protect an external HTTP service</h2><p>Proxy mode is the lowest-boilerplate option for existing backends. Allowed requests are forwarded to <code>UPSTREAM_ORIGIN</code> with trusted <code>x-authz-*</code> decision context.</p>
      <CodeBlock>{`import { createAuthzProxy, type AuthzProxyEnv } from "./lib";\n\ninterface Env extends AuthzProxyEnv { UPSTREAM_ORIGIN: string }\nexport default createAuthzProxy<Env>();`}</CodeBlock>
      <div className="guide-table-wrap"><table className="guide-table"><thead><tr><th>Request result</th><th>Proxy behavior</th></tr></thead><tbody>
        <tr><th>Protected allow</th><td>Forward to the upstream with trusted decision headers.</td></tr>
        <tr><th>Protected deny</th><td>Return 403 before the upstream runs.</td></tr>
        <tr><th>Unresolved route</th><td>Pass through to the upstream by default so the application can own unprotected routes.</td></tr>
      </tbody></table></div>
      <p>The upstream may consume <code>x-authz-principal-id</code>, <code>x-authz-scope-id</code>, <code>x-authz-scope-type</code>, <code>x-authz-operation-id</code>, <code>x-authz-action</code>, <code>x-authz-service-version</code>, and <code>x-authz-scope-version</code>. It should trust these only from the gateway.</p>
      <h3>Custom upstream routing</h3>
      <CodeBlock>{`createAuthzProxy<Env>({\n  async resolveUpstreamUrl({ request, env }) {\n    const url = new URL(request.url);\n    return new URL(url.pathname + url.search, env.UPSTREAM_ORIGIN);\n  },\n});`}</CodeBlock>
    </section>
    <section className="guide-section"><h2>Embed authz in an existing Worker</h2><p>Embedded mode avoids a proxy hop and keeps application routing in the protected Worker. Protected denies return before the application handler runs.</p>
      <CodeBlock>{`export default withAuthorization<Env>(\n  async (request, env, ctx, decision) => {\n    if (!decision) return new Response("not found", { status: 404 });\n    return handleApplicationRequest(request, decision);\n  },\n  { runtime: ({ env }) => ({\n      policyBucket: env.AUTHZ_BUCKET,\n      serviceIdentifier: "projects-api",\n      jwksUrl: "https://issuer.example.com/.well-known/jwks.json"\n  }) }\n);`}</CodeBlock>
      <p>A protected request needs a compiled route match, a scope ID from the configured resolver chain, a valid bearer JWT, and a matching compact scope entry in <code>azs</code>. Unresolved routes reach the application handler with <code>decision = null</code>.</p>
    </section>
  </>;
}

function AdoptionOption({ title, services, detail, recommended = false }: { title: string; services: [boolean, boolean, boolean]; detail: string; recommended?: boolean }) {
  return <article className="adoption-option">
    <header><h2>{title}</h2>{recommended && <span>Common migration</span>}</header>
    <div className="service-selection">{["Authn", "Authz", "Management"].map((service, index) => <span key={service} className={services[index] ? "selected" : ""}>{services[index] ? <Check /> : <X />}{service}</span>)}</div>
    <p>{detail}</p>
  </article>;
}

function ConfigurationGuide() {
  return <>
    <GuideHeading eyebrow="Reference" title="Configuration and artifact contracts" detail="Start with the minimum variables for the services you adopt, then add operational controls deliberately." />
    <section className="guide-section first"><h2>Authorization gateway</h2><ConfigTable rows={[
      ["POLICY_BUCKET", "R2 binding", "Published runtime artifacts"], ["SERVICE_IDENTIFIER", "String", "R2 root and default token audience"], ["JWKS_URL", "URL", "Issuer public signing keys"], ["UPSTREAM_ORIGIN", "URL", "Proxy destination"], ["JWT_ISSUER", "URL", "Expected token issuer"], ["SCOPE_RESOLUTION", "JSON", "Ordered scope resolver chain"],
    ]} /></section>
    <section className="guide-section"><h2>Authentication</h2><ConfigTable rows={[
      ["CONTROL_DB", "D1 binding", "Identities, credentials, and sessions"], ["JWT_PRIVATE_JWK", "Secret", "Current signing key"], ["JWT_PUBLIC_JWKS", "Secret/config", "Published current and overlap keys"], ["ALLOWED_AUDIENCES", "CSV", "Services that may receive tokens"], ["MANAGEMENT_API_URL", "URL", "Compatible entitlement projection service"], ["MANAGEMENT_API_TOKEN", "Secret", "Service-to-service projection credential"], ["OIDC_PROVIDERS_JSON", "Secret", "Trusted upstream federation providers"],
    ]} /></section>
    <section className="guide-section"><h2>Management</h2><ConfigTable rows={[
      ["CONTROL_DB", "D1 binding", "Control-plane source of truth"], ["POLICY_BUCKET", "R2 binding", "Primary runtime distribution"], ["POLICY_REPLICA_BUCKET", "R2 binding", "Optional artifact replica"], ["AUTHZ_ADMIN_URL", "URL", "Gateway cache invalidation endpoint"], ["AUTHZ_GATEWAY_TOKEN", "Secret", "Trusts actor headers from the admin gateway"], ["REQUIRE_PUBLISH_APPROVAL", "Boolean", "Enforces two-person publication"], ["BREAK_GLASS_MAX_SECONDS", "Integer", "Caps emergency access duration"],
    ]} /></section>
    <section className="guide-section"><h2>Scope resolution</h2><p>Resolvers run in order; the first valid scope wins. Use one clear source where possible and add fallbacks only when the protected API requires them.</p>
      <CodeBlock>{`[\n  { "type": "header", "header": "x-scope-id", "pattern": "^(?<scopeId>[A-Za-z0-9_-]+)$" },\n  { "type": "path", "pattern": "^/scopes/(?<scopeId>[^/]+)/" }\n]`}</CodeBlock>
    </section>
    <section className="guide-section"><h2>OpenAPI to authorization</h2><p>Import operation IDs and explicit <code>x-authz-*</code> metadata to compile routes into actions, resources, permission profiles, and path spaces. The gateway uses the compiled descriptor on the request path rather than parsing OpenAPI for every request.</p></section>
    <section className="guide-section"><h2>Cloudflare release workflow</h2><p>Use separate D1 databases, R2 buckets, signing keys, hostnames, and credentials for staging and production. Private JWKs and service tokens belong in Worker secrets, never in the React build environment.</p>
      <CodeBlock>{`# Validate every Worker bundle without remote changes\nnpm run deploy:cloudflare:dry-run -- --env staging\n\n# Apply migrations and deploy in dependency order\nnpm run deploy:cloudflare -- --env staging\n\n# Verify health, JWKS, OpenAPI, UI, and optional allow/deny requests\nnpm run smoke:cloudflare`}</CodeBlock>
      <div className="callout"><CircleHelp /><p>The deployment orchestrator requires <code>CLOUDFLARE_ACCOUNT_ID</code>, <code>CLOUDFLARE_API_TOKEN</code>, and <code>VITE_MANAGEMENT_API_BASE_URL</code>. Keep management behind an authenticated gateway; never expose <code>AUTHZ_GATEWAY_TOKEN</code> to the browser.</p></div>
    </section>
  </>;
}

function ConfigTable({ rows }: { rows: string[][] }) {
  return <div className="guide-table-wrap"><table className="guide-table"><thead><tr><th>Name</th><th>Type</th><th>Purpose</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}><th><code>{row[0]}</code></th><td>{row[1]}</td><td>{row[2]}</td></tr>)}</tbody></table></div>;
}

function TroubleshootingGuide() {
  const issues = [
    ["Browser blocks authorization header", "Confirm the management OPTIONS response allows authorization and that CORS_ORIGIN exactly matches the console origin, including hostname and port."],
    ["service_config_missing", "Publish a valid service-global artifact before publishing or evaluating any scope artifact."],
    ["scope_resolution_failed", "The route is protected but no configured resolver produced a scope ID. Inspect header, path, body, and resolver order."],
    ["invalid bearer token", "Check JWKS reachability, signing algorithm, key ID, issuer, audience, expiry, and clock skew."],
    ["forbidden", "The request was understood and authenticated, but effective roles, groups, direct grants, or path prefixes did not permit the action."],
    ["unknown_policy_include", "A scope includes a snippet name that is absent from the active service config."],
    ["change_request_stale", "The reviewed draft or active artifact changed after the request was created. Reject it and create a new review."],
    ["Claims do not change", "Entitlement changes affect newly minted access tokens. Refresh or log in again, then inspect claim preview and projection status."],
  ];
  return <>
    <GuideHeading eyebrow="Diagnostics" title="Understand failures by boundary" detail="Identify whether the failure is in browser transport, authentication, route/scope resolution, policy loading, or Cedar evaluation." />
    <div className="issue-list">{issues.map(([name, resolution]) => <details key={name}><summary><CircleHelp />{name}</summary><p>{resolution}</p></details>)}</div>
    <section className="guide-section"><h2>Local checks</h2><CodeBlock>{`npm run typecheck\nnpm test\nnpm run test:integration\nnpm run demo:test\nnpm run deploy:cloudflare:dry-run -- --env staging`}</CodeBlock></section>
    <section className="guide-section"><h2>Inspect a browser preflight</h2><CodeBlock>{`curl -i -X OPTIONS http://127.0.0.1:8789/services \\\n  -H 'Origin: http://127.0.0.1:5173' \\\n  -H 'Access-Control-Request-Method: GET' \\\n  -H 'Access-Control-Request-Headers: authorization'`}</CodeBlock></section>
  </>;
}

function GuideHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <header className="guide-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></header>;
}

export function HelpView({
  initialTopic,
  newUserMode,
  onNewUserMode,
  onStartTour,
  onNavigate,
}: {
  initialTopic: GuideTopic;
  newUserMode: boolean;
  onNewUserMode: (enabled: boolean) => void;
  onStartTour: () => void;
  onNavigate: (view: GuideDestination) => void;
}) {
  const [topic, setTopic] = useState<GuideTopic>(initialTopic);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => TOPICS.filter((item) => `${item.label} ${item.detail} ${item.keywords}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <>
    <header className="page-header"><div><h1>Help & integration</h1><p>Architecture, concepts, walkthroughs, configuration, and adoption guides</p></div><div className="page-actions">
      <label className="mode-toggle"><span>New user mode</span><button type="button" role="switch" aria-checked={newUserMode} aria-label="New user mode" className={newUserMode ? "enabled" : ""} onClick={() => onNewUserMode(!newUserMode)}><span /></button></label>
      <button type="button" onClick={onStartTour}><PlayCircle />Start walkthrough</button>
    </div></header>
    <div className="help-layout">
      <aside className="help-navigation">
        <div className="help-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search help" placeholder="Search help" /></div>
        <nav>{visible.map((item) => <button type="button" key={item.id} className={topic === item.id ? "active" : ""} onClick={() => setTopic(item.id)}><item.icon /><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight /></button>)}</nav>
        {!visible.length && <p className="help-no-results">No matching guide sections</p>}
      </aside>
      <article className="help-content">
        {topic === "architecture" && <ArchitectureGuide />}
        {topic === "concepts" && <ConceptsGuide />}
        {topic === "demo" && <DemoGuide onNavigate={onNavigate} />}
        {topic === "integration" && <IntegrationGuide />}
        {topic === "configuration" && <ConfigurationGuide />}
        {topic === "troubleshooting" && <TroubleshootingGuide />}
      </article>
    </div>
  </>;
}
