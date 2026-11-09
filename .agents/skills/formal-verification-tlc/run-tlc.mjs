import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const JAR_URL =
  "https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar";
const JAR_SHA256 =
  "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88";

const jarPath = () => {
  const cache = process.env.TLA2TOOLS;
  if (cache) {
    return cache;
  }
  return path.join(
    os.homedir(),
    ".cache",
    "openmeld-tlc",
    "tla2tools-1.7.4.jar"
  );
};

const sha256 = (file) => {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
};

export const ensureTlcJar = async () => {
  const jar = jarPath();
  if (fs.existsSync(jar) && sha256(jar) === JAR_SHA256) {
    return jar;
  }
  fs.mkdirSync(path.dirname(jar), { recursive: true });
  const response = await fetch(JAR_URL);
  if (!response.ok) {
    throw new Error(
      `Could not download TLC (${response.status}) from ${JAR_URL}`
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== JAR_SHA256) {
    throw new Error(`TLC jar checksum ${digest} does not match ${JAR_SHA256}`);
  }
  fs.writeFileSync(jar, bytes);
  return jar;
};

const run = (java, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(java, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

const violatedInvariants = (output) => {
  const names = [];
  for (const match of output.matchAll(/Invariant (\S+) is violated/g)) {
    names.push(match[1]);
  }
  return names;
};

/**
 * Run TLC on one module. `invariants` replaces the cfg invariant list so a
 * known finding can be checked on its own. Deadlock checking stays on.
 */
export const runTlc = async ({ specDir, moduleName, invariants }) => {
  const jar = await ensureTlcJar();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmeld-tlc-"));
  const tmp = path.join(dir, "tmp");
  fs.mkdirSync(tmp);
  fs.copyFileSync(
    path.join(specDir, `${moduleName}.tla`),
    path.join(dir, `${moduleName}.tla`)
  );
  fs.writeFileSync(
    path.join(dir, `${moduleName}.cfg`),
    `SPECIFICATION Spec\nINVARIANT ${invariants.join(" ")}\n`
  );
  const java = process.env.JAVA || "java";
  const result = await run(
    java,
    [
      "-XX:+UseParallelGC",
      `-Djava.io.tmpdir=${tmp}`,
      "-cp",
      jar,
      "tlc2.TLC",
      "-workers",
      "1",
      "-fp",
      "0",
      "-lncheck",
      "final",
      moduleName,
    ],
    dir
  );
  const output = `${result.stdout}\n${result.stderr}`;
  return {
    code: result.code,
    output,
    violated: violatedInvariants(output),
    passed: output.includes("No error has been found"),
  };
};
