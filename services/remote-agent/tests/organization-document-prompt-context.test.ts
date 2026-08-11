import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ORGANIZATION_DOCUMENT_PROMPT_CONTEXT_CACHE_TTL_MS,
  readCachedOrganizationDocumentPromptContext,
  resolveCachedOrganizationDocumentPromptContext,
  resolveCurrentOrganizationDocumentPromptContext,
} from "../flue-adapter/organization-document-prompt-context";

const PROMPT_CONTEXT = {
  briefContent: "Ship the reliable path first.",
  documentTitles: ["Organization Brief"],
  organizationId: "org_123",
  organizationProtectedInformation:
    "Unreleased Board forecasts and acquisition planning materials.",
};

describe("Organization document prompt context cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shares one cold Core read across repeated agent factory runs", async () => {
    let resolveRead: ((value: typeof PROMPT_CONTEXT) => void) | undefined;
    const read = vi.fn(
      async () =>
        await new Promise<typeof PROMPT_CONTEXT>((resolve) => {
          resolveRead = resolve;
        })
    );

    const coldRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 1000,
      organizationId: "org_123",
      read,
    });
    const concurrentRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 1001,
      organizationId: "org_123",
      read,
    });

    expect(coldRead.value).toBeNull();
    expect(coldRead.refresh).not.toBeNull();
    expect(concurrentRead.value).toBeNull();
    expect(concurrentRead.refresh).toBe(coldRead.refresh);
    expect(read).toHaveBeenCalledTimes(1);

    resolveRead?.(PROMPT_CONTEXT);
    await coldRead.refresh;

    expect(
      readCachedOrganizationDocumentPromptContext({
        nowMs: 1000 + ORGANIZATION_DOCUMENT_PROMPT_CONTEXT_CACHE_TTL_MS - 1,
        organizationId: "org_123",
        read,
      })
    ).toEqual({ refresh: null, value: PROMPT_CONTEXT });
    await expect(coldRead.refresh).resolves.toMatchObject({
      organizationProtectedInformation:
        "Unreleased Board forecasts and acquisition planning materials.",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("waits for the current context before model execution", async () => {
    let resolveRead: ((value: typeof PROMPT_CONTEXT) => void) | undefined;
    const read = vi.fn(
      async () =>
        await new Promise<typeof PROMPT_CONTEXT>((resolve) => {
          resolveRead = resolve;
        })
    );

    const resolvedContext = resolveCachedOrganizationDocumentPromptContext({
      nowMs: 1500,
      organizationId: "org_execution_wait",
      read,
    });
    let settled = false;
    resolvedContext.finally(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRead?.({
      ...PROMPT_CONTEXT,
      organizationId: "org_execution_wait",
    });
    await expect(resolvedContext).resolves.toMatchObject({
      briefContent: PROMPT_CONTEXT.briefContent,
      organizationId: "org_execution_wait",
    });
  });

  it("isolates cached prompt context by Organization", async () => {
    const firstContext = {
      ...PROMPT_CONTEXT,
      organizationId: "org_cache_isolation_1",
    };
    const readFirst = vi.fn(async () => firstContext);
    const secondContext = {
      ...PROMPT_CONTEXT,
      organizationId: "org_cache_isolation_2",
    };
    const readSecond = vi.fn(async () => secondContext);

    const firstRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 2000,
      organizationId: "org_cache_isolation_1",
      read: readFirst,
    });
    const secondRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 2000,
      organizationId: "org_cache_isolation_2",
      read: readSecond,
    });

    await Promise.all([firstRead.refresh, secondRead.refresh]);

    expect(
      readCachedOrganizationDocumentPromptContext({
        nowMs: 2001,
        organizationId: "org_cache_isolation_1",
        read: readFirst,
      }).value
    ).toEqual(firstContext);
    expect(
      readCachedOrganizationDocumentPromptContext({
        nowMs: 2001,
        organizationId: "org_cache_isolation_2",
        read: readSecond,
      }).value
    ).toEqual(secondContext);

    expect(readFirst).toHaveBeenCalledTimes(1);
    expect(readSecond).toHaveBeenCalledTimes(1);
  });

  it("reads fresh prompt context after the cache expires", async () => {
    const initialContext = {
      ...PROMPT_CONTEXT,
      organizationId: "org_cache_expiry",
    };
    const read = vi
      .fn()
      .mockResolvedValueOnce(initialContext)
      .mockResolvedValueOnce({
        ...initialContext,
        briefContent: "Updated brief",
      });

    const initialRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 3000,
      organizationId: "org_cache_expiry",
      read,
    });
    await initialRead.refresh;

    const staleRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 3000 + ORGANIZATION_DOCUMENT_PROMPT_CONTEXT_CACHE_TTL_MS,
      organizationId: "org_cache_expiry",
      read,
    });
    expect(staleRead.value).toEqual(initialContext);
    await staleRead.refresh;

    expect(
      readCachedOrganizationDocumentPromptContext({
        nowMs: 3001 + ORGANIZATION_DOCUMENT_PROMPT_CONTEXT_CACHE_TTL_MS,
        organizationId: "org_cache_expiry",
        read,
      }).value
    ).toMatchObject({ briefContent: "Updated brief" });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads current Organization protection on every model turn", async () => {
    const organizationId = "org_current_protection";
    const initialContext = {
      ...PROMPT_CONTEXT,
      organizationId,
      organizationProtectedInformation: "Initial protection.",
    };
    const initialRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 3500,
      organizationId,
      read: async () => initialContext,
    });
    await initialRead.refresh;
    const readCurrent = vi.fn(async () => ({
      ...initialContext,
      organizationProtectedInformation: "Updated protection.",
    }));

    await expect(
      resolveCurrentOrganizationDocumentPromptContext({
        nowMs: 3501,
        organizationId,
        read: readCurrent,
      })
    ).resolves.toMatchObject({
      organizationProtectedInformation: "Updated protection.",
    });
    expect(readCurrent).toHaveBeenCalledTimes(1);
  });

  it("keeps cached Organization documents but drops protected text when a fresh read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const organizationId = "org_current_protection_fallback";
    const cachedContext = {
      ...PROMPT_CONTEXT,
      organizationId,
      organizationProtectedInformation: "Cached protection.",
    };
    const initialRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 3600,
      organizationId,
      read: async () => cachedContext,
    });
    await initialRead.refresh;

    await expect(
      resolveCurrentOrganizationDocumentPromptContext({
        nowMs: 3601,
        organizationId,
        read: () => Promise.reject(new Error("Core unavailable")),
      })
    ).resolves.toEqual({
      ...cachedContext,
      organizationProtectedInformation: null,
    });
    expect(warn).toHaveBeenCalledWith(
      "[remote_agent.organization_prompt_context.refresh_unavailable]",
      {
        errorName: "Error",
        event: "remote_agent.organization_prompt_context.refresh_unavailable",
        organizationId,
      }
    );
  });

  it("does not cache a response for the wrong Organization", async () => {
    const read = vi.fn(async () => PROMPT_CONTEXT);

    const firstRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 4000,
      organizationId: "org_context_mismatch",
      read,
    });
    await expect(firstRead.refresh).rejects.toThrow(
      "Organization document prompt context returned org_123 for org_context_mismatch."
    );
    expect(firstRead.value).toBeNull();

    const secondRead = readCachedOrganizationDocumentPromptContext({
      nowMs: 4001,
      organizationId: "org_context_mismatch",
      read,
    });
    await expect(secondRead.refresh).rejects.toThrow();
    expect(secondRead.value).toBeNull();

    expect(read).toHaveBeenCalledTimes(2);
  });
});
