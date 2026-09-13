import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import { createPilotProtocol } from "../src/main/pilot-protocol";

it("serves local page files and confines credentials to the configured cloud origin", async () => {
  const assets = await mkdtemp(join(tmpdir(), "openmeld-desktop-assets-"));
  try {
    await writeFile(join(assets, "index.html"), "local application");
    const fetchCloud = vi.fn<typeof fetch>(
      async () =>
        new Response("cloud result", {
          headers: {
            "set-cookie": "credential=secret",
            "content-type": "text/plain",
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
    expect(
      await (await handle(new Request(`${DESKTOP_APP_ORIGIN}/`))).text()
    ).toBe("local application");
    const result = await handle(
      new Request(`${DESKTOP_APP_ORIGIN}/v1/spaces`, {
        headers: {
          origin: DESKTOP_APP_ORIGIN,
          authorization: "renderer-credential",
          cookie: "renderer-cookie",
        },
      })
    );
    expect(await result.text()).toBe("cloud result");
    expect(result.headers.has("set-cookie")).toBe(false);
    const [target, options] = fetchCloud.mock.calls[0] ?? [];
    expect(String(target)).toBe("https://web.example/v1/spaces");
    expect(new Headers(options?.headers).get("cookie")).toBe(
      "session=main-only"
    );
    expect(new Headers(options?.headers).has("authorization")).toBe(false);
    expect(options?.redirect).toBe("manual");
    for (const request of [
      new Request("openmeld-desktop://other/v1/spaces", {
        headers: { origin: DESKTOP_APP_ORIGIN },
      }),
      new Request(`${DESKTOP_APP_ORIGIN}/v1/spaces`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
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
  } finally {
    await rm(assets, { recursive: true, force: true });
  }
});
