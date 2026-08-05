// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../ui/src/App";

const vocabulary = {
  serviceId: "projects-api",
  version: 2,
  scopeTypes: [{ id: "project", name: "Project" }],
  scopeHierarchy: [],
  resourceTypes: [{ id: "Project" }],
  pathSpaces: [{ id: "files", anchorKind: "service" }],
  actions: [{ id: "readProject", targetKind: "resource", resourceType: "Project", permissionProfile: "object", permissionId: "read" }],
  permissionProfiles: [{ id: "object", permissions: [{ id: "read" }] }],
  roleTemplates: [{ id: "viewer", name: "Viewer", grants: [] }],
  subjectKinds: ["User", "ServiceAccount", "Group"],
  claimConventions: { scopeReference: "claimId", authorizationClaim: "azs", authorizationVersion: 1 },
  updatedAt: "2026-08-05T00:00:00.000Z",
};

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

describe("management UI", () => {
  beforeEach(() => {
    sessionStorage.setItem("authz-console-token", "test-token");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/services")) return Response.json({ items: [{ serviceId: "projects-api", name: "Projects API", vocabulary, activeServiceVersion: "svc-1", createdAt: vocabulary.updatedAt, updatedAt: vocabulary.updatedAt }] });
      if (url.endsWith("/subjects")) return Response.json({ items: [{ subjectId: "user-alice", kind: "User", displayName: "Alice", status: "active", createdAt: vocabulary.updatedAt, updatedAt: vocabulary.updatedAt }] });
      if (url.includes("/scopes?")) return Response.json({ items: [{ scopeId: "project-alpha", serviceId: "projects-api", scopeType: "project", name: "Alpha", claimId: "pa", createdAt: vocabulary.updatedAt, updatedAt: vocabulary.updatedAt }] });
      if (url.endsWith("/operations/status")) return Response.json({ pendingChangeRequests: 1, activeBreakGlassGrants: 0, dirtyProjections: 2, pendingProjectionEvents: 1, failedReplications: 0, recentReplications: [], checkedAt: vocabulary.updatedAt });
      if (url.endsWith("/break-glass-grants")) return Response.json({ items: [] });
      return Response.json({ items: [] });
    }));
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("loads operational state and navigates to vocabulary concepts", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Projects API" })).toBeInTheDocument();
    expect(screen.getByText("Scopes").parentElement).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Vocabulary" }));
    expect(await screen.findByRole("heading", { name: "Service vocabulary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scope types" })).toBeInTheDocument();
    expect(screen.getByText("readProject")).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("shows account and token sign-in modes without a session", () => {
    sessionStorage.clear();
    render(<App />);
    expect(screen.getByText("Authorization Console")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Access token" }));
    expect(screen.getByLabelText("Token")).toBeInTheDocument();
  });

  it("shows operational projection and approval status", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Projects API" });
    fireEvent.click(screen.getByRole("button", { name: "Operations" }));
    expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByText("Dirty projections").parentElement).toHaveTextContent("2");
    expect(screen.getByRole("heading", { name: "Break-glass grants" })).toBeInTheDocument();
  });
});
