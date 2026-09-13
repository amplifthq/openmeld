import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import { createPilotProtocol } from "../src/main/pilot-protocol";

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
  } finally {
    await rm(assets, { recursive: true, force: true });
  }
});
