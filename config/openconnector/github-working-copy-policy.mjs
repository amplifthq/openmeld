// Downstream integration policy, not a credential store. The reviewed fork
// keys its app cache by allowedProxies AND blockedProxies. Keep its
// ordinary API/MCP environment unchanged and unblock only this validated call.
export const OPENMELD_GIT_PROXY_UPSTREAM_SHA =
  "269dfc17d59f6b0ca1052dce3053fb3028bb9534";
export const OPENMELD_GIT_PROXY_PATH = "/v1/openmeld/github-working-copy";
const REPOSITORY_PATH = /^\/repos\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)(.*)$/u;
const SHA = /^[a-f0-9]{40}$/u;
const TASK_REF = /^refs\/heads\/openmeld\/work-[a-f0-9]{32}$/u;
const TASK_PATH = /^\/git\/refs?\/heads\/openmeld%2Fwork-[a-f0-9]{32}$/u;
const OBJECT_PATH = /^\/git\/(blobs|trees)\/[a-f0-9]{40}$/u;
const SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/u;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

function keys(value, allowed) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}
function safeRefPath(path, prefix) {
  if (!path.startsWith(prefix)) {
    return false;
  }
  try {
    const encoded = path.slice(prefix.length);
    const ref = decodeURIComponent(encoded);
    return (
      encodeURIComponent(ref) === encoded &&
      SAFE_REF.test(ref) &&
      ref
        .split("/")
        .every((part) => part !== "." && part !== ".." && part !== "")
    );
  } catch {
    return false;
  }
}

export function isAllowedGitWorkingCopyRequest(value) {
  if (
    !keys(value, ["endpoint", "method", "body", "query"]) ||
    typeof value.endpoint !== "string"
  ) {
    return false;
  }
  const match = REPOSITORY_PATH.exec(value.endpoint);
  if (!match || match[2] === "." || match[2] === "..") {
    return false;
  }
  const path = match[3];
  if (value.method === "GET") {
    const query = value.query;
    if (
      value.body !== undefined ||
      (query !== undefined &&
        !(
          keys(query, ["recursive"]) &&
          query.recursive === "1" &&
          path.startsWith("/git/trees/")
        ))
    ) {
      return false;
    }
    return (
      path === "" ||
      safeRefPath(path, "/commits/") ||
      OBJECT_PATH.test(path) ||
      // Read the exact default branch, never a matching-ref prefix or tag.
      safeRefPath(path, "/git/ref/heads/")
    );
  }
  if (value.query !== undefined) {
    return false;
  }
  return allowedWrite(path, value.method, value.body);
}

function allowedWrite(path, method, body) {
  if (method === "PATCH") {
    return (
      path.startsWith("/git/refs/") &&
      TASK_PATH.test(path) &&
      keys(body, ["sha", "force"]) &&
      SHA.test(body.sha) &&
      body.force === false
    );
  }
  if (method !== "POST") {
    return false;
  }
  if (path === "/git/refs") {
    return (
      keys(body, ["ref", "sha"]) &&
      TASK_REF.test(body.ref) &&
      SHA.test(body.sha)
    );
  }
  if (path === "/git/blobs") {
    return (
      keys(body, ["content", "encoding"]) &&
      body.encoding === "base64" &&
      typeof body.content === "string" &&
      body.content.length <= 12 * 1024 * 1024
    );
  }
  if (path === "/git/trees") {
    return (
      keys(body, ["tree"]) &&
      Array.isArray(body.tree) &&
      body.tree.length <= 30_000
    );
  }
  if (path === "/git/commits") {
    return (
      keys(body, ["tree", "parents", "message"]) &&
      SHA.test(body.tree) &&
      Array.isArray(body.parents) &&
      body.parents.length === 1 &&
      SHA.test(body.parents[0]) &&
      typeof body.message === "string" &&
      body.message.length <= 4000
    );
  }
  return false;
}

async function readRequestBody(request) {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new Error("missing_body");
  }
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function withGitWorkingCopyPolicy(upstream) {
  return {
    ...upstream,
    async fetch(request, env, context) {
      const url = new URL(request.url);
      if (url.pathname !== OPENMELD_GIT_PROXY_PATH) {
        return await upstream.fetch(request, env, context);
      }
      let body;
      try {
        body = await readRequestBody(request);
      } catch {
        return Response.json(
          { success: false, errorCode: "git_request_invalid" },
          { status: 400 }
        );
      }
      if (
        request.method !== "POST" ||
        url.search ||
        !request.headers.get("x-oo-connector-alias") ||
        !isAllowedGitWorkingCopyRequest(body)
      ) {
        return Response.json(
          { success: false, errorCode: "git_request_forbidden" },
          { status: 403 }
        );
      }
      url.pathname = "/v1/proxy/github";
      const forwarded = new Request(url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
      // Upstream still authenticates the runtime token, exact connection grant
      // and provider account. This does not mint or broaden any token grant.
      return await upstream.fetch(
        forwarded,
        {
          ...env,
          OOMOL_CONNECT_ALLOWED_PROXIES: "github",
          OOMOL_CONNECT_BLOCKED_PROXIES: "",
        },
        context
      );
    },
  };
}
