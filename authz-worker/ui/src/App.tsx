import {
  Activity,
  BookOpen,
  Boxes,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  FileKey,
  FlaskConical,
  FolderKey,
  History,
  KeyRound,
  LogOut,
  Menu,
  Network,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Siren,
  Gauge,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import type { components } from "../../src/management/generated-api";
import { loadConfig, managementClient, result } from "./api";

type Service = components["schemas"]["ManagedService"];
type Vocabulary = components["schemas"]["ServiceVocabulary"];
type Scope = components["schemas"]["Scope"];
type Subject = components["schemas"]["Subject"];
type Group = components["schemas"]["Group"];
type GroupMember = components["schemas"]["GroupMember"];
type Binding = components["schemas"]["Binding"];
type PathGrant = components["schemas"]["PathGrant"];
type ConfigVersion = components["schemas"]["ConfigVersion"];
type AuditEvent = components["schemas"]["AuditEvent"];
type ChangeRequest = components["schemas"]["ChangeRequest"];
type BreakGlassGrant = components["schemas"]["BreakGlassGrant"];
type OperationsStatus = components["schemas"]["OperationsStatus"];
type View = "overview" | "vocabulary" | "scopes" | "subjects" | "publishing" | "operations" | "audit" | "simulator";

const config = loadConfig();

const NAV_ITEMS: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "vocabulary", label: "Vocabulary", icon: BookOpen },
  { id: "scopes", label: "Scopes & access", icon: Network },
  { id: "subjects", label: "Subjects", icon: Users },
  { id: "publishing", label: "Publishing", icon: Rocket },
  { id: "operations", label: "Operations", icon: Gauge },
  { id: "audit", label: "Audit", icon: History },
  { id: "simulator", label: "Simulator", icon: FlaskConical },
];

function defaultVocabulary(serviceId: string): Vocabulary {
  return {
    serviceId,
    version: 1,
    scopeTypes: [{ id: "project", name: "Project" }],
    scopeHierarchy: [],
    resourceTypes: [],
    pathSpaces: [],
    actions: [],
    permissionProfiles: [
      { id: "object", name: "Object", permissions: [{ id: "read" }, { id: "write" }] },
      { id: "path", name: "Path", permissions: [{ id: "r" }, { id: "w" }] },
    ],
    roleTemplates: [{ id: "viewer", name: "Viewer", grants: [] }],
    subjectKinds: ["User", "ServiceAccount", "Group"],
    claimConventions: { scopeReference: "claimId", authorizationClaim: "azs", authorizationVersion: 1 },
    updatedAt: new Date().toISOString(),
  };
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><h2>{title}</h2><IconButton label="Close" onClick={onClose}><X /></IconButton></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

function IconButton({ label, children, onClick, disabled = false, danger = false }: { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" className={`icon-button${danger ? " danger" : ""}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PageHeader({ title, detail, actions }: { title: string; detail?: string; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{detail && <p>{detail}</p>}</div><div className="page-actions">{actions}</div></header>;
}

function Empty({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="empty"><Boxes /><span>{title}</span>{action}</div>;
}

function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value}</span>;
}

function SignIn({ onToken }: { onToken: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "token">("login");
  const [username, setUsername] = useState("alice");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(config.accessToken ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "token") return onToken(token.trim());
    setPending(true);
    setError("");
    try {
      const response = await fetch(`${config.authnBaseUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, audience: config.audience }),
      });
      const value = await response.json() as { accessToken?: string; error?: { message?: string } };
      if (!response.ok || !value.accessToken) throw new Error(value.error?.message ?? "Sign in failed");
      onToken(value.accessToken);
    } catch (value) { setError(value instanceof Error ? value.message : "Sign in failed"); }
    finally { setPending(false); }
  }

  return <main className="sign-in-shell">
    <section className="sign-in-panel">
      <div className="brand-mark"><ShieldCheck /><span>Authorization Console</span></div>
      <div className="segmented" role="tablist">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Account</button>
        <button className={mode === "token" ? "active" : ""} onClick={() => setMode("token")}>Access token</button>
      </div>
      <form onSubmit={submit}>
        {mode === "login" ? <>
          <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        </> : <label>Token<textarea value={token} onChange={(event) => setToken(event.target.value)} rows={5} required /></label>}
        {error && <div className="inline-error"><CircleAlert />{error}</div>}
        <button className="primary wide" disabled={pending}><KeyRound />{pending ? "Signing in" : "Sign in"}</button>
      </form>
    </section>
  </main>;
}

export function App() {
  const [token, setTokenState] = useState(() => sessionStorage.getItem("authz-console-token") ?? config.accessToken ?? "");
  const [view, setView] = useState<View>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState(() => localStorage.getItem("authz-console-service") ?? "");
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [createService, setCreateService] = useState(false);
  const client = useMemo(() => managementClient(config, token), [token]);
  const selectedService = services.find((service) => service.serviceId === serviceId);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [servicePage, subjectPage] = await Promise.all([
        result(client.GET("/services")),
        result(client.GET("/subjects")),
      ]);
      setServices(servicePage.items);
      setSubjects(subjectPage.items);
      const nextService = servicePage.items.some((value) => value.serviceId === serviceId)
        ? serviceId
        : servicePage.items[0]?.serviceId ?? "";
      setServiceId(nextService);
      if (nextService) {
        const scopePage = await result(client.GET("/scopes", { params: { query: { serviceId: nextService } } }));
        setScopes(scopePage.items);
      } else setScopes([]);
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to load management state"); }
    finally { setLoading(false); }
  }, [client, serviceId, token]);

  useEffect(() => { void load(); }, [load]);

  function setToken(value: string) {
    sessionStorage.setItem("authz-console-token", value);
    setTokenState(value);
  }
  function selectService(value: string) {
    localStorage.setItem("authz-console-service", value);
    setServiceId(value);
  }
  function logout() {
    sessionStorage.removeItem("authz-console-token");
    setTokenState("");
  }
  if (!token) return <SignIn onToken={setToken} />;

  const context = { client, serviceId, selectedService, scopes, subjects, readOnly: config.readOnly, reload: load };
  return <div className="app-shell">
    <aside className={`sidebar${mobileNav ? " open" : ""}`}>
      <div className="brand-mark"><ShieldCheck /><span>Authorization</span></div>
      <label className="service-picker">Service<select value={serviceId} onChange={(event) => selectService(event.target.value)}>
        {!services.length && <option value="">No services</option>}
        {services.map((service) => <option key={service.serviceId} value={service.serviceId}>{service.name}</option>)}
      </select></label>
      <nav>{NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}><item.icon />{item.label}</button>)}</nav>
      <div className="sidebar-footer">
        {config.readOnly && <span className="read-only"><FileKey />Read only</span>}
        <button onClick={logout}><LogOut />Sign out</button>
      </div>
    </aside>
    <main className="workspace">
      <div className="mobile-bar"><IconButton label="Open navigation" onClick={() => setMobileNav(!mobileNav)}><Menu /></IconButton><span>{selectedService?.name ?? "Authorization"}</span></div>
      {error && <div className="banner-error"><CircleAlert /><span>{error}</span><IconButton label="Dismiss" onClick={() => setError("")}><X /></IconButton></div>}
      {loading ? <div className="loading"><RefreshCw />Loading</div> : <>
        {view === "overview" && <Overview {...context} onCreateService={() => setCreateService(true)} />}
        {view === "vocabulary" && <VocabularyView {...context} />}
        {view === "scopes" && <ScopesView {...context} />}
        {view === "subjects" && <SubjectsView {...context} />}
        {view === "publishing" && <PublishingView {...context} />}
        {view === "operations" && <OperationsView {...context} />}
        {view === "audit" && <AuditView {...context} />}
        {view === "simulator" && <SimulatorView {...context} />}
      </>}
    </main>
    {createService && <CreateServiceModal client={client} onClose={() => setCreateService(false)} onCreated={async () => { setCreateService(false); await load(); }} />}
  </div>;
}

type Context = {
  client: ReturnType<typeof managementClient>;
  serviceId: string;
  selectedService?: Service;
  scopes: Scope[];
  subjects: Subject[];
  readOnly: boolean;
  reload: () => Promise<void>;
};

function Overview({ selectedService, scopes, subjects, onCreateService, readOnly }: Context & { onCreateService: () => void }) {
  if (!selectedService) return <><PageHeader title="Overview" actions={!readOnly && <button className="primary" onClick={onCreateService}><Plus />New service</button>} /><Empty title="No managed services" /></>;
  const vocabulary = selectedService.vocabulary;
  return <>
    <PageHeader title={selectedService.name} detail={selectedService.description ?? selectedService.serviceId} />
    <div className="metric-strip">
      <div><span>Scopes</span><strong>{scopes.length}</strong></div>
      <div><span>Subjects</span><strong>{subjects.length}</strong></div>
      <div><span>Actions</span><strong>{vocabulary.actions.length}</strong></div>
      <div><span>Roles</span><strong>{vocabulary.roleTemplates.length}</strong></div>
    </div>
    <section className="content-section"><div className="section-title"><h2>Runtime status</h2></div>
      <dl className="definition-grid">
        <div><dt>Service ID</dt><dd><code>{selectedService.serviceId}</code></dd></div>
        <div><dt>Vocabulary</dt><dd>Version {vocabulary.version}</dd></div>
        <div><dt>Active config</dt><dd>{selectedService.activeServiceVersion ? <Status value="published" /> : <Status value="draft" />}</dd></div>
        <div><dt>Claim reference</dt><dd>{vocabulary.claimConventions.scopeReference}</dd></div>
      </dl>
    </section>
    <section className="content-section"><div className="section-title"><h2>Scope hierarchy</h2></div>
      <div className="hierarchy-line">{vocabulary.scopeTypes.map((type, index) => <span key={type.id}>{index > 0 && <ChevronRight />}{type.name ?? type.id}</span>)}</div>
    </section>
  </>;
}

function CreateServiceModal({ client, onClose, onCreated }: { client: Context["client"]; onClose: () => void; onCreated: () => void }) {
  const [serviceId, setServiceId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await result(client.POST("/services", { body: { serviceId, name, vocabulary: defaultVocabulary(serviceId) } }));
      onCreated();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to create service"); }
  }
  return <Modal title="New service" onClose={onClose}><form onSubmit={submit} className="form-grid">
    <label>Service ID<input value={serviceId} onChange={(event) => setServiceId(event.target.value)} pattern="[A-Za-z][A-Za-z0-9_.-]*" required /></label>
    <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
    {error && <div className="inline-error"><CircleAlert />{error}</div>}
    <div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Plus />Create</button></div>
  </form></Modal>;
}

function VocabularyView({ client, selectedService, readOnly, reload }: Context) {
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [source, setSource] = useState("");
  const [openApi, setOpenApi] = useState("{\n  \"openapi\": \"3.1.0\",\n  \"info\": { \"title\": \"Service API\", \"version\": \"1.0.0\" },\n  \"paths\": {}\n}");
  const [error, setError] = useState("");
  const vocabulary = selectedService?.vocabulary;
  useEffect(() => setSource(vocabulary ? JSON.stringify(vocabulary, null, 2) : ""), [vocabulary]);
  if (!selectedService || !vocabulary) return <><PageHeader title="Vocabulary" /><Empty title="Select a service" /></>;
  const activeServiceId = selectedService.serviceId;
  const vocabularyVersion = vocabulary.version;
  async function save() {
    try {
      const parsed = JSON.parse(source) as Vocabulary;
      await result(client.PUT("/services/{serviceId}/vocabulary", { params: { path: { serviceId: activeServiceId }, header: { "If-Match": String(vocabularyVersion) } }, body: parsed }));
      setEditing(false); await reload();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to save vocabulary"); }
  }
  async function importDocument() {
    try {
      await result(client.POST("/services/{serviceId}/import-openapi", { params: { path: { serviceId: activeServiceId } }, body: { document: JSON.parse(openApi) } }));
      setImporting(false); await reload();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to import OpenAPI"); }
  }
  return <>
    <PageHeader title="Service vocabulary" detail={`Version ${vocabulary.version}`} actions={<>
      <button onClick={() => setImporting(true)} disabled={readOnly}><Upload />Import OpenAPI</button>
      <button className="primary" onClick={() => setEditing(true)} disabled={readOnly}><Braces />Edit JSON</button>
    </>} />
    {error && <div className="inline-error"><CircleAlert />{error}</div>}
    <div className="concept-grid">
      <ConceptTable title="Scope types" icon={<Network />} rows={vocabulary.scopeTypes.map((value) => [value.id, value.name ?? ""])} />
      <ConceptTable title="Resource types" icon={<Boxes />} rows={vocabulary.resourceTypes.map((value) => [value.id, value.scopeTypes?.join(", ") ?? ""])} />
      <ConceptTable title="Path spaces" icon={<FolderKey />} rows={vocabulary.pathSpaces.map((value) => [value.id, value.anchorKind])} />
      <ConceptTable title="Actions" icon={<Activity />} rows={vocabulary.actions.map((value) => [value.id, `${value.permissionProfile}:${value.permissionId}`])} />
      <ConceptTable title="Roles" icon={<ShieldCheck />} rows={vocabulary.roleTemplates.map((value) => [value.id, `${value.grants.length} grants`])} />
      <ConceptTable title="Profiles" icon={<KeyRound />} rows={vocabulary.permissionProfiles.map((value) => [value.id, value.permissions.map((permission) => permission.id).join(", ")])} />
    </div>
    {editing && <Modal title="Edit vocabulary" onClose={() => setEditing(false)}><textarea className="code-editor" value={source} onChange={(event) => setSource(event.target.value)} rows={25} spellCheck={false} /><div className="form-actions"><button onClick={() => setEditing(false)}>Cancel</button><button className="primary" onClick={save}><Save />Save</button></div></Modal>}
    {importing && <Modal title="Import OpenAPI" onClose={() => setImporting(false)}><textarea className="code-editor" value={openApi} onChange={(event) => setOpenApi(event.target.value)} rows={22} spellCheck={false} /><div className="form-actions"><button onClick={() => setImporting(false)}>Cancel</button><button className="primary" onClick={importDocument}><Upload />Import</button></div></Modal>}
  </>;
}

function ConceptTable({ title, icon, rows }: { title: string; icon: ReactNode; rows: string[][] }) {
  return <section className="concept-panel"><header>{icon}<h2>{title}</h2><span>{rows.length}</span></header>{rows.length ? <table><tbody>{rows.map((row) => <tr key={row[0]}><th>{row[0]}</th><td>{row[1]}</td></tr>)}</tbody></table> : <div className="muted-row">None</div>}</section>;
}

function ScopesView(context: Context) {
  const { client, serviceId, selectedService, scopes, subjects, readOnly, reload } = context;
  const [selected, setSelected] = useState(scopes[0]?.scopeId ?? "");
  const [creating, setCreating] = useState(false);
  const selectedScope = scopes.find((scope) => scope.scopeId === selected);
  useEffect(() => { if (!scopes.some((scope) => scope.scopeId === selected)) setSelected(scopes[0]?.scopeId ?? ""); }, [scopes, selected]);
  if (!selectedService) return <><PageHeader title="Scopes & access" /><Empty title="Select a service" /></>;
  return <>
    <PageHeader title="Scopes & access" detail={`${scopes.length} scopes`} actions={<button className="primary" disabled={readOnly} onClick={() => setCreating(true)}><Plus />New scope</button>} />
    <div className="split-view">
      <section className="list-panel"><div className="filter-box"><Search /><input placeholder="Filter scopes" aria-label="Filter scopes" /></div>
        {scopes.map((scope) => <button className={`list-row${selected === scope.scopeId ? " selected" : ""}`} key={scope.scopeId} onClick={() => setSelected(scope.scopeId)}><span><strong>{scope.name}</strong><small>{scope.scopeType} · {scope.scopeId}</small></span><ChevronRight /></button>)}
        {!scopes.length && <Empty title="No scopes" />}
      </section>
      <section className="detail-panel">{selectedScope ? <ScopeDetail {...context} scope={selectedScope} /> : <Empty title="Select a scope" />}</section>
    </div>
    {creating && <ScopeModal client={client} serviceId={serviceId} scopes={scopes} scopeTypes={selectedService.vocabulary.scopeTypes.map((value) => value.id)} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />}
  </>;
}

function ScopeModal({ client, serviceId, scopes, scopeTypes, onClose, onCreated }: { client: Context["client"]; serviceId: string; scopes: Scope[]; scopeTypes: string[]; onClose: () => void; onCreated: () => void }) {
  const [scopeId, setScopeId] = useState(""); const [name, setName] = useState(""); const [scopeType, setScopeType] = useState(scopeTypes[0] ?? ""); const [parentScopeId, setParent] = useState(""); const [claimId, setClaimId] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); try { await result(client.POST("/scopes", { body: { scopeId, serviceId, scopeType, name, claimId, ...(parentScopeId ? { parentScopeId } : {}) } })); onCreated(); } catch (value) { setError(value instanceof Error ? value.message : "Unable to create scope"); } }
  return <Modal title="New scope" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <label>Scope ID<input value={scopeId} onChange={(event) => setScopeId(event.target.value)} required /></label><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
    <label>Type<select value={scopeType} onChange={(event) => setScopeType(event.target.value)}>{scopeTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Claim ID<input value={claimId} onChange={(event) => setClaimId(event.target.value)} required /></label>
    <label>Parent<select value={parentScopeId} onChange={(event) => setParent(event.target.value)}><option value="">None</option>{scopes.map((scope) => <option key={scope.scopeId} value={scope.scopeId}>{scope.name}</option>)}</select></label>
    {error && <div className="inline-error"><CircleAlert />{error}</div>}<div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Plus />Create</button></div>
  </form></Modal>;
}

function ScopeDetail({ client, selectedService, subjects, readOnly, reload, scope }: Context & { scope: Scope }) {
  const [tab, setTab] = useState<"groups" | "bindings" | "paths">("bindings");
  const [groups, setGroups] = useState<Group[]>([]); const [members, setMembers] = useState<GroupMember[]>([]); const [bindings, setBindings] = useState<Binding[]>([]); const [paths, setPaths] = useState<PathGrant[]>([]);
  const [modal, setModal] = useState<"group" | "binding" | "path" | "member" | null>(null); const [targetGroup, setTargetGroup] = useState("");
  const loadDetail = useCallback(async () => {
    const [groupPage, bindingPage, pathPage] = await Promise.all([
      result(client.GET("/scopes/{scopeId}/groups", { params: { path: { scopeId: scope.scopeId } } })),
      result(client.GET("/scopes/{scopeId}/bindings", { params: { path: { scopeId: scope.scopeId } } })),
      result(client.GET("/scopes/{scopeId}/path-grants", { params: { path: { scopeId: scope.scopeId } } })),
    ]);
    setGroups(groupPage.items); setMembers(groupPage.members); setBindings(bindingPage.items); setPaths(pathPage.items);
  }, [client, scope.scopeId]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);
  const done = async () => { setModal(null); await loadDetail(); await reload(); };
  return <>
    <div className="detail-heading"><div><span className="eyebrow">{scope.scopeType}</span><h2>{scope.name}</h2><code>{scope.scopeId}</code></div><Status value={scope.activeVersion ? "published" : "draft"} /></div>
    <div className="tabs">{(["bindings", "groups", "paths"] as const).map((value) => <button className={tab === value ? "active" : ""} onClick={() => setTab(value)} key={value}>{value}</button>)}</div>
    {tab === "bindings" && <><div className="section-title"><h3>Bindings</h3><IconButton label="Add binding" disabled={readOnly} onClick={() => setModal("binding")}><Plus /></IconButton></div>
      <DataTable headers={["Subject", "Grant", "Target", ""]} rows={bindings.map((binding) => [binding.subjectId, binding.roleId ?? `${binding.permissionProfile}:${binding.permissionId}`, binding.pathSpace ?? binding.resourceType ?? "scope", <IconButton label="Delete binding" danger disabled={readOnly} onClick={() => void result(client.DELETE("/scopes/{scopeId}/bindings/{bindingId}", { params: { path: { scopeId: scope.scopeId, bindingId: binding.bindingId } } })).then(done)}><Trash2 /></IconButton>])} />
    </>}
    {tab === "groups" && <><div className="section-title"><h3>Groups</h3><IconButton label="Add group" disabled={readOnly} onClick={() => setModal("group")}><Plus /></IconButton></div>
      <DataTable headers={["Group", "Members", ""]} rows={groups.map((group) => [group.name, members.filter((member) => member.groupId === group.groupId).map((member) => member.memberId).join(", ") || "None", <span className="row-actions"><IconButton label="Add member" disabled={readOnly} onClick={() => { setTargetGroup(group.groupId); setModal("member"); }}><Users /></IconButton><IconButton label="Delete group" danger disabled={readOnly} onClick={() => void result(client.DELETE("/scopes/{scopeId}/groups/{groupId}", { params: { path: { scopeId: scope.scopeId, groupId: group.groupId } } })).then(done)}><Trash2 /></IconButton></span>])} />
    </>}
    {tab === "paths" && <><div className="section-title"><h3>Named paths</h3><IconButton label="Add path" disabled={readOnly} onClick={() => setModal("path")}><Plus /></IconButton></div>
      <DataTable headers={["Name", "Space", "Prefix", "Permissions", ""]} rows={paths.map((path) => [path.name, path.pathSpace, <code>{path.prefix}</code>, path.permissions.join(", "), <IconButton label="Delete path" danger disabled={readOnly} onClick={() => void result(client.DELETE("/scopes/{scopeId}/path-grants/{pathGrantId}", { params: { path: { scopeId: scope.scopeId, pathGrantId: path.pathGrantId } } })).then(done)}><Trash2 /></IconButton>])} />
    </>}
    {modal === "group" && <SimpleCreate title="New group" fields={["groupId", "name"]} onClose={() => setModal(null)} onSubmit={(value) => result(client.POST("/scopes/{scopeId}/groups", { params: { path: { scopeId: scope.scopeId } }, body: { groupId: value.groupId!, name: value.name! } })).then(done)} />}
    {modal === "binding" && <BindingModal client={client} scope={scope} subjects={subjects} groups={groups} roles={selectedService?.vocabulary.roleTemplates.map((value) => value.id) ?? []} pathSpaces={selectedService?.vocabulary.pathSpaces.map((value) => value.id) ?? []} paths={paths} onClose={() => setModal(null)} onCreated={done} />}
    {modal === "path" && <PathModal client={client} scope={scope} pathSpaces={selectedService?.vocabulary.pathSpaces.map((value) => value.id) ?? []} onClose={() => setModal(null)} onCreated={done} />}
    {modal === "member" && <MemberModal client={client} scope={scope} groupId={targetGroup} subjects={subjects} groups={groups} onClose={() => setModal(null)} onCreated={done} />}
  </>;
}

function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <Empty title="No entries" />;
}

function SimpleCreate({ title, fields, onClose, onSubmit }: { title: string; fields: string[]; onClose: () => void; onSubmit: (values: Record<string, string>) => Promise<unknown> }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); try { await onSubmit(values); } catch (value) { setError(value instanceof Error ? value.message : "Unable to save"); } }
  return <Modal title={title} onClose={onClose}><form onSubmit={submit} className="form-grid">{fields.map((field) => <label key={field}>{field.replace(/([A-Z])/g, " $1")}<input value={values[field] ?? ""} onChange={(event) => setValues({ ...values, [field]: event.target.value })} required /></label>)}{error && <div className="inline-error"><CircleAlert />{error}</div>}<div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Check />Save</button></div></form></Modal>;
}

function BindingModal({ client, scope, subjects, groups, roles, pathSpaces, paths, onClose, onCreated }: { client: Context["client"]; scope: Scope; subjects: Subject[]; groups: Group[]; roles: string[]; pathSpaces: string[]; paths: PathGrant[]; onClose: () => void; onCreated: () => void }) {
  const [bindingId, setId] = useState(""); const [subject, setSubject] = useState(subjects[0]?.subjectId ?? groups[0]?.groupId ?? ""); const [grantType, setGrantType] = useState<"role" | "path">("role"); const [roleId, setRole] = useState(roles[0] ?? ""); const [pathSpace, setPathSpace] = useState(pathSpaces[0] ?? ""); const [namedPath, setNamedPath] = useState(""); const [permission, setPermission] = useState("r"); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const group = groups.some((value) => value.groupId === subject); try { await result(client.POST("/scopes/{scopeId}/bindings", { params: { path: { scopeId: scope.scopeId } }, body: { bindingId, subjectId: subject, subjectKind: group ? "Group" : subjects.find((value) => value.subjectId === subject)?.kind ?? "User", ...(grantType === "role" ? { roleId } : { permissionProfile: "path", permissionId: permission, pathSpace, namedPath }) } })); onCreated(); } catch (value) { setError(value instanceof Error ? value.message : "Unable to create binding"); } }
  return <Modal title="New binding" onClose={onClose}><form className="form-grid" onSubmit={submit}><label>Binding ID<input value={bindingId} onChange={(event) => setId(event.target.value)} required /></label><label>Subject<select value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((value) => <option key={value.subjectId} value={value.subjectId}>{value.displayName}</option>)}{groups.map((value) => <option key={value.groupId} value={value.groupId}>{value.name} (group)</option>)}</select></label><label>Grant<select value={grantType} onChange={(event) => setGrantType(event.target.value as "role" | "path")}><option value="role">Role</option><option value="path">Named path</option></select></label>{grantType === "role" ? <label>Role<select value={roleId} onChange={(event) => setRole(event.target.value)}>{roles.map((value) => <option key={value}>{value}</option>)}</select></label> : <><label>Path space<select value={pathSpace} onChange={(event) => setPathSpace(event.target.value)}>{pathSpaces.map((value) => <option key={value}>{value}</option>)}</select></label><label>Named path<select value={namedPath} onChange={(event) => setNamedPath(event.target.value)}><option value="">Select</option>{paths.filter((value) => value.pathSpace === pathSpace).map((value) => <option key={value.name}>{value.name}</option>)}</select></label><label>Permission<input value={permission} onChange={(event) => setPermission(event.target.value)} /></label></>}{error && <div className="inline-error"><CircleAlert />{error}</div>}<div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Plus />Create</button></div></form></Modal>;
}

function PathModal({ client, scope, pathSpaces, onClose, onCreated }: { client: Context["client"]; scope: Scope; pathSpaces: string[]; onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState(""); const [name, setName] = useState(""); const [space, setSpace] = useState(pathSpaces[0] ?? ""); const [prefix, setPrefix] = useState(""); const [permissions, setPermissions] = useState("r");
  async function submit(event: FormEvent) { event.preventDefault(); await result(client.POST("/scopes/{scopeId}/path-grants", { params: { path: { scopeId: scope.scopeId } }, body: { pathGrantId: id, name, pathSpace: space, prefix, permissions: permissions.split(",").map((value) => value.trim()) } })); onCreated(); }
  return <Modal title="New named path" onClose={onClose}><form className="form-grid" onSubmit={submit}><label>Path grant ID<input value={id} onChange={(event) => setId(event.target.value)} required /></label><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Path space<select value={space} onChange={(event) => setSpace(event.target.value)}>{pathSpaces.map((value) => <option key={value}>{value}</option>)}</select></label><label>Relative prefix<input value={prefix} onChange={(event) => setPrefix(event.target.value)} required /></label><label>Permissions<input value={permissions} onChange={(event) => setPermissions(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Plus />Create</button></div></form></Modal>;
}

function MemberModal({ client, scope, groupId, subjects, groups, onClose, onCreated }: { client: Context["client"]; scope: Scope; groupId: string; subjects: Subject[]; groups: Group[]; onClose: () => void; onCreated: () => void }) {
  const options = [...subjects.map((value) => ({ id: value.subjectId, label: value.displayName, kind: value.kind })), ...groups.filter((value) => value.groupId !== groupId).map((value) => ({ id: value.groupId, label: `${value.name} (group)`, kind: "Group" as const }))]; const [member, setMember] = useState(options[0]?.id ?? "");
  async function submit(event: FormEvent) { event.preventDefault(); const selected = options.find((value) => value.id === member)!; await result(client.PUT("/scopes/{scopeId}/groups/{groupId}/members/{subjectId}", { params: { path: { scopeId: scope.scopeId, groupId, subjectId: selected.id } }, body: { memberKind: selected.kind } })); onCreated(); }
  return <Modal title="Add group member" onClose={onClose}><form className="form-grid" onSubmit={submit}><label>Member<select value={member} onChange={(event) => setMember(event.target.value)}>{options.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label><div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Plus />Add</button></div></form></Modal>;
}

function SubjectsView({ client, serviceId, subjects, readOnly, reload }: Context) {
  const [creating, setCreating] = useState(false); const [preview, setPreview] = useState<{ subject: Subject; claims: string[] }>();
  async function showPreview(subject: Subject) { const value = await result(client.GET("/services/{serviceId}/subjects/{subjectId}/claim-preview", { params: { path: { serviceId, subjectId: subject.subjectId } } })); setPreview({ subject, claims: value.azs }); }
  return <><PageHeader title="Subjects" detail={`${subjects.length} users and service accounts`} actions={<button className="primary" disabled={readOnly} onClick={() => setCreating(true)}><Plus />New subject</button>} />
    <DataTable headers={["Subject", "Kind", "Status", "Claims"]} rows={subjects.map((subject) => [<span><strong>{subject.displayName}</strong><small>{subject.subjectId}</small></span>, subject.kind, <Status value={subject.status} />, <button onClick={() => void showPreview(subject)}><Braces />Preview</button>])} />
    {creating && <SubjectModal client={client} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />}
    {preview && <Modal title={preview.subject.displayName} onClose={() => setPreview(undefined)}>{preview.claims.length ? <pre className="claim-preview">{JSON.stringify({ azv: 1, azs: preview.claims }, null, 2)}</pre> : <Empty title="No effective claims" />}</Modal>}
  </>;
}

function SubjectModal({ client, onClose, onCreated }: { client: Context["client"]; onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState(""); const [name, setName] = useState(""); const [kind, setKind] = useState<"User" | "ServiceAccount">("User"); const [email, setEmail] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); await result(client.POST("/subjects", { body: { subjectId: id, displayName: name, kind, status: "active", ...(email ? { email } : {}) } })); onCreated(); }
  return <Modal title="New subject" onClose={onClose}><form className="form-grid" onSubmit={submit}><label>Subject ID<input value={id} onChange={(event) => setId(event.target.value)} required /></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Kind<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option>User</option><option>ServiceAccount</option></select></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Plus />Create</button></div></form></Modal>;
}

function PublishingView({ client, selectedService, scopes, readOnly, reload }: Context) {
  const [serviceVersions, setServiceVersions] = useState<ConfigVersion[]>([]);
  const [scopeVersions, setScopeVersions] = useState<ConfigVersion[]>([]);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [scopeId, setScopeId] = useState(scopes[0]?.scopeId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const loadVersions = useCallback(async () => {
    if (!selectedService) return;
    const [servicePage, changePage] = await Promise.all([
      result(client.GET("/services/{serviceId}/versions", { params: { path: { serviceId: selectedService.serviceId } } })),
      result(client.GET("/change-requests")),
    ]);
    setServiceVersions(servicePage.items);
    setChanges(changePage.items.filter((change) => change.serviceId === selectedService.serviceId));
    if (scopeId) {
      const scopePage = await result(client.GET("/scopes/{scopeId}/versions", { params: { path: { scopeId } } }));
      setScopeVersions(scopePage.items);
    }
  }, [client, scopeId, selectedService]);
  useEffect(() => { void loadVersions(); }, [loadVersions]);
  async function requestReview(targetType: "service" | "scope") {
    if (!selectedService || (targetType === "scope" && !scopeId)) return;
    setPending(true); setError("");
    try {
      await result(client.POST("/change-requests", { body: {
        targetType,
        serviceId: selectedService.serviceId,
        ...(targetType === "scope" ? { scopeId } : {}),
        summary: `Publish ${targetType} configuration from the current draft`,
      } }));
      await loadVersions();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to request review"); }
    finally { setPending(false); }
  }
  async function review(requestId: string, decision: "approve" | "reject") {
    setPending(true); setError("");
    try {
      await result(decision === "approve"
        ? client.POST("/change-requests/{requestId}/approve", { params: { path: { requestId } }, body: {} })
        : client.POST("/change-requests/{requestId}/reject", { params: { path: { requestId } }, body: {} }));
      await loadVersions(); await reload();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to review change"); }
    finally { setPending(false); }
  }
  return <><PageHeader title="Publishing" detail="Reviewed immutable runtime artifact versions" />
    {error && <div className="inline-error"><CircleAlert />{error}</div>}
    <section className="content-section"><div className="section-title"><h2>Review queue</h2></div>
      <DataTable headers={["Target", "Status", "Impact", "Requested by", ""]} rows={changes.map((change) => [
        change.scopeId ?? change.serviceId,
        <Status value={change.status} />,
        `${change.impact.affectedSubjects} subjects · ${change.impact.changedAreas.join(", ")}`,
        change.requestedBy,
        change.status === "pending" ? <span className="row-actions">
          <IconButton label="Approve" disabled={readOnly || pending} onClick={() => void review(change.requestId, "approve")}><Check /></IconButton>
          <IconButton label="Reject" danger disabled={readOnly || pending} onClick={() => void review(change.requestId, "reject")}><X /></IconButton>
        </span> : "",
      ])} />
    </section>
    <section className="publish-band"><div><h2>Service configuration</h2><span>{selectedService?.activeServiceVersion ?? "Not published"}</span></div><button className="primary" disabled={readOnly || pending || !selectedService} onClick={() => void requestReview("service")}><Rocket />Request service review</button></section>
    <DataTable headers={["Version", "Status", "Published", "Artifact"]} rows={serviceVersions.map((value) => [value.versionId, <Status value={value.status} />, value.publishedAt ? new Date(value.publishedAt).toLocaleString() : "-", <code>{value.artifactKey}</code>])} />
    <section className="publish-band"><div><h2>Scope configuration</h2><select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>{scopes.map((scope) => <option key={scope.scopeId} value={scope.scopeId}>{scope.name}</option>)}</select></div><button className="primary" disabled={readOnly || pending || !scopeId} onClick={() => void requestReview("scope")}><Rocket />Request scope review</button></section>
    <DataTable headers={["Version", "Status", "Published", "Artifact"]} rows={scopeVersions.map((value) => [value.versionId, <Status value={value.status} />, value.publishedAt ? new Date(value.publishedAt).toLocaleString() : "-", <code>{value.artifactKey}</code>])} />
  </>;
}

function OperationsView(context: Context) {
  const { client, serviceId, selectedService, scopes, subjects, readOnly } = context;
  const [status, setStatus] = useState<OperationsStatus>();
  const [grants, setGrants] = useState<BreakGlassGrant[]>([]);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [nextStatus, page] = await Promise.all([
      result(client.GET("/operations/status")),
      result(client.GET("/break-glass-grants")),
    ]);
    setStatus(nextStatus);
    setGrants(page.items.filter((grant) => grant.serviceId === serviceId));
  }, [client, serviceId]);
  useEffect(() => { void load(); }, [load]);
  async function act(grantId: string, action: "approve" | "reject" | "revoke") {
    setPending(true); setError("");
    try {
      if (action === "approve") await result(client.POST("/break-glass-grants/{grantId}/approve", { params: { path: { grantId } } }));
      else if (action === "reject") await result(client.POST("/break-glass-grants/{grantId}/reject", { params: { path: { grantId } } }));
      else await result(client.POST("/break-glass-grants/{grantId}/revoke", { params: { path: { grantId } } }));
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : "Operation failed"); }
    finally { setPending(false); }
  }
  async function rebuild() {
    setPending(true); setError("");
    try { await result(client.POST("/operations/projections/rebuild")); await load(); }
    catch (value) { setError(value instanceof Error ? value.message : "Projection rebuild failed"); }
    finally { setPending(false); }
  }
  return <><PageHeader title="Operations" detail="Emergency access, projections, and artifact distribution" actions={<>
    <button disabled={pending || readOnly} onClick={() => void rebuild()}><RefreshCw />Rebuild projections</button>
    <button className="primary" disabled={readOnly || !selectedService} onClick={() => setCreating(true)}><Siren />Request break-glass</button>
  </>} />
    {error && <div className="inline-error"><CircleAlert />{error}</div>}
    {status && <div className="metric-strip">
      <div><span>Pending reviews</span><strong>{status.pendingChangeRequests}</strong></div>
      <div><span>Active emergency grants</span><strong>{status.activeBreakGlassGrants}</strong></div>
      <div><span>Dirty projections</span><strong>{status.dirtyProjections}</strong></div>
      <div><span>Replication failures</span><strong>{status.failedReplications}</strong></div>
    </div>}
    <section className="content-section"><div className="section-title"><h2>Break-glass grants</h2></div>
      <DataTable headers={["Subject", "Scope", "Role", "Status", "Expires", ""]} rows={grants.map((grant) => [
        grant.subjectId, grant.scopeId, grant.roleId, <Status value={grant.status} />,
        new Date(grant.expiresAt).toLocaleString(),
        grant.status === "pending" ? <span className="row-actions"><IconButton label="Approve" disabled={pending || readOnly} onClick={() => void act(grant.grantId, "approve")}><Check /></IconButton><IconButton label="Reject" danger disabled={pending || readOnly} onClick={() => void act(grant.grantId, "reject")}><X /></IconButton></span>
          : grant.status === "active" ? <IconButton label="Revoke" danger disabled={pending || readOnly} onClick={() => void act(grant.grantId, "revoke")}><Trash2 /></IconButton> : "",
      ])} />
    </section>
    <section className="content-section"><div className="section-title"><h2>Recent replication</h2></div>
      <DataTable headers={["Service", "Scope", "Version", "Replica", "Status"]} rows={(status?.recentReplications ?? []).map((event) => [event.service_id, event.scope_id ?? "-", event.version, event.replica, <Status value={event.status} />])} />
    </section>
    {creating && selectedService && <BreakGlassModal client={client} serviceId={serviceId} scopes={scopes} subjects={subjects} roles={selectedService.vocabulary.roleTemplates.map((role) => role.id)} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} />}
  </>;
}

function BreakGlassModal({ client, serviceId, scopes, subjects, roles, onClose, onCreated }: {
  client: Context["client"]; serviceId: string; scopes: Scope[]; subjects: Subject[]; roles: string[];
  onClose: () => void; onCreated: () => void;
}) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.subjectId ?? "");
  const [scopeId, setScopeId] = useState(scopes[0]?.scopeId ?? "");
  const [roleId, setRoleId] = useState(roles[0] ?? "");
  const [reason, setReason] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(900);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await result(client.POST("/break-glass-grants", { body: { subjectId, serviceId, scopeId, roleId, reason, durationSeconds } }));
      onCreated();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to request emergency access"); }
  }
  return <Modal title="Request break-glass access" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <label>Subject<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{subjects.map((subject) => <option key={subject.subjectId} value={subject.subjectId}>{subject.displayName}</option>)}</select></label>
    <label>Scope<select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>{scopes.map((scope) => <option key={scope.scopeId} value={scope.scopeId}>{scope.name}</option>)}</select></label>
    <label>Role<select value={roleId} onChange={(event) => setRoleId(event.target.value)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
    <label>Duration (seconds)<input type="number" min={60} max={3600} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} /></label>
    <label>Incident reason<textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
    {error && <div className="inline-error"><CircleAlert />{error}</div>}
    <div className="form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary"><Siren />Request</button></div>
  </form></Modal>;
}

function AuditView({ client, serviceId }: Context) {
  const [events, setEvents] = useState<AuditEvent[]>([]); const [query, setQuery] = useState("");
  useEffect(() => { void result(client.GET("/audit-events", { params: { query: { serviceId } } })).then((value) => setEvents(value.items)); }, [client, serviceId]);
  const filtered = events.filter((event) => `${event.action} ${event.actorId} ${event.targetId}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader title="Audit" detail={`${events.length} recent events`} /><div className="filter-box page-filter"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter audit events" /></div><DataTable headers={["Time", "Action", "Actor", "Target"]} rows={filtered.map((event) => [new Date(event.createdAt).toLocaleString(), <code>{event.action}</code>, event.actorId, `${event.targetType}:${event.targetId}`])} /></>;
}

function SimulatorView({ client, serviceId, scopes, subjects, selectedService }: Context) {
  const [scopeId, setScopeId] = useState(scopes[0]?.scopeId ?? ""); const [subjectId, setSubjectId] = useState(subjects[0]?.subjectId ?? ""); const [actionId, setActionId] = useState(selectedService?.vocabulary.actions[0]?.id ?? ""); const [path, setPath] = useState(""); const [simulation, setSimulation] = useState<components["schemas"]["SimulationResult"]>();
  async function submit(event: FormEvent) { event.preventDefault(); setSimulation(await result(client.POST("/simulations", { body: { serviceId, scopeId, subjectId, actionId, ...(path ? { path } : {}) } }))); }
  return <><PageHeader title="Authorization simulator" /><div className="simulator-grid"><form className="form-grid simulator-form" onSubmit={submit}><label>Subject<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{subjects.map((value) => <option key={value.subjectId} value={value.subjectId}>{value.displayName}</option>)}</select></label><label>Scope<select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>{scopes.map((value) => <option key={value.scopeId} value={value.scopeId}>{value.name}</option>)}</select></label><label>Action<select value={actionId} onChange={(event) => setActionId(event.target.value)}>{selectedService?.vocabulary.actions.map((value) => <option key={value.id} value={value.id}>{value.id}</option>)}</select></label><label>Path<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="shared/docs/report.pdf" /></label><button className="primary"><FlaskConical />Evaluate</button></form><section className={`simulation-result ${simulation?.decision ?? "idle"}`}>{simulation ? <><div>{simulation.decision === "allow" ? <ShieldCheck /> : <CircleAlert />}<strong>{simulation.decision}</strong></div><p>{simulation.reasons.join(" · ")}</p>{simulation.matchedBindingIds.length > 0 && <code>{simulation.matchedBindingIds.join(", ")}</code>}</> : <span>Select an action and evaluate</span>}</section></div></>;
}
