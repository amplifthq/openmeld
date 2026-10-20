#!/usr/bin/env node

// OpenMeld local components (CLI, Service, Skills) release facts and policy.
//
// The release manifest is not a repository file. scripts/release/publish-cli.mjs
// computes it at publication from the packaged CLI, compares each component's
// bytes with the manifest already published to R2, and requires an explicit
// update policy in release/local-components-policy.json for every component
// that changed. Core reads the published manifest at runtime.
//
//   node scripts/release/local-components.mjs check [--base <ref>]

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  isCliReleasePath,
  isServiceReleasePath,
  isSkillsReleasePath,
} from "./release-ready-paths.mjs";
import { compareSemverCore } from "./release-semver.mjs";

const execFileAsync = promisify(execFile);

export const LOCAL_COMPONENTS_RELEASE_SCHEMA_VERSION = 1;
export const LOCAL_COMPONENTS_POLICY_PATH =
  "release/local-components-policy.json";
export const COMPONENTS = ["cli", "service", "skills"];

const CLI_PACKAGE_JSON_PATH = "clients/openmeld-cli/package.json";
const CLI_LOCAL_COMPONENTS_SOURCE_PATH =
  "clients/openmeld-cli/src/local-components/manifest.ts";
const RUNTIME_TRANSPORT_SCHEMA_SOURCE_PATH =
  "packages/schemas/src/schemas/daemon/runtime-transport.ts";
const CORE_LOCAL_COMPONENTS_UPDATE_PROJECTION_PATH =
  "services/core/src/local-components/update-projection.ts";
const CLI_DIST_ROOT_PATH = "clients/openmeld-cli/dist";
// CLI-only artifacts have their own signed release integrity. The full Service
// hash includes the Windows helper bytes; the portable hash covers every other
// Service file for a build without the Windows helper.
const SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS = new Set(["binary", "native"]);
const PORTABLE_SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS = new Set([
  ...SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS,
  "windows",
]);
export const PACKAGED_WINDOWS_PROCESS_HELPER =
  "clients/openmeld-cli/dist/windows/openmeld-windows-process.exe";
const SKILLS_ROOT_PATH = "clients/openmeld-cli/skills";
const RELEASE_DECISION_POLICIES = new Set(["available", "required"]);
const MINIMUM_POLICY_REASON_LENGTH = 20;
const PLAIN_RELEASE_VERSION = /^\d+\.\d+\.\d+$/u;
const COMPONENT_LABELS = {
  cli: "OpenMeld CLI",
  service: "OpenMeld Service",
  skills: "OpenMeld skills",
};

export async function collectLocalComponentFacts(input = {}) {
  const repoRoot = resolve(input.repoRoot ?? process.cwd());
  const read = (path) => readFile(join(repoRoot, path), "utf8");
  const [packageJson, cliSource, transportSource, coreSource] =
    await Promise.all([
      read(CLI_PACKAGE_JSON_PATH).then(JSON.parse),
      read(CLI_LOCAL_COMPONENTS_SOURCE_PATH),
      read(RUNTIME_TRANSPORT_SCHEMA_SOURCE_PATH),
      read(CORE_LOCAL_COMPONENTS_UPDATE_PROJECTION_PATH),
    ]);
  const packageVersion = requireText(
    packageJson.version,
    `${CLI_PACKAGE_JSON_PATH} version`
  );
  const runtimeContractEpoch = parseStringConstant(
    transportSource,
    "CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH"
  );
  const distRoot = join(repoRoot, CLI_DIST_ROOT_PATH);
  const serviceBundleHash = await computeServiceBundleHash({
    rootDir: distRoot,
  });
  if (input.requireServiceBundle && !serviceBundleHash) {
    throw new Error(
      `OpenMeld CLI dist is missing at ${CLI_DIST_ROOT_PATH}. Build the packaged CLI first.`
    );
  }
  return {
    cli: {
      commandContractVersion: parseStringConstant(
        cliSource,
        "OPENMELD_CLI_COMMAND_CONTRACT_VERSION"
      ),
      packageVersion,
    },
    cliRequiredFloor: optionalText(packageJson.openmeld?.minRequiredCliVersion),
    hasWindowsProcessHelper: await pathExists(
      join(repoRoot, PACKAGED_WINDOWS_PROCESS_HELPER)
    ),
    service: {
      bundleHash: serviceBundleHash,
      portableBundleHash: await computeServiceBundleHash({
        rootDir: distRoot,
        excludeWindows: true,
      }),
      bundleVersion: packageVersion,
      runtimeContractEpoch,
      serviceContractVersion:
        parseStringConstant(cliSource, "OPENMELD_SERVICE_CONTRACT_VERSION", {
          required: false,
        }) ?? runtimeContractEpoch,
    },
    serviceRequiredFloor: parseStringConstant(
      coreSource,
      "MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION",
      { exported: false }
    ),
    skills: {
      bundleHash: await computeDirectoryContentHash({
        ignoredNames: new Set([".openmeld-skill.json"]),
        mode: "skills",
        rootDir: join(repoRoot, SKILLS_ROOT_PATH),
      }),
      skillContractVersion: parseStringConstant(
        cliSource,
        "OPENMELD_SKILLS_CONTRACT_VERSION"
      ),
      skillIds: ["openmeld-cli"],
    },
  };
}

// Path-based view for pull requests: which components a diff touches.
export function resolveTouchedLocalComponents(changedPaths = []) {
  const touched = new Set();
  for (const path of changedPaths) {
    if (isCliReleasePath(path)) {
      touched.add("cli");
    }
    if (isServiceReleasePath(path)) {
      touched.add("service");
    }
    if (isSkillsReleasePath(path)) {
      touched.add("skills");
    }
  }
  // Service and Skills ship inside the CLI package, so any change is a CLI release.
  if (touched.size > 0) {
    touched.add("cli");
  }
  return COMPONENTS.filter((component) => touched.has(component));
}

// Byte-based view for publication: which components differ from the release
// already published. The CLI package is new on every publication.
export function resolveChangedLocalComponents({ facts, published }) {
  if (!published) {
    return [...COMPONENTS];
  }
  const serviceHash = facts.hasWindowsProcessHelper
    ? ["bundleHash", facts.service.bundleHash]
    : ["portableBundleHash", facts.service.portableBundleHash];
  const changed = ["cli"];
  if (published.components.service[serviceHash[0]] !== serviceHash[1]) {
    changed.push("service");
  }
  if (published.components.skills.bundleHash !== facts.skills.bundleHash) {
    changed.push("skills");
  }
  return changed;
}

export function parseLocalComponentsPolicy(value) {
  const errors = [];
  if (!(value && typeof value === "object")) {
    return {
      errors: [`${LOCAL_COMPONENTS_POLICY_PATH} must be a JSON object.`],
    };
  }
  if (!PLAIN_RELEASE_VERSION.test(value.version ?? "")) {
    errors.push(
      `${LOCAL_COMPONENTS_POLICY_PATH} version must be the CLI package version it releases.`
    );
  }
  for (const key of Object.keys(value)) {
    if (!(key === "version" || COMPONENTS.includes(key))) {
      errors.push(
        `${LOCAL_COMPONENTS_POLICY_PATH} has an unknown key "${key}".`
      );
    }
  }
  return { errors, policy: value };
}

// One decision per changed component, made by the pull request that changed it.
export function resolveReleaseDecisionErrors(input) {
  const { changed, facts, policy } = input;
  const errors = [];
  if (policy.version !== facts.cli.packageVersion) {
    errors.push(
      `${LOCAL_COMPONENTS_POLICY_PATH} declares ${policy.version}, but ${CLI_PACKAGE_JSON_PATH} is ${facts.cli.packageVersion}. Bump both together for the next CLI release.`
    );
  }
  for (const component of changed) {
    const decision = policy[component];
    const label = COMPONENT_LABELS[component];
    if (!RELEASE_DECISION_POLICIES.has(decision?.updatePolicy)) {
      errors.push(
        `${label} changed, so ${LOCAL_COMPONENTS_POLICY_PATH} must set ${component}.updatePolicy to "available" or "required".`
      );
    }
    if (
      (optionalText(decision?.reason)?.length ?? 0) <
      MINIMUM_POLICY_REASON_LENGTH
    ) {
      errors.push(
        `${label} changed, so ${component}.reason must state the concrete compatibility reason.`
      );
    }
  }
  const base = input.base;
  const requireRequired = (component, changedFact, message) => {
    if (changedFact && policy[component]?.updatePolicy !== "required") {
      errors.push(message);
    }
  };
  if (base) {
    requireRequired(
      "cli",
      base.commandContractVersion !== facts.cli.commandContractVersion,
      "The CLI command contract changed, so cli.updatePolicy must be required."
    );
    requireRequired(
      "service",
      base.runtimeContractEpoch !== facts.service.runtimeContractEpoch ||
        base.serviceContractVersion !== facts.service.serviceContractVersion,
      "The Service runtime or service contract changed, so service.updatePolicy must be required."
    );
    requireRequired(
      "skills",
      base.skillContractVersion !== facts.skills.skillContractVersion,
      "The skills contract changed, so skills.updatePolicy must be required."
    );
  }
  errors.push(...resolveRequiredFloorErrors({ ...input, changed }));
  return errors;
}

function resolveRequiredFloorErrors({ changed, facts, policy, base }) {
  const errors = [];
  const cliFloor = facts.cliRequiredFloor;
  if (cliFloor && !PLAIN_RELEASE_VERSION.test(cliFloor)) {
    errors.push(
      `openmeld.minRequiredCliVersion is not a version: ${cliFloor}.`
    );
  } else if (
    cliFloor &&
    compareSemverCore(cliFloor, facts.cli.packageVersion) > 0
  ) {
    errors.push(
      `openmeld.minRequiredCliVersion (${cliFloor}) must not exceed the CLI version (${facts.cli.packageVersion}).`
    );
  }
  if (
    policy.cli?.updatePolicy === "required" &&
    !(cliFloor && compareSemverCore(cliFloor, facts.cli.packageVersion) >= 0)
  ) {
    errors.push(
      `cli.updatePolicy is required, so ${CLI_PACKAGE_JSON_PATH} must set openmeld.minRequiredCliVersion to ${facts.cli.packageVersion}.`
    );
  }
  if (
    base?.cliRequiredFloor &&
    !(cliFloor && compareSemverCore(cliFloor, base.cliRequiredFloor) >= 0)
  ) {
    errors.push(
      `openmeld.minRequiredCliVersion (${cliFloor ?? "unset"}) must not regress below ${base.cliRequiredFloor}.`
    );
  }
  const serviceFloor = facts.serviceRequiredFloor;
  if (
    base?.serviceRequiredFloor &&
    compareSemverCore(serviceFloor, base.serviceRequiredFloor) < 0
  ) {
    errors.push(
      `MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION (${serviceFloor}) must not regress below ${base.serviceRequiredFloor}.`
    );
  }
  if (
    changed.includes("service") &&
    policy.service?.updatePolicy === "required" &&
    compareSemverCore(serviceFloor, facts.service.bundleVersion) < 0
  ) {
    errors.push(
      `service.updatePolicy is required, so MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION (${serviceFloor}) must be at least ${facts.service.bundleVersion}.`
    );
  }
  return errors;
}

// The manifest Core reads. An unchanged Service or Skills bundle keeps its
// published entry, including the exact Service version the binary channel
// already serves.
export function buildReleaseManifest({
  changed,
  facts,
  policy,
  published,
  now,
}) {
  const decide = (component) => ({
    updatePolicy: policy[component].updatePolicy,
    reason: policy[component].reason.trim(),
  });
  return {
    schemaVersion: LOCAL_COMPONENTS_RELEASE_SCHEMA_VERSION,
    updatedAt: now ?? new Date().toISOString(),
    components: {
      cli: { ...facts.cli, ...decide("cli") },
      service: changed.includes("service")
        ? { ...facts.service, ...decide("service") }
        : published.components.service,
      skills: changed.includes("skills")
        ? { ...facts.skills, ...decide("skills") }
        : published.components.skills,
    },
  };
}

export async function readBaseReleaseFacts({ base, repoRoot }) {
  const show = async (path) => {
    try {
      return (
        await execFileAsync("git", ["show", `${base}:${path}`], {
          cwd: repoRoot,
          maxBuffer: 1024 * 1024 * 4,
        })
      ).stdout;
    } catch {
      return null;
    }
  };
  const [cliSource, transportSource, coreSource, packageSource] =
    await Promise.all([
      show(CLI_LOCAL_COMPONENTS_SOURCE_PATH),
      show(RUNTIME_TRANSPORT_SCHEMA_SOURCE_PATH),
      show(CORE_LOCAL_COMPONENTS_UPDATE_PROJECTION_PATH),
      show(CLI_PACKAGE_JSON_PATH),
    ]);
  if (!(cliSource && transportSource && coreSource && packageSource)) {
    return null;
  }
  const runtimeContractEpoch = parseStringConstant(
    transportSource,
    "CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH"
  );
  return {
    cliRequiredFloor: optionalText(
      JSON.parse(packageSource).openmeld?.minRequiredCliVersion
    ),
    commandContractVersion: parseStringConstant(
      cliSource,
      "OPENMELD_CLI_COMMAND_CONTRACT_VERSION"
    ),
    runtimeContractEpoch,
    serviceContractVersion:
      parseStringConstant(cliSource, "OPENMELD_SERVICE_CONTRACT_VERSION", {
        required: false,
      }) ?? runtimeContractEpoch,
    serviceRequiredFloor: parseStringConstant(
      coreSource,
      "MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION",
      { exported: false }
    ),
    skillContractVersion: parseStringConstant(
      cliSource,
      "OPENMELD_SKILLS_CONTRACT_VERSION"
    ),
  };
}

export async function readLocalComponentsPolicy(repoRoot) {
  const parsed = parseLocalComponentsPolicy(
    JSON.parse(
      await readFile(join(repoRoot, LOCAL_COMPONENTS_POLICY_PATH), "utf8")
    )
  );
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.join("\n"));
  }
  return parsed.policy;
}

export async function computeServiceBundleHash(input) {
  return await computeDirectoryContentHash({
    ignoredNames: new Set(),
    ignoredTopLevelDirs: input.excludeWindows
      ? PORTABLE_SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS
      : SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS,
    mode: "service",
    rootDir: input.rootDir,
    returnNullWhenMissing: true,
  });
}

async function computeDirectoryContentHash(input) {
  if (!(await pathExists(input.rootDir))) {
    if (input.returnNullWhenMissing) {
      return null;
    }
    throw new Error(`Missing directory: ${input.rootDir}`);
  }
  const collected = await collectFiles({
    currentDir: input.rootDir,
    ignoredNames: input.ignoredNames,
    ignoredTopLevelDirs: input.ignoredTopLevelDirs ?? new Set(),
    rootDir: input.rootDir,
  });
  const files =
    input.mode === "service"
      ? collected.toSorted((left, right) =>
          compareCodeUnits(left.relativePath, right.relativePath)
        )
      : collected;
  const hash = createHash("sha256");
  for (const file of files) {
    if (input.mode === "service") {
      hash.update(file.relativePath, "utf8");
      hash.update("\0", "utf8");
      hash.update(await readFile(file.absolutePath));
      hash.update("\0", "utf8");
    } else {
      hash.update(`file:${file.relativePath}\n`);
      hash.update(await readFile(file.absolutePath));
      hash.update("\n");
    }
  }
  return hash.digest("hex");
}

async function collectFiles(input) {
  const entries = await readdir(input.currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (input.ignoredNames.has(entry.name)) {
      continue;
    }
    const absolutePath = join(input.currentDir, entry.name);
    const relativePath = relative(input.rootDir, absolutePath)
      .split("\\")
      .join("/");
    if (input.ignoredTopLevelDirs.has(relativePath.split("/")[0] ?? "")) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(
        ...(await collectFiles({ ...input, currentDir: absolutePath }))
      );
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

function compareCodeUnits(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function parseStringConstant(source, name, options = {}) {
  const prefix = options.exported === false ? "(?:export\\s+)?" : "export\\s+";
  const match = source.match(
    new RegExp(`${prefix}const\\s+${name}\\s*=\\s*["']([^"']+)["']`, "u")
  );
  if (match?.[1]) {
    return match[1];
  }
  if (options.required === false) {
    return null;
  }
  throw new Error(`Could not find string constant ${name}.`);
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireText(value, label) {
  const text = optionalText(value);
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  process.stderr.write(
    `Unknown command ${positionals[0] ?? "(none)"}. Use pnpm run verify:release-ready for pull requests and scripts/release/publish-cli.mjs for publication.\n`
  );
  process.exitCode = 1;
}
