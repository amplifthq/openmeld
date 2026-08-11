import { spawn } from "node:child_process";

const BASE_URL = "http://127.0.0.1:8799";
const HEALTH_URL = `${BASE_URL}/health`;
const START_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const WRANGLER_ARGS = [
  "exec",
  "wrangler",
  "dev",
  "--config",
  "wrangler.test.jsonc",
  "--ip",
  "127.0.0.1",
  "--port",
  "8799",
];

const outputBuffer = [];
let child = null;

function appendOutput(prefix, chunk) {
  const text = String(chunk);
  if (text.length === 0) {
    return;
  }

  outputBuffer.push(`${prefix}${text}`);
  if (outputBuffer.length > 50) {
    outputBuffer.shift();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealthyWorker() {
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.status === 200) {
        const body = await response.json();
        if (body?.ok === true && body?.service === "openmeld-auth") {
          return;
        }
      }
    } catch {
      // Ignore connection failures until the worker is ready.
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const logs = outputBuffer.join("");
  throw new Error(
    `timed out waiting for auth worker runtime smoke\n${logs}`.trim()
  );
}

async function shutdown() {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child?.kill("SIGKILL");
      resolve(undefined);
    }, 5000);
    child?.once("exit", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
  });
}

async function main() {
  child = spawn("pnpm", WRANGLER_ARGS, {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    appendOutput("[wrangler] ", chunk);
  });
  child.stderr.on("data", (chunk) => {
    appendOutput("[wrangler:error] ", chunk);
  });

  child.once("exit", (code) => {
    if (code !== 0) {
      appendOutput("[wrangler:error] ", `process exited with code ${code}\n`);
    }
  });

  try {
    await waitForHealthyWorker();
    console.log("auth worker runtime smoke passed");
  } finally {
    await shutdown();
  }
}

await main();
