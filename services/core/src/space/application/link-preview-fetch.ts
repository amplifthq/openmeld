import { Buffer } from "node:buffer";
import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import { type LinkPreview, linkPreviewSchema } from "@openmeld/schemas";
import { decodeHTML, decodeHTMLAttribute } from "entities";
import ipaddr from "ipaddr.js";

const MAX_HTML_BYTES = 512 * 1024;
const TRAILING_DOT = /\.$/;
const WHITESPACE = /\s+/g;
const WORD_SEPARATOR = /\s+/;
const MAX_IMAGE_BYTES = 192 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".test",
  ".invalid",
  ".onion",
  ".home.arpa",
];

export function isPublicPreviewAddress(address: string): boolean {
  return ipaddr.isValid(address) && ipaddr.parse(address).range() === "unicast";
}

export function parsePublicPreviewUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(TRAILING_DOT, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    isIP(host) ||
    host.startsWith("[") ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new Error("preview_destination_blocked");
  }
  url.hash = "";
  return url;
}

async function assertPublicDns(
  hostname: string,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const results = await Promise.race([
    Promise.allSettled([resolve4(hostname), resolve6(hostname)]),
    aborted,
  ]).finally(() => {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  });
  const addresses = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (
    !addresses.length ||
    addresses.some((address) => !isPublicPreviewAddress(address))
  ) {
    throw new Error("preview_destination_blocked");
  }
}

export async function fetchPublicPreviewResource(
  value: string,
  signal: AbortSignal
): Promise<Response> {
  let url = parsePublicPreviewUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicDns(url.hostname, signal);
    signal.throwIfAborted();
    const response = await fetch(url.href, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "OpenMeld-LinkPreview/1.0",
        Accept: "text/html,image/*;q=0.8",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new Error("preview_redirect_invalid");
      }
      const destination = parsePublicPreviewUrl(new URL(location, url).href);
      if (url.protocol === "https:" && destination.protocol !== "https:") {
        throw new Error("preview_redirect_blocked");
      }
      url = destination;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`preview_http_${response.status}`);
    }
    return response;
  }
  throw new Error("preview_redirect_limit");
}

export async function readBoundedPreviewBody(
  response: Response,
  maxBytes: number,
  allowPrefix = false
): Promise<Uint8Array> {
  if (
    !allowPrefix &&
    Number(response.headers.get("content-length")) > maxBytes
  ) {
    await response.body?.cancel();
    throw new Error("preview_body_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (size + chunk.value.length > maxBytes && !allowPrefix) {
        throw new Error("preview_body_too_large");
      }
      const bytes = chunk.value.subarray(0, maxBytes - size);
      chunks.push(bytes);
      size += bytes.length;
      if (allowPrefix && size === maxBytes) {
        break;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function cleanText(value: string | undefined, limit: number): string | null {
  return value?.replace(WHITESPACE, " ").trim().slice(0, limit) || null;
}

export async function readPreviewMetadata(html: Uint8Array, baseUrl: string) {
  const meta = new Map<string, string>();
  let title = "";
  let icon: string | null = null;
  // biome-ignore lint/correctness/noUndeclaredVariables: Cloudflare native HTMLRewriter is declared in the generated Worker types.
  const parser = new HTMLRewriter()
    .on("head meta", {
      element(element) {
        const key =
          element.getAttribute("property") ?? element.getAttribute("name");
        const value = element.getAttribute("content");
        if (key && value && !meta.has(key.toLowerCase())) {
          meta.set(key.toLowerCase(), decodeHTMLAttribute(value));
        }
      },
    })
    .on("head title", {
      text(chunk) {
        title += chunk.text;
      },
    })
    .on("head link", {
      element(element) {
        if (
          !icon &&
          element.getAttribute("rel")?.split(WORD_SEPARATOR).includes("icon")
        ) {
          const href = element.getAttribute("href");
          icon = href ? decodeHTMLAttribute(href) : null;
        }
      },
    });
  await parser.transform(new Response(Buffer.from(html))).arrayBuffer();
  function resourceUrl(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    try {
      return parsePublicPreviewUrl(new URL(value, baseUrl).href).href;
    } catch {
      return null;
    }
  }
  return {
    title: cleanText(
      meta.get("og:title") ?? meta.get("twitter:title") ?? decodeHTML(title),
      300
    ),
    description: cleanText(
      meta.get("og:description") ??
        meta.get("twitter:description") ??
        meta.get("description"),
      500
    ),
    siteName: cleanText(meta.get("og:site_name"), 100),
    imageUrl: resourceUrl(meta.get("og:image") ?? meta.get("twitter:image")),
    iconUrl: resourceUrl(icon),
  };
}

async function readPreviewImage(
  url: string | null,
  signal: AbortSignal
): Promise<string | null> {
  if (!url) {
    return null;
  }
  try {
    const response = await fetchPublicPreviewResource(url, signal);
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!(type && IMAGE_TYPES.has(type))) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readBoundedPreviewBody(response, MAX_IMAGE_BYTES);
    return bytes.length
      ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}`
      : null;
  } catch {
    // Optional media never hides usable text metadata.
    return null;
  }
}

export async function readLinkPreview(
  spaceId: string,
  url: string
): Promise<LinkPreview> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${spaceId}\n${url}`)
  );
  const key = new Request(
    `https://link-previews.openmeld.invalid/v1/${Buffer.from(digest).toString("hex")}`
  );
  const cache = await caches.open("openmeld-link-previews");
  const cached = await cache.match(key);
  if (cached) {
    const parsed = linkPreviewSchema.safeParse(await cached.json());
    if (parsed.success) {
      return parsed.data;
    }
  }
  const preview: LinkPreview = {
    url,
    title: null,
    description: null,
    siteName: null,
    image: null,
    icon: null,
    status: "unavailable",
  };
  try {
    const signal = AbortSignal.timeout(6000);
    const response = await fetchPublicPreviewResource(url, signal);
    if (
      !response.headers.get("content-type")?.toLowerCase().includes("text/html")
    ) {
      await response.body?.cancel();
      throw new Error("preview_not_html");
    }
    const metadata = await readPreviewMetadata(
      await readBoundedPreviewBody(response, MAX_HTML_BYTES, true),
      response.url || url
    );
    preview.title = metadata.title;
    preview.description = metadata.description;
    preview.siteName = metadata.siteName;
    preview.status = "available";
    [preview.image, preview.icon] = await Promise.all([
      readPreviewImage(metadata.imageUrl, signal),
      readPreviewImage(metadata.iconUrl, signal),
    ]);
  } catch (error) {
    let reason = "unknown";
    if (error instanceof Error) {
      reason = error.message.startsWith("preview_")
        ? error.message
        : error.name;
    }
    console.info("[core.space.link_preview.unavailable]", {
      reason,
    });
  }
  await cache.put(
    key,
    Response.json(preview, {
      headers: {
        "Cache-Control": `max-age=${preview.status === "available" ? 3600 : 300}`,
      },
    })
  );
  return preview;
}
