#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const GITHUB_REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const GIT_CONFIG_ENV_PATTERN = /^GIT_CONFIG_/u;
const GIT_HTTP_TLS_ENV_PATTERN = /^GIT_(?:HTTP|PROXY_SSL|SSL)(?:$|_)/u;
const GIT_TRACE_ENV_PATTERN = /^GIT_TRACE(?:$|_)/u;
const GIT_TRACE2_ENV_PATTERN = /^GIT_TRACE2(?:$|_)/u;
const TRAILING_SLASH_PATTERN = /\/$/u;
const UNSAFE_GIT_DIAGNOSTIC_ENV_NAMES = new Set(["GIT_CURL_VERBOSE"]);
const UNSAFE_HTTP_TLS_ENV_NAMES = new Set([
  "ALL_PROXY",
  "CURL_CA_BUNDLE",
  "CURL_SSL_BACKEND",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SSLKEYLOGFILE",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);
const UNSAFE_GIT_BEHAVIOR_ENV_NAMES = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_PROXY_COMMAND",
  "GIT_SSH",
  "GIT_SSH_VARIANT",
  "GIT_WORK_TREE",
]);
const SENSITIVE_GIT_ENV_NAMES = [
  "GH_ENTERPRISE_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "OPENMELD_PRODUCTION_LEASE_GITHUB_TOKEN",
  "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN",
];

export function createTrustedGitEnvironment(environment, input = {}) {
  const gitEnvironment = { ...environment };
  for (const name of Object.keys(gitEnvironment)) {
    if (
      GIT_CONFIG_ENV_PATTERN.test(name) ||
      GIT_HTTP_TLS_ENV_PATTERN.test(name) ||
      GIT_TRACE_ENV_PATTERN.test(name) ||
      GIT_TRACE2_ENV_PATTERN.test(name) ||
      UNSAFE_GIT_BEHAVIOR_ENV_NAMES.has(name) ||
      UNSAFE_GIT_DIAGNOSTIC_ENV_NAMES.has(name) ||
      UNSAFE_HTTP_TLS_ENV_NAMES.has(name) ||
      SENSITIVE_GIT_ENV_NAMES.includes(name)
    ) {
      Reflect.deleteProperty(gitEnvironment, name);
    }
  }
  Object.assign(gitEnvironment, {
    GIT_ASKPASS: "",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_SSH_COMMAND: "",
    GIT_TERMINAL_PROMPT: "0",
    GIT_TRACE_REDACT: "1",
  });
  if (!input.preserveCredentialConfig) {
    Object.assign(gitEnvironment, {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    });
  }

  const entries = [
    ["core.hooksPath", "/dev/null"],
    ["core.fsmonitor", "false"],
    ["protocol.ext.allow", "never"],
  ];
  if (input.authenticate) {
    const serverUrl = requireHttpsServerUrl(input.serverUrl);
    const token = String(input.token ?? "").trim();
    if (!token) {
      throw new Error("Trusted GitHub network access requires a token.");
    }
    entries.push([
      `http.${serverUrl}/.extraheader`,
      `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    ]);
    entries.push([`http.${serverUrl}/.proxy`, ""]);
    entries.push([`http.${serverUrl}/.sslVerify`, "true"]);
    if (input.caInfoPath !== undefined) {
      const caInfoPath = String(input.caInfoPath);
      if (!isAbsolute(caInfoPath)) {
        throw new Error(
          "Trusted Git CA information must use an absolute path."
        );
      }
      entries.push([`http.${serverUrl}/.sslCAInfo`, caInfoPath]);
    }
  }
  gitEnvironment.GIT_CONFIG_COUNT = String(entries.length);
  for (const [index, [key, value]] of entries.entries()) {
    gitEnvironment[`GIT_CONFIG_KEY_${String(index)}`] = key;
    gitEnvironment[`GIT_CONFIG_VALUE_${String(index)}`] = value;
  }
  return gitEnvironment;
}

export function buildTrustedGitHubRepositoryUrl(input) {
  const serverUrl = requireHttpsServerUrl(input.serverUrl);
  const repository = String(input.repository ?? "").trim();
  if (!GITHUB_REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Trusted GitHub network access requires owner/name.");
  }
  return `${serverUrl}/${repository}.git`;
}

export function fetchTrustedGitHubMain(input) {
  return runTrustedGitNetwork({
    ...input,
    args: [
      "fetch",
      "--no-tags",
      buildTrustedGitHubRepositoryUrl(input),
      "refs/heads/main:refs/remotes/origin/main",
    ],
    operation: "refresh current main",
  });
}

export function fetchTrustedLocalMain(input) {
  const remoteUrl = String(input.remoteUrl ?? "").trim();
  if (!(remoteUrl.startsWith("/") || remoteUrl.startsWith("file://"))) {
    throw new Error(
      "Trusted local Git refresh requires an explicit absolute path or file URL."
    );
  }
  return runGit({
    ...input,
    args: [
      "fetch",
      "--no-tags",
      remoteUrl,
      "refs/heads/main:refs/remotes/origin/main",
    ],
    authenticate: false,
    operation: "refresh current main from the explicit local remote",
  });
}

export function fetchTrustedGitHubTags(input) {
  return runTrustedGitNetwork({
    ...input,
    args: [
      "fetch",
      "--tags",
      "--force",
      buildTrustedGitHubRepositoryUrl(input),
    ],
    operation: "refresh immutable tags",
  });
}

function runTrustedGitNetwork(input) {
  return runGit({ ...input, authenticate: true });
}

function runGit(input) {
  const result = spawnSync("git", input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: createTrustedGitEnvironment(input.environment ?? process.env, {
      authenticate: input.authenticate,
      caInfoPath: input.caInfoPath,
      serverUrl: input.serverUrl,
      token: input.token,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `Trusted Git could not ${input.operation ?? input.args[0]}.`,
        result.error?.message,
        String(result.stderr ?? "").trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return {
    status: result.status,
    stderr: String(result.stderr ?? ""),
    stdout: String(result.stdout ?? ""),
  };
}

function requireHttpsServerUrl(value) {
  const url = new URL(String(value ?? "https://github.com"));
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Trusted GitHub network access requires a clean HTTPS server URL."
    );
  }
  return url.href.replace(TRAILING_SLASH_PATTERN, "");
}

function parseOptions(args) {
  const [operation, ...remaining] = args;
  const options = { operation };
  for (let index = 0; index < remaining.length; index += 1) {
    const name = remaining[index];
    const value = remaining[index + 1];
    if (!(name?.startsWith("--") && value) || value.startsWith("--")) {
      throw new Error(`Invalid trusted Git option: ${name ?? ""}`);
    }
    options[name.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  return options;
}

function main(argv) {
  const options = parseOptions(argv);
  const input = {
    cwd: options.cwd,
    repository: options.repository,
    serverUrl: process.env.OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL,
    token: process.env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN,
  };
  if (options.operation === "fetch-main") {
    fetchTrustedGitHubMain(input);
    return;
  }
  if (options.operation === "fetch-tags") {
    fetchTrustedGitHubTags(input);
    return;
  }
  throw new Error(`Unknown trusted Git operation: ${options.operation ?? ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
