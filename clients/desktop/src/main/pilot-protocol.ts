import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_WEB_BUILD_HEADER,
} from "@openmeld/schemas";
import { isPilotLocalControlRequest } from "./pilot-local-control-policy";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const FORWARDED_HEADERS = new Set([
  "accept",
  "content-type",
  "x-tsr-redirect",
  "x-tsr-serverfn",
  "x-openmeld-profile-id",
  "x-openmeld-active-organization-id",
  "x-openmeld-requested-organization-id",
  "x-openmeld-requested-organization-slug",
]);

type PilotProtocolOptions = {
  assets: string;
  webOrigin: string;
  webBuild: string;
  cookie: () => string;
  fetch: typeof fetch;
};

export function createPilotProtocol(input: PilotProtocolOptions) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      `${url.protocol}//${url.host}` !== DESKTOP_APP_ORIGIN ||
      url.username ||
      url.password
    ) {
      return new Response("Unknown Desktop origin", { status: 403 });
    }
    if (
      url.pathname.startsWith("/_serverFn/") ||
      url.pathname.startsWith("/v1/")
    ) {
      return await forwardCloud(request, url, input);
    }
    if (
      url.pathname.startsWith("/api/") ||
      !["GET", "HEAD"].includes(request.method)
    ) {
      return new Response(
        "This operation is not available in the Desktop pilot",
        { status: 403 }
      );
    }
    return await readAsset(request, url, input.assets);
  };
}

async function forwardCloud(
  request: Request,
  url: URL,
  input: PilotProtocolOptions
): Promise<Response> {
  if (isPilotLocalControlRequest(url, request.method)) {
    return new Response(
      "Manage this computer in OpenMeld Web. Desktop only supports protected Service Start and Stop.",
      { status: 403 }
    );
  }
  if (url.pathname.startsWith("/_serverFn/") && request.method !== "GET") {
    return new Response("Desktop pilot mutations must use the shared API", {
      status: 403,
    });
  }
  // The owning Session admits only the current native main frame before this
  // handler runs. Electron custom-protocol requests omit HTTP source metadata.
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (FORWARDED_HEADERS.has(name)) {
      headers.set(name, value);
    }
  }
  headers.set("origin", DESKTOP_APP_ORIGIN);
  headers.set(DESKTOP_WEB_BUILD_HEADER, input.webBuild);
  headers.set("cookie", input.cookie());
  const upstream = await input.fetch(
    new URL(url.pathname + url.search, input.webOrigin),
    {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
    }
  );
  if (upstream.status >= 300 && upstream.status < 400) {
    return new Response("Desktop cloud redirect refused", { status: 502 });
  }
  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "x-request-id",
    "x-tss-serialized",
    "x-tss-raw",
  ]) {
    const value = upstream.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

const LEADING_SLASHES = /^\/+/u;
const INLINE_SCRIPTS = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu;
const HTML_NEWLINES = /\r\n?/gu;
async function readAsset(
  request: Request,
  url: URL,
  assets: string
): Promise<Response> {
  try {
    const root = await realpath(assets);
    const relative = decodeURIComponent(url.pathname).replace(
      LEADING_SLASHES,
      ""
    );
    let file: string;
    try {
      file = await realpath(resolve(root, relative || "index.html"));
    } catch {
      if (extname(relative)) {
        throw new Error("Missing Desktop asset");
      }
      file = await realpath(resolve(root, "_shell.html"));
    }
    if (!file.startsWith(root + sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    const body = await readFile(file);
    // Hash only packaged document scripts; never enable arbitrary inline code.
    const scriptHashes =
      extname(file) === ".html"
        ? [...body.toString("utf8").matchAll(INLINE_SCRIPTS)]
            .flatMap((match) =>
              match[1]
                ? [
                    `'sha256-${createHash("sha256")
                      // CSP hashes the HTML parser's script text, not file bytes.
                      .update(
                        match[1]
                          .replace(HTML_NEWLINES, "\n")
                          .replaceAll("\u0000", "\uFFFD")
                      )
                      .digest("base64")}'`,
                  ]
                : []
            )
            .join(" ")
        : "";
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type":
          CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        "content-security-policy": `default-src 'self'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'`,
      },
    });
  } catch {
    return new Response("Desktop page files are unavailable", {
      status: 404,
    });
  }
}
