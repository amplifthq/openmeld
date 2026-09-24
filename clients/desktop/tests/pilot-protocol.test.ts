import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenMeldApiClient, createSpaceApi } from "@openmeld/api-client";
import {
  OPENMELD_HEADER_INBOX_SUMMARY_VERSION,
  OPENMELD_INBOX_SUMMARY_VERSION,
} from "@openmeld/gateway-contract";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  SPACE_ACCESS_VERSION_HEADER,
} from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import { createPilotProtocol } from "../src/main/pilot-protocol";

it("preserves authenticated media ranges without exposing native credentials", async () => {
  const cloudRequest = vi.fn(
    (path: string, request: { method: string; headers: Headers }) => {
      expect(path).toBe(
        "/v1/spaces/space-1/files/file-1/content?revision=2&__openmeld_organization_slug=acme"
      );
      expect(request.headers.get("range")).toBe("bytes=4-7");
      expect(request.headers.get("if-range")).toBe('"revision-2"');
      expect(request.headers.get("cookie")).toBe("session=native");
      expect(request.headers.has("authorization")).toBe(false);
      return Promise.resolve(
        new Response("part", {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": "bytes 4-7/10",
            "content-length": "4",
            "accept-ranges": "bytes",
            etag: '"revision-2"',
            "cache-control": "private, no-store",
            "set-cookie": "session=renewed",
            authorization: "secret",
          },
        })
      );
    }
  );
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://web.example",
    webBuild: "a".repeat(64),
    cookie: () => "session=native",
    fetch,
    cloudRequest,
  });
  const response = await handle(
    new Request(
      `${DESKTOP_APP_ORIGIN}/v1/spaces/space-1/files/file-1/content?revision=2&__openmeld_organization_slug=acme`,
      {
        headers: {
          range: "bytes=4-7",
          "if-range": '"revision-2"',
          cookie: "untrusted",
          authorization: "untrusted",
        },
      }
    )
  );
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 4-7/10");
  expect(response.headers.get("content-length")).toBe("4");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("etag")).toBe('"revision-2"');
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("authorization")).toBe(false);
  expect(await response.text()).toBe("part");
});

it.each([
  ["POST", "folders/select"],
  ["POST", "projects/discover"],
  ["POST", "projects/connect-candidate"],
  ["POST", "projects/connect-declared-path"],
  ["POST", "projects/connections/set-default"],
  ["PUT", "agent-profiles/profile/workspace"],
])("admits %s %s only for the native account-aligned device and lane", async (method, action) => {
  const cloudRequest = vi.fn(async (_path: string) =>
    Response.json({ status: "cancelled", deviceId: "mac-a" })
  );
  const readLocalComputer = vi.fn(async () => ({
    status: "available" as const,
    accountId: "owner-a",
    target: { deviceId: "mac-a", runtimeLane: "dev-local" as const },
  }));
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://web.example",
    webBuild: "a".repeat(64),
    cookie: () => "native-only",
    fetch,
    cloudRequest,
    readLocalComputer,
  });
  const request = (device: string, lane: string) =>
    new Request(
      `${DESKTOP_APP_ORIGIN}/v1/people-computers/${device}/lanes/${lane}/${action}`,
      { method }
    );
  for (const [device, lane] of [
    ["mac-b", "dev-local"],
    ["mac-a", "prod"],
  ] as const) {
    const response = await handle(request(device, lane));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Service Start and Stop");
  }
  expect(cloudRequest).not.toHaveBeenCalled();
  expect(await (await handle(request("mac-a", "dev-local"))).json()).toEqual({
    status: "cancelled",
    deviceId: "mac-a",
  });
  expect(cloudRequest.mock.calls[0]?.[0]).toBe(
    `/v1/people-computers/mac-a/lanes/dev-local/${action}`
  );
});

it("refuses a sign-in change while admitting a folder request", async () => {
  let cookie = "session-a";
  const cloudRequest = vi.fn();
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://web.example",
    webBuild: "a".repeat(64),
    fetch,
    cookie: () => cookie,
    cloudRequest,
    readLocalComputer: () => {
      cookie = "session-b";
      return Promise.resolve({
        status: "available",
        accountId: "owner-b",
        target: { deviceId: "mac-a", runtimeLane: "dev-local" },
      });
    },
  });
  const response = await handle(
    new Request(
      `${DESKTOP_APP_ORIGIN}/v1/people-computers/mac-a/lanes/dev-local/folders/select`,
      { method: "POST" }
    )
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "desktop.folder.account_changed",
  });
  expect(cloudRequest).not.toHaveBeenCalled();
});

it("refuses folder operations when native identity is unavailable before attaching credentials", async () => {
  const cookie = vi.fn(() => "private");
  const cloudRequest = vi.fn();
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://web.example",
    webBuild: "a".repeat(64),
    cookie,
    fetch,
    cloudRequest,
    readLocalComputer: async () => ({
      status: "unavailable",
      message: "Desktop and this computer use different accounts.",
    }),
  });
  const response = await handle(
    new Request(
      `${DESKTOP_APP_ORIGIN}/v1/people-computers/mac-a/lanes/dev-local/folders/select`,
      { method: "POST" }
    )
  );
  expect(response.status).toBe(409);
  expect(cookie).toHaveBeenCalledTimes(1);
  expect(cloudRequest).not.toHaveBeenCalled();
});

it("admits installed API requests before credentials and preserves SDK errors without exposing cookies", async () => {
  const cookie = vi.fn(() => "session=native-only");
  const compatibility = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("Unsupported Desktop"));
  const cloudRequest = vi.fn(
    async (
      _path: string,
      _request: { method: string; headers: Headers; body?: ArrayBuffer }
    ) =>
      Response.json(
        { code: "business.denied" },
        {
          status: 403,
          headers: {
            "set-cookie": "session=native-renewal",
            "cache-control": "private, no-store",
            "x-openmeld-request-id": "desktop-read-42",
            "server-timing": "core;dur=17.5",
            authorization: "must-not-reach-renderer",
            "x-private-debug": "must-not-reach-renderer",
          },
        }
      )
  );
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://openmeld.ai",
    webBuild: "a".repeat(64),
    installed: true,
    ensureCompatible: compatibility,
    cookie,
    cloudRequest,
    fetch: () => {
      throw new Error("Installed APIs must use the SDK");
    },
  });
  for (const [path, method] of [
    ["/_serverFn/generated", "GET"],
    ["/api/auth/get-session", "GET"],
    ["/api/auth/device/code", "POST"],
    ["/api/auth/device?user_code=TEST", "GET"],
    ["/api/auth/device/approve", "POST"],
  ]) {
    expect(
      (await handle(new Request(`${DESKTOP_APP_ORIGIN}${path}`, { method })))
        .status
    ).toBe(403);
  }
  expect(compatibility).not.toHaveBeenCalled();
  await expect(
    handle(new Request(`${DESKTOP_APP_ORIGIN}/v1/profiles`))
  ).rejects.toThrow("Unsupported Desktop");
  expect(cookie).not.toHaveBeenCalled();
  expect(cloudRequest).not.toHaveBeenCalled();
  compatibility.mockResolvedValue();
  const response = await handle(
    new Request(`${DESKTOP_APP_ORIGIN}/v1/profiles`, {
      method: "POST",
      body: '{"name":"Agent"}',
      headers: {
        "content-type": "application/json",
        [SPACE_ACCESS_VERSION_HEADER]: "1",
        cookie: "renderer-secret",
        authorization: "renderer-secret",
      },
    })
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: "business.denied" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.get("x-openmeld-request-id")).toBe("desktop-read-42");
  expect(response.headers.get("server-timing")).toBe("core;dur=17.5");
  expect(response.headers.has("authorization")).toBe(false);
  expect(response.headers.has("x-private-debug")).toBe(false);
  const call = cloudRequest.mock.calls[0];
  if (!call) {
    throw new Error("Expected SDK request");
  }
  expect(call[0]).toBe("/v1/profiles");
  expect(call[1].method).toBe("POST");
  expect(new TextDecoder().decode(call[1].body)).toBe('{"name":"Agent"}');
  expect(call[1].headers.get(DESKTOP_CONTRACT_HEADER)).toBe("1");
  expect(call[1].headers.get(SPACE_ACCESS_VERSION_HEADER)).toBe("1");
  expect(call[1].headers.get("cookie")).toBe("session=native-only");
  expect(call[1].headers.has("authorization")).toBe(false);
});

it.each([
  false,
  true,
])("refuses renderer update observations before credentials in installed=%s", async (installed) => {
  const cookie = vi.fn(() => "session=main-only");
  const ensureCompatible = vi.fn(async () => undefined);
  const cloudRequest = vi.fn(async () => Response.json({ accepted: true }));
  const fetchCloud = vi.fn<typeof fetch>(async () =>
    Response.json({ accepted: true })
  );
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://in-memory.invalid",
    webBuild: "a".repeat(64),
    installed,
    ensureCompatible,
    cookie,
    fetch: fetchCloud,
    ...(installed ? { cloudRequest } : {}),
  });
  for (const path of [
    "/v1/account/desktop-update-observations",
    "/v1/account/desktop-update-observations?retry=1",
    "/v1/account/desktop-update-observations/",
    "/v1/%61ccount/desktop-update-observations",
    "/v1/account/%64esktop-update-observations",
  ]) {
    const response = await handle(
      new Request(`${DESKTOP_APP_ORIGIN}${path}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: DESKTOP_APP_ORIGIN,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          expectedUserId: "owner",
          installationId: "11111111-2222-4333-8444-555555555555",
          sequence: 1,
          lane: "prod",
          platform: "darwin",
          deviceName: "Forged device",
          installedVersion: "99.0.0",
          availableVersion: null,
        }),
      })
    );
    expect(response.status).toBe(403);
  }
  expect(cookie).not.toHaveBeenCalled();
  expect(ensureCompatible).not.toHaveBeenCalled();
  expect(cloudRequest).not.toHaveBeenCalled();
  expect(fetchCloud).not.toHaveBeenCalled();
  expect(
    (await handle(new Request(`${DESKTOP_APP_ORIGIN}/v1/inbox/summary`))).status
  ).toBe(200);
  expect(cookie).toHaveBeenCalledTimes(1);
  expect(installed ? cloudRequest : fetchCloud).toHaveBeenCalledTimes(1);
});

it("serves local page files and confines credentials to the configured cloud origin", async () => {
  const assets = await mkdtemp(join(tmpdir(), "openmeld-desktop-assets-"));
  try {
    const html =
      '<script>self.route="__root__\u0000";\r\nself.ready=true;\r</script>';
    await writeFile(join(assets, "index.html"), html);
    const fetchCloud = vi.fn<typeof fetch>(
      async () =>
        new Response("cloud result", {
          headers: {
            "set-cookie": "credential=secret",
            "content-type": "text/plain",
            "x-tss-serialized": "true",
          },
        })
    );
    const handle = createPilotProtocol({
      assets,
      webOrigin: "https://web.example",
      webBuild: "a".repeat(64),
      cookie: () => "session=main-only",
      fetch: fetchCloud,
    });
    const page = await handle(new Request(`${DESKTOP_APP_ORIGIN}/`));
    expect(await page.text()).toBe(html);
    // HTML tokenization replaces NULL and normalizes CR/CRLF before CSP checks.
    const browserScript = 'self.route="__root__\uFFFD";\nself.ready=true;\n';
    const hash = createHash("sha256").update(browserScript).digest("base64");
    const scriptPolicy = page.headers
      .get("content-security-policy")
      ?.split(";")
      .find((part) => part.includes("script-src"));
    expect(scriptPolicy).toBe(` script-src 'self' 'sha256-${hash}'`);
    expect(
      page.headers
        .get("content-security-policy")
        ?.split(";")
        .find((part) => part.includes("img-src"))
        ?.trim()
        .split(" ")
    ).toContain("blob:");
    const result = await handle(
      new Request(`${DESKTOP_APP_ORIGIN}/v1/spaces`, {
        headers: {
          origin: DESKTOP_APP_ORIGIN,
          authorization: "renderer-credential",
          cookie: "renderer-cookie",
          [OPENMELD_HEADER_INBOX_SUMMARY_VERSION]:
            OPENMELD_INBOX_SUMMARY_VERSION,
        },
      })
    );
    expect(await result.text()).toBe("cloud result");
    expect(result.headers.has("set-cookie")).toBe(false);
    expect(result.headers.get("x-tss-serialized")).toBe("true");
    const [target, options] = fetchCloud.mock.calls[0] ?? [];
    expect(String(target)).toBe("https://web.example/v1/spaces");
    expect(new Headers(options?.headers).get("cookie")).toBe(
      "session=main-only"
    );
    expect(new Headers(options?.headers).has("authorization")).toBe(false);
    expect(
      new Headers(options?.headers).get(OPENMELD_HEADER_INBOX_SUMMARY_VERSION)
    ).toBe(OPENMELD_INBOX_SUMMARY_VERSION);
    expect(options?.redirect).toBe("manual");
    for (const request of [
      new Request("openmeld-desktop://other/v1/spaces", {
        headers: { origin: DESKTOP_APP_ORIGIN },
      }),
      new Request(`${DESKTOP_APP_ORIGIN}/api/auth/list-sessions`, {
        headers: { origin: DESKTOP_APP_ORIGIN },
      }),
      new Request(`${DESKTOP_APP_ORIGIN}/_serverFn/mutation`, {
        method: "POST",
        headers: { origin: DESKTOP_APP_ORIGIN },
      }),
    ]) {
      expect((await handle(request)).status).toBe(403);
    }
    expect(fetchCloud).toHaveBeenCalledTimes(1);
    // Same Computer controls have both current-device and explicit-lane routes.
    for (const [method, path] of [
      ["POST", "/v1/local-runtimes/current/openmeld-tools/update"],
      [
        "POST",
        "/v1/people-computers/device/lanes/dev-local/openmeld-tools/update",
      ],
      [
        "PUT",
        "/v1/people-computers/device/lanes/dev-local/local-agents/codex/enabled",
      ],
      ["PUT", "/v1/local-runtimes/current/local-agents/codex/installations"],
      ["POST", "/v1/devices/current/forget"],
      ["PUT", "/v1/local-runtimes/current/openmeld-tools/maintenance"],
      ["POST", "/v1/prepare/sessions"],
      ["POST", "/v1/local-runtimes/current/openmeld-tools/%75pdate"],
      ["GET", "/v1/local-runtimes?connectionIdentityAdoption=token"],
    ]) {
      expect(
        (await handle(new Request(`${DESKTOP_APP_ORIGIN}${path}`, { method })))
          .status
      ).toBe(403);
    }
    expect(fetchCloud).toHaveBeenCalledTimes(1);
    for (const [method, path] of [
      [
        "GET",
        "/v1/people-computers/device/lanes/dev-local/local-agents/codex/installations",
      ],
      ["POST", "/v1/spaces/space/messages"],
      ["POST", "/v1/devices/device/forget"],
    ]) {
      expect(
        (await handle(new Request(`${DESKTOP_APP_ORIGIN}${path}`, { method })))
          .status
      ).toBe(200);
    }
    expect(fetchCloud).toHaveBeenCalledTimes(4);
  } finally {
    await rm(assets, { recursive: true, force: true });
  }
});

it("preserves the Space file download contract through the native transport", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const handle = createPilotProtocol({
    assets: "/unused",
    webOrigin: "https://openmeld.ai",
    webBuild: "a".repeat(64),
    installed: true,
    ensureCompatible: async () => undefined,
    cookie: () => "session=native-only",
    // Response metadata captured from a production Space PNG on 2026-09-15.
    cloudRequest: async () =>
      new Response(bytes, {
        headers: {
          "content-type": "image/png",
          "x-openmeld-file-revision": "1",
          "set-cookie": "session=must-stay-native",
        },
      }),
    fetch: () => {
      throw new Error("Expected native cloud transport");
    },
  });
  const api = createSpaceApi(
    createOpenMeldApiClient({
      baseUrl: "https://openmeld.ai",
      transport: async ({ url, init }) => {
        const target = new URL(url);
        const response = await handle(
          new Request(
            `${DESKTOP_APP_ORIGIN}${target.pathname}${target.search}`,
            init
          )
        );
        expect(response.headers.has("set-cookie")).toBe(false);
        return response;
      },
    })
  );
  const content = await api.downloadFileContent({
    spaceId: "space",
    fileId: "file",
    revision: 1,
  });
  expect(content.revision).toBe(1);
  expect(content.mimeType).toBe("image/png");
  expect(new Uint8Array(content.bytes)).toEqual(bytes);
});
