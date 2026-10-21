import { afterEach, describe, expect, it, vi } from "vitest";
import { readAccountOrganizationContext } from "../src/account-organization-context";
import { createOpenMeldApiClient } from "../src/client";
import { createFetchTransport } from "../src/transport";

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

afterEach(() => vi.restoreAllMocks());

describe("account Organization context read", () => {
  it.each([
    false,
    true,
  ])("preserves legacy session renewal unless deferral is requested: %s", async (deferSessionRefresh) => {
    let requestedUrl = "";
    const client = createOpenMeldApiClient({
      baseUrl: "https://openmeld.test",
      transport: createFetchTransport({
        fetch: (url) => {
          requestedUrl = String(url);
          return Promise.resolve(new Response(null, { status: 401 }));
        },
      }),
    });

    await expect(
      readAccountOrganizationContext(client, { deferSessionRefresh })
    ).resolves.toBeNull();
    expect(requestedUrl).toBe(
      `https://openmeld.test/v1/account/organization-context${deferSessionRefresh ? "?deferSessionRefresh=true" : ""}`
    );
  });

  it.each([
    "headers",
    "body",
  ] as const)("retains the outgoing request ID when the %s deadline expires", async (phase) => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    let requestId: string | null = null;
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const client = createOpenMeldApiClient({
      baseUrl: "https://openmeld.test",
      transport: createFetchTransport({
        fetch: async (_url, init) => {
          requestId = new Headers(init?.headers).get("x-request-id");
          if (phase === "headers") {
            return await new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true }
              );
              started();
            });
          }
          return new Response(
            new ReadableStream(
              {
                pull(controller) {
                  init?.signal?.addEventListener(
                    "abort",
                    () => controller.error(init.signal?.reason),
                    { once: true }
                  );
                  started();
                },
              },
              { highWaterMark: 0 }
            )
          );
        },
      }),
    });
    const pending = readAccountOrganizationContext(client, {
      timeoutMs: 5000,
    }).catch((error: unknown) => error);
    await ready;
    deadline.abort(new DOMException("Timed out", "TimeoutError"));

    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(await pending).toMatchObject({
      code: phase === "headers" ? "network.timeout" : "network.request_failed",
      operation: "account.organizationContext.read",
      requestId,
    });
  });

  it("cancels a pending account read at the shared transport boundary", async () => {
    const abort = new AbortController();
    const client = createOpenMeldApiClient({
      baseUrl: "https://openmeld.test",
      transport: createFetchTransport({
        fetch: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.throwIfAborted();
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true }
            );
          }),
      }),
    });
    const pending = readAccountOrganizationContext(client, {
      signal: abort.signal,
      timeoutMs: 5000,
    });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
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
