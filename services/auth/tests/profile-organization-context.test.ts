import { PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it, vi } from "vitest";
import { resolveAgentProfileOrganizationId } from "../src/lib/hono/profile-routes";

describe("Agent Profile Organization context", () => {
  it("uses the explicitly requested Organization instead of a stale Session selection", async () => {
    const db = new PostgresDatabase({
      connectionString: "postgresql://projection@127.0.0.1:1/projection",
    });
    const query = vi.spyOn(db, "query").mockResolvedValue({
      rows: [{ organization_id: "organization-amplift" }],
      rowCount: 1,
      fields: [],
      command: "SELECT",
      oid: 0,
    });

    await expect(
      resolveAgentProfileOrganizationId({
        db,
        headers: new Headers({
          "x-openmeld-requested-organization-id": "organization-amplift",
        }),
        sessionActiveOrganizationId: "organization-personal",
        userId: "user-felix",
      })
    ).resolves.toBe("organization-amplift");
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        values: ["user-felix", "organization-amplift"],
      })
    );
  });

  it("preserves Session fallback for older unscoped callers", async () => {
    const db = new PostgresDatabase({
      connectionString: "postgresql://projection@127.0.0.1:1/projection",
    });
    const query = vi.spyOn(db, "query");

    await expect(
      resolveAgentProfileOrganizationId({
        db,
        headers: new Headers(),
        sessionActiveOrganizationId: "organization-session",
        userId: "user-felix",
      })
    ).resolves.toBe("organization-session");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects ambiguous Organization selectors before reading membership", async () => {
    const db = new PostgresDatabase({
      connectionString: "postgresql://projection@127.0.0.1:1/projection",
    });
    const query = vi.spyOn(db, "query");

    await expect(
      resolveAgentProfileOrganizationId({
        db,
        headers: new Headers({
          "x-openmeld-requested-organization-id": "organization-amplift",
          "x-openmeld-requested-organization-slug": "amplift",
        }),
        sessionActiveOrganizationId: "organization-session",
        userId: "user-felix",
      })
    ).rejects.toMatchObject({
      code: "organization.context_invalid",
    });
    expect(query).not.toHaveBeenCalled();
  });
});
