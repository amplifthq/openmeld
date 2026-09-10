import { resolve4 } from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPublicPreviewResource,
  isPublicPreviewAddress,
  parsePublicPreviewUrl,
  readBoundedPreviewBody,
  readLinkPreview,
  readPreviewMetadata,
} from "../space/application/link-preview-fetch";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(async () => ["93.184.216.34"]),
  resolve6: vi.fn(async () => []),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(resolve4).mockResolvedValue(["93.184.216.34"]);
});

describe("public link previews", () => {
  it("blocks credentials, private hosts, IP literals, and non-web destinations", () => {
    for (const url of [
      "http://localhost",
      "http://127.1",
      "http://2130706433",
      "http://[::1]",
      "https://docs.local",
      "https://example.com:8443",
      "https://user:secret@example.com",
      "file:///etc/passwd",
    ]) {
      expect(() => parsePublicPreviewUrl(url)).toThrow();
    }
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
    ]) {
      expect(isPublicPreviewAddress(address)).toBe(false);
    }
    expect(isPublicPreviewAddress("93.184.216.34")).toBe(true);
  });
  it("rejects a public hostname resolving to a private address before fetching", async () => {
    vi.mocked(resolve4).mockResolvedValue(["10.0.0.1"]);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      fetchPublicPreviewResource(
        "https://example.com",
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow("preview_destination_blocked");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks every redirect and never forwards ambient credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.redirect("http://169.254.169.254/latest/meta-data/", 302)
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      fetchPublicPreviewResource(
        "https://example.com",
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow("preview_destination_blocked");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      headers: { "User-Agent": "OpenMeld-LinkPreview/1.0" },
    });
  });
  it("bounds streamed bodies even when Content-Length is absent", async () => {
    await expect(
      readBoundedPreviewBody(new Response("123456"), 5)
    ).rejects.toThrow("preview_body_too_large");
  });
  it("reads standard metadata with the actual Workers HTML parser, not executable page content", async () => {
    // The public Open Graph protocol's title/tag contract: https://ogp.me/.
    const html = new TextEncoder().encode(
      '<html><head><title>Fallback</title><meta property="og:title" content="The Open Graph protocol"><meta name="description" content="A short description."><meta property="og:image" content="/cover.png"><link rel="icon" href="/icon.png"></head><body><script>throw new Error("never execute")</script></body></html>'
    );
    expect(await readPreviewMetadata(html, "https://ogp.me/")).toEqual({
      title: "The Open Graph protocol",
      description: "A short description.",
      siteName: null,
      imageUrl: "https://ogp.me/cover.png",
      iconUrl: "https://ogp.me/icon.png",
    });
  });
  it("caches unavailable previews without fetching private destinations", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const url = "http://localhost/private";
    const result = await readLinkPreview(crypto.randomUUID(), url);
    expect(result).toMatchObject({
      url,
      title: null,
      image: null,
      status: "unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
