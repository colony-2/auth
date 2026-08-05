import { describe, expect, it } from "vitest";

import { MemoryManagementPublisher } from "../../src/management/publisher";
import { MemoryManagementRepository } from "../../src/management/repository";
import { handleScimRequest } from "../../src/management/scim";
import { ManagementService } from "../../src/management/service";

describe("SCIM provisioning", () => {
  it("creates, filters, and deactivates a user through the normal subject model", async () => {
    const repository = new MemoryManagementRepository();
    const service = new ManagementService(repository, new MemoryManagementPublisher());
    const created = await handleScimRequest(
      new Request("https://management.test/scim/v2/Users", {
        method: "POST",
        headers: { "content-type": "application/scim+json" },
        body: JSON.stringify({
          externalId: "directory-42",
          userName: "dana@example.test",
          displayName: "Dana Operator",
          active: true,
          emails: [{ value: "dana@example.test", primary: true }],
        }),
      }),
      {} as D1Database,
      repository,
      service,
      "scim-provisioner",
    );
    expect(created.status).toBe(201);
    const user = await created.json<{ id: string; active: boolean }>();
    expect(user.active).toBe(true);

    const listed = await handleScimRequest(
      new Request("https://management.test/scim/v2/Users?filter=userName%20eq%20%22dana%40example.test%22"),
      {} as D1Database,
      repository,
      service,
      "scim-provisioner",
    );
    expect((await listed.json<{ totalResults: number }>()).totalResults).toBe(1);

    const removed = await handleScimRequest(
      new Request(`https://management.test/scim/v2/Users/${user.id}`, { method: "DELETE" }),
      {} as D1Database,
      repository,
      service,
      "scim-provisioner",
    );
    expect(removed.status).toBe(204);
    expect(await repository.getSubject(user.id)).toMatchObject({ status: "disabled" });
    expect((await repository.listAudit()).map((event) => event.action)).toContain("subject.update");
  });
});
