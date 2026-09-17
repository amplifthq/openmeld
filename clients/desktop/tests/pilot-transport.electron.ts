/** biome-ignore-all lint/suspicious/noMisplacedAssertion: Executed by the real Electron main process, not Vitest. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  protocol,
  session,
  type WebContents,
} from "electron";
import { installPilotTransport } from "../src/main/pilot-transport";

const root = process.argv[2];
assert(root, "Expected disposable harness directory");
app.setPath("userData", join(root, "gui"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "openmeld-desktop",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const windows: BrowserWindow[] = [];
const server = createServer((request, response) => {
  if (request.url === "/remote") {
    response.setHeader("content-type", "text/html");
    response.end('<iframe src="openmeld-desktop://app/"></iframe>');
    return;
  }
  assert.equal(request.headers.cookie, "session=fixture");
  assert.equal(request.headers.authorization, undefined);
  response.end("upstream");
});

app
  .whenReady()
  .then(async () => {
    await writeFile(
      join(root, "index.html"),
      "<!doctype html><title>Local fixture</title>"
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    const upstream = `http://127.0.0.1:${address.port}`;
    const transportSession = session.fromPartition("transport-contract");
    let owner: WebContents | null = null;
    let throwOnOwner = false;
    const order: string[] = [];
    let upstreamCalls = 0;
    const dispose = installPilotTransport(
      transportSession,
      () => {
        order.push("admission");
        if (throwOnOwner) {
          throw new Error("fixture owner unavailable");
        }
        return owner;
      },
      {
        assets: root,
        webOrigin: upstream,
        webBuild: "a".repeat(64),
        cookie: () => "session=fixture",
        fetch: (...args) => {
          order.push("upstream");
          upstreamCalls++;
          return fetch(...args);
        },
      }
    );
    const makeWindow = () => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          session: transportSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      windows.push(window);
      return window;
    };
    const primary = makeWindow();
    owner = primary.webContents;
    await primary.loadURL("openmeld-desktop://app/");
    const request = (method: string, path = "/v1/probe") =>
      `fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{Origin:"openmeld-desktop://app",Referer:"openmeld-desktop://app/",Authorization:"renderer-spoof"}}).then(r=>r.text())`;
    for (const [method, path] of [
      ["GET", "/v1/probe"],
      ["POST", "/v1/probe"],
      ["GET", "/_serverFn/probe"],
    ] as const) {
      order.length = 0;
      assert.equal(
        await owner.executeJavaScript(request(method, path)),
        "upstream"
      );
      assert.deepEqual(order, ["admission", "upstream"]);
    }
    const rejected = async (label: string, run: () => Promise<unknown>) => {
      const before = upstreamCalls;
      await assert.rejects(run);
      assert.equal(upstreamCalls, before, `${label} reached upstream`);
      console.log(`Rejected without upstream: ${label}`);
    };
    const other = makeWindow();
    await other.loadURL("openmeld-desktop://app/");
    await rejected("same-origin other window with spoofed headers", () =>
      other.webContents.executeJavaScript(request("POST"))
    );
    owner = null;
    await rejected("missing owner", () =>
      primary.webContents.executeJavaScript(request("GET"))
    );
    owner = primary.webContents;
    throwOnOwner = true;
    await rejected("owner lookup exception", () =>
      primary.webContents.executeJavaScript(request("GET"))
    );
    throwOnOwner = false;
    await rejected("session fetch without frame and spoofed headers", () =>
      transportSession.fetch("openmeld-desktop://app/v1/probe", {
        headers: {
          Origin: "openmeld-desktop://app",
          Referer: "openmeld-desktop://app/",
        },
      })
    );
    await rejected("top-level API navigation", () =>
      primary.loadURL("openmeld-desktop://app/v1/probe")
    );
    const remote = makeWindow();
    owner = remote.webContents;
    await remote.loadURL(`${upstream}/remote`);
    await rejected("remote owner document", () =>
      remote.webContents.executeJavaScript(
        request("GET", "openmeld-desktop://app/v1/probe")
      )
    );
    const child = remote.webContents.mainFrame.frames.find(
      (frame) => frame.url === "openmeld-desktop://app/"
    );
    assert(child, "expected a real local-origin child frame");
    await rejected("local-origin child of owner", () =>
      child.executeJavaScript(request("POST"))
    );
    owner = primary.webContents;
    primary.destroy();
    await rejected("destroyed owner", () =>
      other.webContents.executeJavaScript(request("GET"))
    );
    dispose();
    dispose();
    assert.equal(
      await transportSession.protocol.isProtocolHandled("openmeld-desktop"),
      false
    );
    assert.equal(upstreamCalls, 3);
    console.log(
      "Electron transport contract passed: GET/POST admission precedes upstream; all forbidden sources denied."
    );
  })
  .finally(() => {
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
    server.close();
  })
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    }
  );
