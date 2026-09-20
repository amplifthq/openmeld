import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import {
  OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION,
  OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_HEADER_INBOX_SUMMARY_VERSION,
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";
import {
  ACCOUNT_SESSION_PATH,
  accountSessionSchema,
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_UPDATE_OBSERVATION_PATH,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopLocalComputer,
  SPACE_ACCESS_VERSION_HEADER,
} from "@openmeld/schemas";
import {
  desktopWorkingFolderTarget,
  isPilotLocalControlRequest,
} from "./pilot-local-control-policy";

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
  SPACE_ACCESS_VERSION_HEADER,
  OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION,
  OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_HEADER_INBOX_SUMMARY_VERSION,
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
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
  installed?: boolean;
  cloudRequest?: (
    path: string,
    request: { method: string; headers: Headers; body?: ArrayBuffer }
  ) => Promise<Response>;
  ensureCompatible?: () => Promise<void>;
  readLocalComputer?: () => Promise<DesktopLocalComputer>;
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
      const sourceRefusal = admitRendererCloudPath(url);
      if (sourceRefusal) {
        return sourceRefusal;
      }
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

const TRAILING_SLASHES = /\/+$/u;

function admitRendererCloudPath(url: URL): Response | null {
  // A trusted renderer is not the authority for Main's native updater facts.
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).replace(TRAILING_SLASHES, "");
  } catch {
    return new Response("Invalid Desktop request path", { status: 403 });
  }
  return pathname === DESKTOP_UPDATE_OBSERVATION_PATH
    ? new Response("Only the native updater can report update observations.", {
        status: 403,
      })
    : null;
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
  if (input.installed && url.pathname.startsWith("/_serverFn/")) {
    return new Response("Open this action in OpenMeld Web.", { status: 403 });
  }
  if (input.installed) {
    if (!input.ensureCompatible) {
      throw new Error("Desktop compatibility admission is unavailable.");
    }
    await input.ensureCompatible();
  }
  if (url.pathname.startsWith("/_serverFn/") && request.method !== "GET") {
    return new Response("Desktop pilot mutations must use the shared API", {
      status: 403,
    });
  }
  const folderCookie = desktopWorkingFolderTarget(url, request.method)
    ? input.cookie()
    : undefined;
  const folderRefusal = await admitWorkingFolder(request, url, input);
  if (folderRefusal) {
    return folderRefusal;
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
  headers.set(
    input.installed ? DESKTOP_CONTRACT_HEADER : DESKTOP_WEB_BUILD_HEADER,
    input.installed ? DESKTOP_CONTRACT_VERSION : input.webBuild
  );
  headers.set("cookie", input.cookie());
  const nativeAccountRead =
    url.pathname === ACCOUNT_SESSION_PATH &&
    !url.search &&
    request.method === "GET";
  const cloudRequest = {
    method: request.method,
    headers,
    body: await readCloudBody(request),
  };
  if (folderCookie !== undefined && input.cookie() !== folderCookie) {
    return Response.json(
      {
        code: "desktop.folder.account_changed",
        message:
          "Your Desktop sign-in changed. Reopen the working folder settings and try again.",
      },
      { status: 409 }
    );
  }
  const upstream =
    url.pathname.startsWith("/v1/") && input.cloudRequest
      ? await input.cloudRequest(url.pathname + url.search, cloudRequest)
      : await input.fetch(new URL(url.pathname + url.search, input.webOrigin), {
          ...cloudRequest,
          redirect: "manual",
        });
  return sanitizeCloudResponse(upstream, Boolean(nativeAccountRead));
}

async function readCloudBody(request: Request) {
  return request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
}

async function admitWorkingFolder(
  request: Request,
  url: URL,
  input: PilotProtocolOptions
): Promise<Response | null> {
  const folderTarget = desktopWorkingFolderTarget(url, request.method);
  if (folderTarget) {
    const local = await input.readLocalComputer?.();
    if (!local || local.status !== "available") {
      return Response.json(
        {
          code: "desktop.folder.computer_unavailable",
          message:
            local?.status === "unavailable"
              ? local.message
              : "Couldn’t check this computer for folder selection. Reopen Desktop and try again.",
        },
        { status: 409 }
      );
    }
    if (
      folderTarget.deviceId !== local.target.deviceId ||
      folderTarget.runtimeLane !== local.target.runtimeLane
    ) {
      return Response.json(
        {
          code: "desktop.folder.computer_mismatch",
          message:
            "Choose a folder on the computer running this Desktop app. The selected computer or environment is different.",
        },
        { status: 409 }
      );
    }
  }
  return null;
}

async function sanitizeCloudResponse(
  upstream: Response,
  nativeAccountRead: boolean
): Promise<Response> {
  if (upstream.status >= 300 && upstream.status < 400) {
    return new Response("Desktop cloud redirect refused", { status: 502 });
  }
  if (nativeAccountRead && upstream.ok) {
    const body: unknown = await upstream
      .clone()
      .json()
      .catch(() => null);
    if (!accountSessionSchema.safeParse(body).success) {
      return new Response("OpenMeld returned an invalid account response.", {
        status: 502,
        headers: { "cache-control": "private, no-store" },
      });
    }
  }
  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "cache-control",
    "x-openmeld-file-revision",
    "x-request-id",
    "x-openmeld-request-id",
    "server-timing",
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
        "content-security-policy": `default-src 'self'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'`,
      },
    });
  } catch {
    return new Response("Desktop page files are unavailable", {
      status: 404,
    });
  }
}
