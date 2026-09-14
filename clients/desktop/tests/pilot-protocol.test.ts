import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  for (const path of ["/_serverFn/generated", "/api/auth/get-session"]) {
    expect(
      (await handle(new Request(`${DESKTOP_APP_ORIGIN}${path}`))).status
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
      ["POST", "/v1/devices/device/forget"],
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
    ]) {
      expect(
        (await handle(new Request(`${DESKTOP_APP_ORIGIN}${path}`, { method })))
          .status
      ).toBe(200);
    }
    expect(fetchCloud).toHaveBeenCalledTimes(3);
  } finally {
    await rm(assets, { recursive: true, force: true });
  }
});
