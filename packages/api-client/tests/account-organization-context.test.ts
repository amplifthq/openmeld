import { describe, expect, it } from "vitest";
import { readAccountOrganizationContext } from "../src/account-organization-context";
import { createOpenMeldApiClient } from "../src/client";
import { createFetchTransport } from "../src/transport";

describe("account Organization context read", () => {
  it.each([401, 500, 503])("preserves HTTP %s semantics", async (status) => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://openmeld.test",
      transport: createFetchTransport({
        fetch: async () => new Response(null, { status }),
      }),
    });
    if (status === 401) {
      await expect(readAccountOrganizationContext(client)).resolves.toBeNull();
    } else {
      await expect(
        readAccountOrganizationContext(client)
      ).rejects.toMatchObject({ status });
    }
  });

  it.each([
    { token: "must-not-cross-boundary" },
    { defaultOrganizationId: "not-a-membership" },
  ])("rejects credential-bearing or inconsistent account projections: %j", async (invalidFields) => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://openmeld.test",
      transport: createFetchTransport({
        fetch: async () =>
          Response.json({
            account: { email: null, image: null, name: null },
            currentUserId: "user",
            organizations: [],
            defaultOrganizationId: null,
            ...invalidFields,
          }),
      }),
    });
    await expect(readAccountOrganizationContext(client)).rejects.toThrow(
      "Invalid account Organization context response."
    );
  });
});
