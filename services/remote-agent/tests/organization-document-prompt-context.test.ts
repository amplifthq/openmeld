import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCurrentOrganizationDocumentPromptContext as readContext } from "../flue-adapter/organization-document-prompt-context";

const initial = {
  organizationId: "org_test",
  briefContent: "Decision A",
  documentTitles: ["Runbook"],
  organizationProtectedInformation: "Protected A",
};
describe("current document context", () => {
  afterEach(() => vi.restoreAllMocks());
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
  });
});
