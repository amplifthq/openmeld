import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoreRpcHttpError } from "../../core/src/rpc/errors";
import { resolveCurrentOrganizationDocumentPromptContext as readContext } from "../flue-adapter/organization-document-prompt-context";

const initial = {
  organizationId: "org_test",
  briefContent: "Decision A",
  documentTitles: ["Runbook"],
  organizationProtectedInformation: "Protected A",
};
describe("current document context", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    { code: "invalid_payload", status: 400, negotiate: true },
    { code: "organization.membership_required", status: 403, negotiate: false },
    { code: "core.unavailable", status: 503, negotiate: false },
  ])("negotiates only unsupported source opt-ins and preserves current protection ($code)", async ({
    code,
    status,
    negotiate,
  }) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const read = vi.fn((includeSources: boolean) =>
      includeSources
        ? Promise.reject(
            createCoreRpcHttpError({
              code,
              status,
              reason: "Controlled Core response",
            })
          )
        : Promise.resolve(initial)
    );
    expect(
      await readContext({ organizationId: initial.organizationId, read })
    ).toEqual(negotiate ? initial : null);
    expect(read.mock.calls.map(([includeSources]) => includeSources)).toEqual(
      negotiate ? [true, false] : [true]
    );
  });
  it("reads updated B on a new turn instead of reusing A", async () => {
    await expect(
      readContext({
        organizationId: initial.organizationId,
        read: async () => initial,
      })
    ).resolves.toEqual(initial);
    await expect(
      readContext({
        organizationId: initial.organizationId,
        read: async () => ({ ...initial, briefContent: "Decision B" }),
      })
    ).resolves.toMatchObject({ briefContent: "Decision B" });
  });
  it.each([
    "Forbidden",
    "Core unavailable",
  ])("never reuses a previous body after %s", async (message) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await readContext({
      organizationId: initial.organizationId,
      read: async () => initial,
    });
    await expect(
      readContext({
        organizationId: initial.organizationId,
        read: () => Promise.reject(new Error(message)),
      })
    ).resolves.toBeNull();
  });
  it("does not share an in-flight authorized response with a denied caller", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let finish!: (value: typeof initial) => void;
    const pending = readContext({
      organizationId: initial.organizationId,
      read: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const denied = readContext({
      organizationId: initial.organizationId,
      read: () => Promise.reject(new Error("Forbidden")),
    });
    finish(initial);
    expect(await pending).toEqual(initial);
    expect(await denied).toBeNull();
  });
  it("rejects wrong-organization and malformed responses", async () => {
    await expect(
      readContext({ organizationId: "other", read: async () => initial })
    ).rejects.toThrow("another Organization");
    await expect(
      readContext({
        organizationId: initial.organizationId,
        read: async () => ({}),
      })
    ).rejects.toThrow("invalid");
    await expect(
      readContext({
        organizationId: initial.organizationId,
        read: async () => ({
          ...initial,
          briefSource: {
            kind: "organization_document",
            documentId: "document-1",
            state: "draft",
            version: "a".repeat(64),
          },
        }),
      })
    ).rejects.toThrow("invalid");
  });
});
