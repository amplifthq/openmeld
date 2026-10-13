import { spawnSync } from "node:child_process";
import { createServer } from "node:http";

const GRANT_REPOSITORY_PREFIX = /^\/[^/]+\/acme/u;

/** Local Git smart-HTTP boundary. No request is forwarded to the network. */
export async function createGitHttpProxy(
  root: string,
  allowed: (path: string) => boolean
) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://computer.internal");
    if (!allowed(url.pathname)) {
      response.writeHead(403).end("Git transfer grant is unavailable.");
      return;
    }
    const parts: Buffer[] = [];
    for await (const part of request) {
      parts.push(Buffer.from(part));
    }
    const body = Buffer.concat(parts);
    const result = spawnSync("git", ["http-backend"], {
      input: body,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname.replace(GRANT_REPOSITORY_PREFIX, ""),
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: String(body.length),
        HTTP_GIT_PROTOCOL: String(request.headers["git-protocol"] ?? ""),
      },
    });
    const separator = result.stdout.indexOf("\r\n\r\n");
    if (result.status !== 0 || separator < 0) {
      response.writeHead(500).end("Local Git HTTP backend failed");
      return;
    }
    for (const line of result.stdout
      .subarray(0, separator)
      .toString()
      .split("\r\n")) {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon);
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === "status") {
        response.statusCode = Number.parseInt(value, 10);
      } else {
        response.setHeader(name, value);
      }
    }
    response.end(result.stdout.subarray(separator + 4));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local Git proxy did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
