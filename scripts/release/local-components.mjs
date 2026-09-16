#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { buildPackagedOpenMeldCli } from "./build-packaged-openmeld-cli.mjs";
import {
  isCliReleasePath,
  isServiceReleasePath,
  isSkillsReleasePath,
} from "./release-ready-paths.mjs";
import { compareSemverCore } from "./release-semver.mjs";
import {
  formatCliReleaseVersionResolution,
  resolveCliReleaseVersion,
} from "./release-version-selection.mjs";

const execFileAsync = promisify(execFile);

export const LOCAL_COMPONENTS_RELEASE_SCHEMA_VERSION = 1;
export const DEFAULT_RELEASE_MANIFEST_PATH = "release/local-components.json";
export const DEFAULT_RELEASE_BASE_REF = "origin/main";

const CLI_PACKAGE_JSON_PATH = "clients/openmeld-cli/package.json";
const CLI_LOCAL_COMPONENTS_SOURCE_PATH =
  "clients/openmeld-cli/src/local-components/manifest.ts";
const RUNTIME_TRANSPORT_SCHEMA_SOURCE_PATH =
  "packages/schemas/src/schemas/daemon/runtime-transport.ts";
const CORE_LOCAL_COMPONENTS_UPDATE_PROJECTION_PATH =
  "services/core/src/local-components/update-projection.ts";
const CLI_DIST_ROOT_PATH = "clients/openmeld-cli/dist";
// Platform-specific CLI artifacts have their own signed release integrity.
// They are not copied into the npm Service bundle and must not make its
// platform-neutral content hash differ between macOS and Linux.
const SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS = new Set(["binary", "native"]);
const SKILLS_ROOT_PATH = "clients/openmeld-cli/skills";

const POLICY_VALUES = new Set(["ok", "available", "required"]);
const SERVICE_POLICIES = new Set(["ok", "available", "required"]);
const SKILLS_POLICIES = new Set(["ok", "available", "required"]);
const COMPONENTS = ["cli", "service", "skills"];
const RELEASE_DECISION_POLICIES = new Set(["available", "required"]);
const MINIMUM_POLICY_REASON_LENGTH = 20;
const COMPONENT_LABELS = {
  cli: "OpenMeld CLI",
  service: "OpenMeld Service",
  skills: "OpenMeld skills",
};
const LINE_SPLIT_REGEX = /\r?\n/u;
const DEFAULT_RELEASE_BASE_ENV_VAR = "OPENMELD_AFFECTED_BASE";
export const OPENMELD_GREENFIELD_RELEASE_LINE = "openmeld-greenfield-2026-07";
const GIT_REPOSITORY_ENV_NAMES = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
]);
const GIT_REPOSITORY_ENV_PREFIXES = ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

function buildIsolatedGitEnv(env = process.env) {
  const isolatedEnv = { ...env };
  for (const name of GIT_REPOSITORY_ENV_NAMES) {
    delete isolatedEnv[name];
  }
  for (const name of Object.keys(isolatedEnv)) {
    if (GIT_REPOSITORY_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      delete isolatedEnv[name];
    }
  }
  return isolatedEnv;
}

async function execGit(args, options = {}) {
  return await execFileAsync("git", args, {
    cwd: options.repoRoot ?? process.cwd(),
    env: buildIsolatedGitEnv(options.env),
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  });
}

export async function collectLocalComponentFacts(input = {}) {
  const repoRoot = resolve(input.repoRoot ?? process.cwd());
  const [
    packageJson,
    localComponentsSource,
    runtimeTransportSource,
    coreLocalComponentsSource,
  ] = await Promise.all([
    readJson(join(repoRoot, CLI_PACKAGE_JSON_PATH)),
    readFile(join(repoRoot, CLI_LOCAL_COMPONENTS_SOURCE_PATH), "utf8"),
    readFile(join(repoRoot, RUNTIME_TRANSPORT_SCHEMA_SOURCE_PATH), "utf8"),
    readFile(
      join(repoRoot, CORE_LOCAL_COMPONENTS_UPDATE_PROJECTION_PATH),
      "utf8"
    ),
  ]);

  const packageVersion = normalizeNonEmptyString(
    packageJson.version,
    `${CLI_PACKAGE_JSON_PATH}.version`
  );
  const commandContractVersion = parseExportedStringConstant(
    localComponentsSource,
    "OPENMELD_CLI_COMMAND_CONTRACT_VERSION"
  );
  const skillContractVersion = parseExportedStringConstant(
    localComponentsSource,
    "OPENMELD_SKILLS_CONTRACT_VERSION"
  );
  const runtimeContractEpoch = parseExportedStringConstant(
    runtimeTransportSource,
    "CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH"
  );
  const parsedServiceContractVersion = parseExportedStringConstant(
    localComponentsSource,
    "OPENMELD_SERVICE_CONTRACT_VERSION",
    { required: false }
  );
  const serviceContractVersion =
    parsedServiceContractVersion ?? runtimeContractEpoch;

  const serviceBundleHash = await computeServiceBundleHash({
    rootDir: join(repoRoot, CLI_DIST_ROOT_PATH),
  });
  if (input.requireServiceBundle && !serviceBundleHash) {
    throw new Error(
      `OpenMeld CLI dist is missing at ${CLI_DIST_ROOT_PATH}. Run \`pnpm --filter openmeld build\` before stamping or verifying local components.`
    );
  }

  return {
    cli: {
      commandContractVersion,
      packageVersion,
    },
    // The published forced-update floor lives outside `cli` so it is never
    // spread into the strictObject manifest; it is projected into package.json
    // as `openmeld.minRequiredCliVersion` so the CLI can read it from npm `latest`.
    cliRequiredFloor: readPackageMinRequiredCliVersion(packageJson),
    cliReleaseLine: readPackageReleaseLine(packageJson),
    service: {
      bundleHash: serviceBundleHash,
      bundleVersion: packageVersion,
      runtimeContractEpoch,
      serviceContractVersion,
    },
    serviceRequiredFloor: parseDeclaredStringConstant(
      coreLocalComponentsSource,
      "MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION"
    ),
    skills: {
      bundleHash: await computeSkillsBundleHash({
        rootDir: join(repoRoot, SKILLS_ROOT_PATH),
      }),
      skillContractVersion,
      skillIds: ["openmeld-cli"],
    },
  };
}

export function buildReleasePolicyManifest(input) {
  const previous = input.previous ?? null;
  const policies = input.policies ?? {};
  const reasons = input.reasons ?? {};
  const reason = normalizeOptionalString(input.reason);
  const now = input.now ?? new Date().toISOString();
  const cliPolicy = resolveComponentPolicy({
    component: "cli",
    fallback: previous?.components.cli.updatePolicy ?? "ok",
    policies,
  });
  const servicePolicy = resolveComponentPolicy({
    component: "service",
    fallback: previous?.components.service.updatePolicy ?? "required",
    policies,
  });
  const skillsPolicy = resolveComponentPolicy({
    component: "skills",
    fallback: previous?.components.skills.updatePolicy ?? "required",
    policies,
  });

  return {
    schemaVersion: LOCAL_COMPONENTS_RELEASE_SCHEMA_VERSION,
    updatedAt: now,
    components: {
      cli: {
        ...input.facts.cli,
        updatePolicy: cliPolicy,
        reason: resolvePolicyReason({
          component: "cli",
          policy: cliPolicy,
          previous: previous?.components.cli,
          reason: normalizeOptionalString(reasons.cli) ?? reason,
          touched: Object.hasOwn(policies, "cli"),
        }),
      },
      service: {
        ...input.facts.service,
        updatePolicy: servicePolicy,
        reason: resolvePolicyReason({
          component: "service",
          policy: servicePolicy,
          previous: previous?.components.service,
          reason: normalizeOptionalString(reasons.service) ?? reason,
          touched: Object.hasOwn(policies, "service"),
        }),
      },
      skills: {
        ...input.facts.skills,
        updatePolicy: skillsPolicy,
        reason: resolvePolicyReason({
          component: "skills",
          policy: skillsPolicy,
          previous: previous?.components.skills,
          reason: normalizeOptionalString(reasons.skills) ?? reason,
          touched: Object.hasOwn(policies, "skills"),
        }),
      },
    },
  };
}

export function resolveReleasePolicyVerificationErrors(input) {
  const errors = [];
  const manifest = input.manifest;
  const facts = input.facts;
  if (
    !manifest ||
    manifest.schemaVersion !== LOCAL_COMPONENTS_RELEASE_SCHEMA_VERSION
  ) {
    return [
      "release/local-components.json is missing or uses an unsupported schema version.",
    ];
  }

  errors.push(
    ...compareCurrentFacts({
      actual: manifest.components.cli.packageVersion,
      expected: facts.cli.packageVersion,
      label: "cli.packageVersion",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.cli.commandContractVersion,
      expected: facts.cli.commandContractVersion,
      label: "cli.commandContractVersion",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.service.bundleVersion,
      expected: facts.service.bundleVersion,
      label: "service.bundleVersion",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.service.bundleHash,
      expected: facts.service.bundleHash,
      label: "service.bundleHash",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.service.runtimeContractEpoch,
      expected: facts.service.runtimeContractEpoch,
      label: "service.runtimeContractEpoch",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.service.serviceContractVersion,
      expected: facts.service.serviceContractVersion,
      label: "service.serviceContractVersion",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.skills.bundleHash,
      expected: facts.skills.bundleHash,
      label: "skills.bundleHash",
    }),
    ...compareCurrentFacts({
      actual: manifest.components.skills.skillContractVersion,
      expected: facts.skills.skillContractVersion,
      label: "skills.skillContractVersion",
    })
  );

  errors.push(...validateReleasePolicies(manifest));

  const changedPaths = input.changedPaths ?? [];
  if (
    changedPaths.some(isCliReleasePath) &&
    !isUpdatePolicyAtLeastAvailable(manifest.components.cli.updatePolicy)
  ) {
    errors.push(
      "OpenMeld CLI package files changed, so cli.updatePolicy must be available or required."
    );
  }
  if (
    changedPaths.some(isSkillsReleasePath) &&
    !isUpdatePolicyAtLeastAvailable(manifest.components.skills.updatePolicy)
  ) {
    errors.push(
      "OpenMeld skills changed, so skills.updatePolicy must be available or required."
    );
  }
  if (
    changedPaths.some(isServiceReleasePath) &&
    !isUpdatePolicyAtLeastAvailable(manifest.components.service.updatePolicy)
  ) {
    errors.push(
      "OpenMeld Service carrier files changed, so service.updatePolicy must be available or required."
    );
  }
  if (
    input.baseCommandContractVersion &&
    input.baseCommandContractVersion !== facts.cli.commandContractVersion &&
    manifest.components.cli.updatePolicy !== "required"
  ) {
    errors.push(
      "OpenMeld CLI command contract changed, so cli.updatePolicy must be required."
    );
  }
  if (
    input.baseRuntimeContractEpoch &&
    input.baseRuntimeContractEpoch !== facts.service.runtimeContractEpoch &&
    manifest.components.service.updatePolicy !== "required"
  ) {
    errors.push(
      "OpenMeld Service runtime contract changed, so service.updatePolicy must be required."
    );
  }
  if (
    input.baseServiceContractVersion &&
    input.baseServiceContractVersion !== facts.service.serviceContractVersion &&
    manifest.components.service.updatePolicy !== "required"
  ) {
    errors.push(
      "OpenMeld Service contract changed, so service.updatePolicy must be required."
    );
  }
  if (
    input.baseServiceBundleHash &&
    input.baseServiceBundleVersion &&
    manifest.components.service.bundleHash !== input.baseServiceBundleHash &&
    manifest.components.service.bundleVersion === input.baseServiceBundleVersion
  ) {
    errors.push(
      "OpenMeld Service bundleHash changed without a service.bundleVersion bump."
    );
  }
  if (
    input.baseSkillContractVersion &&
    input.baseSkillContractVersion !== facts.skills.skillContractVersion &&
    manifest.components.skills.updatePolicy !== "required"
  ) {
    errors.push(
      "OpenMeld skills contract changed, so skills.updatePolicy must be required."
    );
  }
  errors.push(
    ...resolveServiceRequiredFloorVerificationErrors({
      baseFloor: input.baseServiceRequiredFloor,
      bundleVersion: facts.service.bundleVersion,
      floor: facts.serviceRequiredFloor,
      updatePolicy: manifest.components.service.updatePolicy,
    })
  );
  return errors;
}

function isUpdatePolicyAtLeastAvailable(policy) {
  return policy === "available" || policy === "required";
}

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
  return COMPONENTS.filter((component) => touched.has(component));
}

export function resolveExplicitLocalComponentPolicyDecisionErrors(input = {}) {
  const errors = [];
  const policies = input.policies ?? {};
  const reasons = input.reasons ?? {};
  for (const component of resolveTouchedLocalComponents(input.changedPaths)) {
    const label = COMPONENT_LABELS[component];
    const policy = policies[component];
    const reason = normalizeOptionalString(reasons[component]);
    if (!RELEASE_DECISION_POLICIES.has(policy)) {
      errors.push(
        `${label} changed, so choose --${component} available or --${component} required.`
      );
    }
    if (!reason || reason.length < MINIMUM_POLICY_REASON_LENGTH) {
      errors.push(
        `${label} changed, so add --${component}-reason with a concrete compatibility reason.`
      );
    }
  }
  return errors;
}

export function resolveServiceRequiredFloorVerificationErrors(input = {}) {
  const floor = normalizeOptionalString(input.floor);
  const baseFloor = normalizeOptionalString(input.baseFloor);
  const bundleVersion = normalizeOptionalString(input.bundleVersion);
  const errors = [];
  if (baseFloor && (!floor || compareSemverCore(floor, baseFloor) < 0)) {
    errors.push(
      `MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION (${floor ?? "unset"}) must not regress below the base floor (${baseFloor}).`
    );
    return errors;
  }
  if (
    input.updatePolicy === "required" &&
    bundleVersion &&
    (!floor || compareSemverCore(floor, bundleVersion) < 0)
  ) {
    errors.push(
      `service.updatePolicy is required, so MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION (${floor ?? "unset"}) must be at least the released service.bundleVersion (${bundleVersion}).`
    );
  }
  return errors;
}

function validateReleasePolicies(manifest) {
  const errors = [];
  for (const component of COMPONENTS) {
    const policy = manifest.components[component].updatePolicy;
    if (!POLICY_VALUES.has(policy)) {
      errors.push(`${component}.updatePolicy is invalid: ${String(policy)}`);
      continue;
    }
    if (component === "service" && !SERVICE_POLICIES.has(policy)) {
      errors.push("service.updatePolicy must be ok, available, or required.");
    }
    if (component === "skills" && !SKILLS_POLICIES.has(policy)) {
      errors.push("skills.updatePolicy must be ok, available, or required.");
    }
    if (!normalizeOptionalString(manifest.components[component].reason)) {
      errors.push(`${component}.reason is required.`);
    }
  }
  return errors;
}

export async function runLocalComponentsReleaseTool(
  argv = process.argv.slice(2),
  dependencies = {}
) {
  const parsed = parseArgs(argv);
  const repoRoot = resolve(parsed.options.repoRoot ?? process.cwd());
  const manifestPath = resolve(
    repoRoot,
    parsed.options.manifest ?? DEFAULT_RELEASE_MANIFEST_PATH
  );

  if (parsed.command === "require") {
    if (parsed.positionals.length === 0) {
      throw new Error(
        "Usage: pnpm release:local-components require <cli|service|skills> --reason <text>"
      );
    }
    if (!parsed.options.reason) {
      throw new Error(
        "A --reason value is required when marking a component required."
      );
    }
    const policies = { ...parsed.options.policies };
    for (const component of parsed.positionals) {
      if (!COMPONENTS.includes(component)) {
        throw new Error(`Unknown local component: ${component}`);
      }
      policies[component] = "required";
    }
    parsed.options.policies = policies;
    parsed.command = "stamp";
  }

  switch (parsed.command) {
    case "status": {
      const facts = await collectLocalComponentFacts({ repoRoot });
      const manifest = await readReleaseManifest(manifestPath);
      const payload = buildStatusPayload({
        facts,
        manifest,
        manifestPath,
        repoRoot,
      });
      writeOutput(payload, parsed.options.json, formatStatus);
      return;
    }
    case "plan": {
      await runLocalComponentReleaseDecisionPlan({
        dependencies,
        parsed,
        repoRoot,
      });
      return;
    }
    case "stamp": {
      assertStampUsesReleaseBase(parsed);
      const decisionPlan = await collectLocalComponentReleaseDecisionPlan({
        dependencies,
        parsed,
        repoRoot,
      });
      if (decisionPlan.decisionErrors.length > 0) {
        throw new Error(formatLocalComponentDecisionFailure(decisionPlan));
      }
      const stampedAt = parsed.options.now ?? new Date().toISOString();
      const versionWrite = await prepareStampCliVersion({
        dependencies,
        parsed,
        resolution: decisionPlan.versionResolution,
        previous: await readReleaseManifest(manifestPath),
        stampedAt,
        repoRoot,
      });
      let stampResult;
      try {
        await buildStablePackagedOpenMeldCli({
          build:
            dependencies.buildPackagedOpenMeldCli ?? buildPackagedOpenMeldCli,
          repoRoot,
        });
        const facts = await collectLocalComponentFacts({
          repoRoot,
          requireServiceBundle: !parsed.options.allowMissingServiceBundle,
        });
        const previous = await readReleaseManifest(manifestPath);
        const manifest = buildReleasePolicyManifest({
          facts,
          now: stampedAt,
          policies: parsed.options.policies,
          previous,
          reason: parsed.options.reason,
          reasons: parsed.options.reasons,
        });
        await assertReleaseManifestPolicy({
          facts,
          manifest,
          parsed,
          repoRoot,
        });
        await writeAndVerifyStampedManifest({
          manifest,
          manifestPath,
          parsed,
          repoRoot,
        });
        stampResult = { manifest, stampFloor: versionWrite.floor };
      } catch (error) {
        await rollbackStampCliVersion(versionWrite);
        throw error;
      }
      writeOutput(
        {
          cliRequiredFloor: stampResult.stampFloor,
          manifest: stampResult.manifest,
          manifestPath: relative(repoRoot, manifestPath),
          versionResolution: versionWrite.resolution,
        },
        parsed.options.json,
        ({ manifest: writtenManifest, versionResolution }) =>
          `${formatLocalComponentDecisionPlan(decisionPlan)}\n\n${formatVersionResolutionPrefix(versionResolution)}Stamped and verified ${relative(repoRoot, manifestPath)}\n${formatPolicySummary(writtenManifest)}${formatFloorProjectionSuffix(stampResult.stampFloor)}`
      );
      return;
    }
    case "verify": {
      await runVerifyReleaseCommand({ manifestPath, parsed, repoRoot });
      return;
    }
    case "verify-current": {
      parsed.options.currentOnly = true;
      await runVerifyReleaseCommand({ manifestPath, parsed, repoRoot });
      return;
    }
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

async function runLocalComponentReleaseDecisionPlan(input) {
  const plan = await collectLocalComponentReleaseDecisionPlan(input);
  writeOutput(
    plan,
    input.parsed.options.json,
    formatLocalComponentDecisionPlan
  );
  if (plan.decisionErrors.length > 0) {
    process.exitCode = 1;
  }
}

async function collectLocalComponentReleaseDecisionPlan(input) {
  const facts = await collectLocalComponentFacts({ repoRoot: input.repoRoot });
  const latestReleaseTag = await resolveLatestReleaseTag({
    repoRoot: input.repoRoot,
  });
  const base = resolveEffectiveReleaseBase({
    base: input.parsed.options.base,
    currentReleaseLine: facts.cliReleaseLine,
    currentOnly: input.parsed.options.currentOnly,
    env: process.env,
    latestReleaseTag,
  });
  const [changedPaths, baseContracts, versionResolution] = await Promise.all([
    base
      ? resolveChangedPaths({ base, repoRoot: input.repoRoot })
      : Promise.resolve([]),
    base
      ? readBaseReleaseContracts({ base, repoRoot: input.repoRoot })
      : Promise.resolve({}),
    resolveCliReleaseVersion({
      cwd: input.repoRoot,
      explicitVersion: input.parsed.options.version,
      next: input.parsed.options.next,
      readChannels: input.dependencies.readCliReleaseChannels,
    }),
  ]);
  const touchedComponents = resolveTouchedLocalComponents(changedPaths);
  const decisionErrors = resolveExplicitLocalComponentPolicyDecisionErrors({
    changedPaths,
    policies: input.parsed.options.policies,
    reasons: input.parsed.options.reasons,
  });
  return {
    base,
    changedPaths,
    currentPublic: {
      cliVersion:
        versionResolution?.npmVersion ??
        baseContracts.baseLocalComponentsManifest?.components?.cli
          ?.packageVersion ??
        null,
      cliRequiredFloor: baseContracts.baseCliRequiredFloor ?? null,
      r2Version: versionResolution?.r2Version ?? null,
      serviceRequiredFloor: baseContracts.baseServiceRequiredFloor ?? null,
      serviceVersion:
        baseContracts.baseLocalComponentsManifest?.components?.service
          ?.bundleVersion ?? null,
    },
    decisionErrors,
    decisions: Object.fromEntries(
      touchedComponents.map((component) => [
        component,
        {
          compatibility: resolveDeclaredCompatibility(
            input.parsed.options.policies[component]
          ),
          policy: input.parsed.options.policies[component] ?? null,
          reason:
            normalizeOptionalString(input.parsed.options.reasons[component]) ??
            null,
        },
      ])
    ),
    targetVersion: versionResolution?.targetVersion ?? facts.cli.packageVersion,
    touchedComponents,
    versionResolution,
  };
}

function resolveDeclaredCompatibility(policy) {
  if (policy === "available") {
    return {
      newCloudToOldLocal: "declared compatible",
      oldCloudToNewLocal: "declared compatible",
    };
  }
  if (policy === "required") {
    return {
      newCloudToOldLocal: "declared unsafe for new Wake below the floor",
      oldCloudToNewLocal:
        "must remain compatible for update, self-rescue, and accepted work",
    };
  }
  return {
    newCloudToOldLocal: "not declared",
    oldCloudToNewLocal: "not declared",
  };
}

function formatLocalComponentDecisionPlan(plan) {
  const touched =
    plan.touchedComponents.length > 0
      ? plan.touchedComponents
          .map((component) => COMPONENT_LABELS[component])
          .join(", ")
      : "none";
  const lines = [
    "Local component release facts",
    `Baseline: ${plan.base ?? "no published local-component baseline"}`,
    `Current public CLI: ${plan.currentPublic.cliVersion ?? "unknown"}`,
    `Current R2 stable CLI: ${plan.currentPublic.r2Version ?? "not queried"}`,
    `Current CLI required floor: ${plan.currentPublic.cliRequiredFloor ?? "none"}`,
    `Current public Service: ${plan.currentPublic.serviceVersion ?? "unknown"}`,
    `Current Service required floor: ${plan.currentPublic.serviceRequiredFloor ?? "none"}`,
    `Target CLI/Service version: ${plan.targetVersion}`,
    `Changed local components: ${touched}`,
  ];
  for (const component of plan.touchedComponents) {
    const decision = plan.decisions[component];
    lines.push(
      "",
      `${COMPONENT_LABELS[component]} decision: ${decision.policy ?? "not selected"}`,
      `  reason: ${decision.reason ?? "not provided"}`,
      `  old cloud -> new local: ${decision.compatibility.oldCloudToNewLocal}`,
      `  new cloud -> old local: ${decision.compatibility.newCloudToOldLocal}`
    );
  }
  if (plan.decisionErrors.length > 0) {
    lines.push(
      "",
      "Missing explicit release facts:",
      ...plan.decisionErrors.map((error) => `- ${error}`)
    );
  }
  return lines.join("\n");
}

function formatLocalComponentDecisionFailure(plan) {
  const versionFlag =
    plan.versionResolution?.source === "explicit"
      ? `--version ${plan.targetVersion}`
      : "--next";
  const decisionFlags = plan.touchedComponents
    .map(
      (component) =>
        `--${component} <available|required> --${component}-reason "<specific compatibility reason>"`
    )
    .join(" ");
  return [
    formatLocalComponentDecisionPlan(plan),
    "",
    "Choose the policy from the Contract Impact Audit; the tool will not guess it.",
    "Then rerun this exact command shape:",
    `pnpm release:local-components stamp ${versionFlag} ${decisionFlags}`.trim(),
  ].join("\n");
}

async function prepareStampCliVersion(input) {
  const resolution =
    input.resolution ??
    (await resolveCliReleaseVersion({
      cwd: input.repoRoot,
      explicitVersion: input.parsed.options.version,
      next: input.parsed.options.next,
      readChannels: input.dependencies.readCliReleaseChannels,
    }));
  const packageJsonPath = join(input.repoRoot, CLI_PACKAGE_JSON_PATH);
  const original = await readOptionalFile(packageJsonPath);
  if (original === null) {
    throw new Error(`${CLI_PACKAGE_JSON_PATH} is missing.`);
  }
  const packageJson = JSON.parse(original);
  const nextPackageJson = {
    ...packageJson,
    ...(resolution
      ? {
          version: resolution.targetVersion,
          openMeldReleaseDate: resolveReleaseDate(input.stampedAt),
        }
      : {}),
  };
  const floor = projectCliRequiredFloor({
    packageJson: nextPackageJson,
    updatePolicy: resolveComponentPolicy({
      component: "cli",
      fallback: input.previous?.components.cli.updatePolicy ?? "ok",
      policies: input.parsed.options.policies,
    }),
  });
  const written =
    resolution || floor.changed
      ? `${stringifyRepoJson(floor.packageJson)}\n`
      : original;
  if (written !== original) {
    await writeFile(packageJsonPath, written, "utf8");
  }
  return {
    original,
    packageJsonPath,
    resolution,
    written,
    floor: floor.projection,
  };
}

function resolveReleaseDate(timestamp) {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid release timestamp: ${String(timestamp)}`);
  }
  return instant.toISOString().slice(0, 10);
}

async function rollbackStampCliVersion(versionWrite) {
  if (versionWrite.written === versionWrite.original) {
    return;
  }
  await restoreFileIfUnchanged({
    currentExpected: versionWrite.written,
    original: versionWrite.original,
    path: versionWrite.packageJsonPath,
  });
}

function assertStampUsesReleaseBase(parsed) {
  if (parsed.options.currentOnly) {
    throw new Error(
      "--current is only available for verification. Stamp commands must keep base-aware release policy checks enabled."
    );
  }
}

async function buildStablePackagedOpenMeldCli(input) {
  const sourceBeforeBuild = await captureReleaseSourceSnapshot(input.repoRoot);
  await input.build({ repoRoot: input.repoRoot });
  const sourceAfterBuild = await captureReleaseSourceSnapshot(input.repoRoot);
  if (sourceAfterBuild !== sourceBeforeBuild) {
    throw new Error(
      "Release source changed while rebuilding the packaged OpenMeld CLI. Keep the worktree stable, then run the stamp command again."
    );
  }
}

async function captureReleaseSourceSnapshot(repoRoot) {
  const [head, trackedDiff, untracked] = await Promise.all([
    execGit(["rev-parse", "HEAD"], { repoRoot }),
    execGit(["diff", "--binary", "HEAD"], {
      maxBuffer: 1024 * 1024 * 50,
      repoRoot,
    }),
    execGit(["ls-files", "--others", "--exclude-standard", "-z"], {
      maxBuffer: 1024 * 1024 * 10,
      repoRoot,
    }),
  ]);
  const hash = createHash("sha256");
  hash.update(head.stdout);
  hash.update("\0", "utf8");
  hash.update(trackedDiff.stdout);
  hash.update("\0", "utf8");
  const untrackedPaths = String(untracked.stdout)
    .split("\0")
    .filter(Boolean)
    .toSorted(compareCodeUnitText);
  for (const path of untrackedPaths) {
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(await readFile(join(repoRoot, path)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function writeAndVerifyStampedManifest(input) {
  const originalManifest = await readOptionalFile(input.manifestPath);
  const writtenManifest = `${stringifyRepoJson(input.manifest)}\n`;
  try {
    await writeJsonFile(input.manifestPath, input.manifest);
    const sourceBeforeVerification = await captureReleaseSourceSnapshot(
      input.repoRoot
    );
    const verification = await collectReleaseManifestVerification({
      manifestPath: input.manifestPath,
      parsed: input.parsed,
      repoRoot: input.repoRoot,
    });
    const sourceAfterVerification = await captureReleaseSourceSnapshot(
      input.repoRoot
    );
    if (sourceAfterVerification !== sourceBeforeVerification) {
      throw new Error(
        "Release source changed while verifying the stamped local components manifest. Keep the worktree stable, then run the stamp command again."
      );
    }
    if (verification.errors.length > 0) {
      throw new Error(formatVerifyFailure(verification));
    }
  } catch (error) {
    await restoreFileIfUnchanged({
      currentExpected: writtenManifest,
      original: originalManifest,
      path: input.manifestPath,
    });
    throw error;
  }
}

async function readOptionalFile(path) {
  return await readFile(path, "utf8").catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
}

async function restoreFileIfUnchanged(input) {
  if (input.currentExpected === null) {
    return;
  }
  const current = await readOptionalFile(input.path);
  if (current !== input.currentExpected) {
    return;
  }
  if (input.original === null) {
    await rm(input.path, { force: true });
    return;
  }
  await writeFile(input.path, input.original, "utf8");
}

async function collectReleaseManifestVerification(input) {
  const manifest = await readReleaseManifest(input.manifestPath);
  const facts = await collectLocalComponentFacts({
    repoRoot: input.repoRoot,
    requireServiceBundle: !input.parsed.options.allowMissingServiceBundle,
  });
  const base = resolveEffectiveReleaseBase({
    base: input.parsed.options.base,
    currentReleaseLine: facts.cliReleaseLine,
    currentOnly: input.parsed.options.currentOnly,
    env: process.env,
    latestReleaseTag: await resolveLatestReleaseTag({
      repoRoot: input.repoRoot,
    }),
  });
  const changedPaths = base
    ? await resolveChangedPaths({
        repoRoot: input.repoRoot,
        base,
      })
    : [];
  const baseContracts = base
    ? await readBaseReleaseContracts({
        repoRoot: input.repoRoot,
        base,
      })
    : {};
  const errors = resolveReleasePolicyVerificationErrors({
    ...baseContracts,
    changedPaths,
    facts,
    manifest,
  });
  if (manifest) {
    errors.push(
      ...resolveCliRequiredFloorVerificationErrors({
        baseAware: Boolean(base),
        baseFloor: baseContracts.baseCliRequiredFloor ?? null,
        baseReleaseLine: baseContracts.baseCliReleaseLine ?? null,
        facts,
        manifest,
      })
    );
  }
  const payload = {
    base,
    changedPaths,
    errors,
    manifestPath: relative(input.repoRoot, input.manifestPath),
    ok: errors.length === 0,
  };
  return payload;
}

async function runVerifyReleaseCommand(input) {
  const payload = await collectReleaseManifestVerification(input);
  const { errors } = payload;
  if (errors.length > 0) {
    writeOutput(payload, input.parsed.options.json, formatVerifyFailure);
    process.exitCode = 1;
    return;
  }
  writeOutput(
    payload,
    input.parsed.options.json,
    () => "Local components release manifest is valid."
  );
}

async function assertReleaseManifestPolicy(input) {
  const base = resolveEffectiveReleaseBase({
    base: input.parsed.options.base,
    currentReleaseLine: input.facts.cliReleaseLine,
    currentOnly: input.parsed.options.currentOnly,
    env: process.env,
    latestReleaseTag: await resolveLatestReleaseTag({
      repoRoot: input.repoRoot,
    }),
  });
  if (!base) {
    return;
  }
  const [changedPaths, baseContracts] = await Promise.all([
    resolveChangedPaths({
      repoRoot: input.repoRoot,
      base,
    }),
    readBaseReleaseContracts({
      repoRoot: input.repoRoot,
      base,
    }),
  ]);
  const errors = resolveReleasePolicyVerificationErrors({
    ...baseContracts,
    changedPaths,
    facts: input.facts,
    manifest: input.manifest,
  });
  if (errors.length > 0) {
    throw new Error(formatReleasePolicyGuardFailure({ base, errors }));
  }
}

export function resolveEffectiveReleaseBase(input = {}) {
  if (input.currentOnly) {
    return null;
  }
  const explicitBase = normalizeOptionalString(input.base);
  if (explicitBase) {
    return explicitBase;
  }
  const envBase = normalizeOptionalString(
    input.env?.[DEFAULT_RELEASE_BASE_ENV_VAR]
  );
  const latestReleaseTag = normalizeOptionalString(input.latestReleaseTag);
  const currentReleaseLine = normalizeOptionalString(input.currentReleaseLine);
  if (envBase) {
    if (
      currentReleaseLine === OPENMELD_GREENFIELD_RELEASE_LINE &&
      !latestReleaseTag
    ) {
      return null;
    }
    return envBase;
  }
  // Prefer the most recent local release tag over origin/main: the tag marks
  // the last actually-published state, while origin/main can lag arbitrarily
  // far behind a solo workflow that batches pushes. Falling back to
  // origin/main covers repos from before release tagging existed.
  if (latestReleaseTag) {
    return latestReleaseTag;
  }
  // OpenMeld keeps ATS Git history but intentionally resets product assets.
  // Before the first OpenMeld release tag exists, origin/main is only another
  // pre-release snapshot, not a published local-components baseline.
  if (currentReleaseLine === OPENMELD_GREENFIELD_RELEASE_LINE) {
    return null;
  }
  return DEFAULT_RELEASE_BASE_REF;
}

/**
 * Resolves the most recent OpenMeld `v*` release tag reachable from HEAD, or
 * null when none exists (pre-tagging history, shallow clones). OpenMeld was
 * split from ATS with Git history intact, so inherited ATS tags are deliberately
 * ignored until a tag points at a package.json that declares the OpenMeld
 * greenfield release line.
 */
export async function resolveLatestReleaseTag(input = {}) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const tags = await listReachableVersionTags({ repoRoot });
  for (const tag of tags) {
    const packageJson = await readBaseCliPackageJson({ repoRoot, base: tag });
    if (
      readPackageReleaseLine(packageJson) === OPENMELD_GREENFIELD_RELEASE_LINE
    ) {
      return tag;
    }
  }
  return null;
}

async function listReachableVersionTags(input = {}) {
  try {
    const result = await execGit(
      [
        "tag",
        "--merged",
        "HEAD",
        "--sort=-version:refname",
        "--list",
        "v[0-9]*",
      ],
      {
        repoRoot: input.repoRoot,
      }
    );
    return splitLines(result.stdout);
  } catch {
    return [];
  }
}

async function readBaseReleaseContracts(input) {
  const [
    baseCommandContractVersion,
    baseRuntimeContractEpoch,
    baseSkillContractVersion,
    baseCliRequiredFloor,
    baseServiceRequiredFloor,
    baseCliReleaseLine,
    baseLocalComponentsManifest,
  ] = await Promise.all([
    readBaseCommandContractVersion(input),
    readBaseRuntimeContractEpoch(input),
    readBaseSkillContractVersion(input),
    readBaseCliRequiredFloor(input),
    readBaseServiceRequiredFloor(input),
    readBaseCliReleaseLine(input),
    readBaseLocalComponentsReleaseManifest(input),
  ]);
  return {
    baseCliRequiredFloor,
    baseCliReleaseLine,
    baseCommandContractVersion,
    baseRuntimeContractEpoch,
    baseServiceRequiredFloor,
    baseServiceBundleHash:
      baseLocalComponentsManifest?.components?.service?.bundleHash ?? null,
    baseServiceBundleVersion:
      baseLocalComponentsManifest?.components?.service?.bundleVersion ?? null,
    baseLocalComponentsManifest,
    baseServiceContractVersion: await readBaseServiceContractVersion({
      ...input,
      baseRuntimeContractEpoch,
    }),
    baseSkillContractVersion,
  };
}

async function readBaseServiceRequiredFloor(input) {
  const basePath = `${input.base}:${CORE_LOCAL_COMPONENTS_UPDATE_PROJECTION_PATH}`;
  try {
    const result = await execGit(["show", basePath], {
      maxBuffer: 1024 * 1024,
      repoRoot: input.repoRoot,
    });
    return parseDeclaredStringConstant(
      result.stdout,
      "MINIMUM_SUPPORTED_OPENMELD_SERVICE_VERSION"
    );
  } catch {
    return null;
  }
}

async function readBaseLocalComponentsReleaseManifest(input) {
  const basePath = `${input.base}:${DEFAULT_RELEASE_MANIFEST_PATH}`;
  try {
    const result = await execGit(["show", basePath], {
      maxBuffer: 1024 * 1024,
      repoRoot: input.repoRoot,
    });
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function readBaseCliRequiredFloor(input) {
  const packageJson = await readBaseCliPackageJson(input);
  return packageJson ? readPackageMinRequiredCliVersion(packageJson) : null;
}

async function readBaseCliReleaseLine(input) {
  const packageJson = await readBaseCliPackageJson(input);
  return packageJson ? readPackageReleaseLine(packageJson) : null;
}

async function readBaseCliPackageJson(input) {
  const basePath = `${input.base}:${CLI_PACKAGE_JSON_PATH}`;
  try {
    const result = await execGit(["show", basePath], {
      maxBuffer: 1024 * 1024,
      repoRoot: input.repoRoot,
    });
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = [...argv];
  const command =
    args[0] && !args[0].startsWith("--") ? args.shift() : "status";
  const options = {
    allowMissingServiceBundle: false,
    base: null,
    currentOnly: false,
    json: false,
    manifest: DEFAULT_RELEASE_MANIFEST_PATH,
    next: false,
    now: undefined,
    policies: {},
    reason: null,
    reasons: {},
    repoRoot: process.cwd(),
    version: null,
  };
  const positionals = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    switch (arg) {
      case "--json":
        options.json = true;
        break;
      case "--next":
        options.next = true;
        break;
      case "--version":
        index += 1;
        options.version = readRequiredOption(args, index, arg);
        break;
      case "--allow-missing-service-bundle":
        options.allowMissingServiceBundle = true;
        break;
      case "--repo-root":
        index += 1;
        options.repoRoot = readRequiredOption(args, index, arg);
        break;
      case "--manifest":
        index += 1;
        options.manifest = readRequiredOption(args, index, arg);
        break;
      case "--base":
        index += 1;
        options.base = readRequiredOption(args, index, arg);
        break;
      case "--current":
      case "--no-base":
        options.currentOnly = true;
        break;
      case "--reason":
        index += 1;
        options.reason = readRequiredOption(args, index, arg);
        break;
      case "--now":
        index += 1;
        options.now = readRequiredOption(args, index, arg);
        break;
      case "--cli":
        index += 1;
        options.policies.cli = normalizePolicy(
          "cli",
          readRequiredOption(args, index, arg)
        );
        break;
      case "--cli-reason":
        index += 1;
        options.reasons.cli = readRequiredOption(args, index, arg);
        break;
      case "--service":
        index += 1;
        options.policies.service = normalizePolicy(
          "service",
          readRequiredOption(args, index, arg)
        );
        break;
      case "--service-reason":
        index += 1;
        options.reasons.service = readRequiredOption(args, index, arg);
        break;
      case "--skills":
        index += 1;
        options.policies.skills = normalizePolicy(
          "skills",
          readRequiredOption(args, index, arg)
        );
        break;
      case "--skills-reason":
        index += 1;
        options.reasons.skills = readRequiredOption(args, index, arg);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
    index += 1;
  }
  if (options.next && options.version) {
    throw new Error(
      "--next and --version are mutually exclusive. Choose one release version mode."
    );
  }
  if (
    !["plan", "stamp"].includes(command) &&
    (options.next || options.version)
  ) {
    throw new Error(
      "--next and --version are only available for plan or stamp."
    );
  }
  return { command, options, positionals };
}

function readRequiredOption(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function resolveComponentPolicy(input) {
  const value = input.policies[input.component] ?? input.fallback;
  return normalizePolicy(input.component, value);
}

function normalizePolicy(component, value) {
  const normalized = String(value ?? "").trim();
  if (!POLICY_VALUES.has(normalized)) {
    throw new Error(
      `${component} update policy must be one of: ${[...POLICY_VALUES].join(", ")}`
    );
  }
  if (component === "service" && !SERVICE_POLICIES.has(normalized)) {
    throw new Error(
      "Service update policy must be ok, available, or required."
    );
  }
  if (component === "skills" && !SKILLS_POLICIES.has(normalized)) {
    throw new Error("Skills update policy must be ok, available, or required.");
  }
  return normalized;
}

function resolvePolicyReason(input) {
  const previousReason =
    input.previous?.updatePolicy === input.policy
      ? normalizeOptionalString(input.previous.reason)
      : null;
  if (!input.touched && previousReason) {
    return previousReason;
  }
  return input.reason ?? previousReason ?? defaultPolicyReason(input.policy);
}

function defaultPolicyReason(policy) {
  switch (policy) {
    case "required":
      return "Current hard-cut local component policy.";
    case "available":
      return "A newer local component is available, but current Wake work can continue.";
    case "ok":
      return "No local component update is required.";
    default: {
      throw new Error(
        `Unknown local component update policy: ${String(policy)}`
      );
    }
  }
}

function buildStatusPayload(input) {
  return {
    facts: input.facts,
    manifest: input.manifest,
    manifestPath: relative(input.repoRoot, input.manifestPath),
    manifestState: input.manifest ? "present" : "missing",
  };
}

function formatStatus(payload) {
  const manifest = payload.manifest;
  const lines = [
    "Local components release status",
    `Manifest: ${payload.manifestPath} (${payload.manifestState})`,
    "Artifact note: the Service hash reflects the existing CLI dist; stamp and release-ready rebuild before writing or validating release truth.",
    "",
    `CLI: v${payload.facts.cli.packageVersion}`,
    `  command contract: ${payload.facts.cli.commandContractVersion}`,
    `  required floor: ${payload.facts.cliRequiredFloor ?? "none"}`,
    `  policy: ${manifest?.components.cli.updatePolicy ?? "not stamped"}`,
    `  reason: ${manifest?.components.cli.reason ?? "not stamped"}`,
    "",
    `OpenMeld Service: v${payload.facts.service.bundleVersion}`,
    `  runtime epoch: ${payload.facts.service.runtimeContractEpoch}`,
    `  service contract: ${payload.facts.service.serviceContractVersion}`,
    `  required floor: ${payload.facts.serviceRequiredFloor}`,
    `  bundle hash: ${formatHash(payload.facts.service.bundleHash)}`,
    `  policy: ${manifest?.components.service.updatePolicy ?? "not stamped"}`,
    `  reason: ${manifest?.components.service.reason ?? "not stamped"}`,
    "",
    "OpenMeld skills",
    `  skill contract: ${payload.facts.skills.skillContractVersion}`,
    `  bundle hash: ${formatHash(payload.facts.skills.bundleHash)}`,
    `  policy: ${manifest?.components.skills.updatePolicy ?? "not stamped"}`,
    `  reason: ${manifest?.components.skills.reason ?? "not stamped"}`,
  ];
  return lines.join("\n");
}

function formatPolicySummary(manifest) {
  return [
    `CLI: ${manifest.components.cli.updatePolicy} — ${manifest.components.cli.reason}`,
    `OpenMeld Service: ${manifest.components.service.updatePolicy} — ${manifest.components.service.reason}`,
    `OpenMeld skills: ${manifest.components.skills.updatePolicy} — ${manifest.components.skills.reason}`,
  ].join("\n");
}

function formatVersionResolutionPrefix(resolution) {
  return resolution ? `${formatCliReleaseVersionResolution(resolution)}\n` : "";
}

function formatVerifyFailure(payload) {
  const lines = [
    `Local components release manifest is invalid: ${payload.manifestPath}`,
    payload.base ? `Base: ${payload.base}` : null,
    ...payload.errors.map((error) => `- ${error}`),
  ];
  if (
    payload.errors.some(
      (error) =>
        error.includes("service.bundleHash is stale") ||
        error.includes(
          "bundleHash changed without a service.bundleVersion bump"
        )
    )
  ) {
    lines.push(
      "Recovery: run `pnpm run release:preflight`, then choose the intended CLI/Service version and policy and rerun the base-aware stamp command (use `--next` for automatic channel-based selection). It rebuilds the packaged CLI before writing; do not use --current to bypass release history."
    );
  }
  return lines.filter(Boolean).join("\n");
}

function formatReleasePolicyGuardFailure(input) {
  return [
    `Local components release policy is invalid against ${input.base}.`,
    ...input.errors.map((error) => `- ${error}`),
    "Pass an explicit --cli, --service, or --skills policy, or use --current only for a current-facts check.",
  ].join("\n");
}

function writeOutput(payload, json, formatter) {
  const output = json ? JSON.stringify(payload, null, 2) : formatter(payload);
  process.stdout.write(`${output}\n`);
}

function compareCurrentFacts(input) {
  if (input.actual === input.expected) {
    return [];
  }
  return [
    `${input.label} is stale: manifest=${String(input.actual)} current=${String(input.expected)}`,
  ];
}

export async function readReleaseManifest(path) {
  const raw = await readFile(path, "utf8").catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
  return raw ? JSON.parse(raw) : null;
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stringifyRepoJson(value)}\n`);
}

function stringifyRepoJson(value) {
  return JSON.stringify(value, null, 2).replace(
    /\[\n(\s+)"([^"\n]+)"\n\s+\]/gu,
    '["$2"]'
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

// A forced-update floor must be a plain published release version — no
// prerelease, no build metadata. Rejecting non-plain values closes both a
// malformed-floor hard-block ("1.2.3oops", "9.0.0+bad meta") and prerelease
// precedence ambiguity (compareSemverCore ignores prerelease). Must match the
// client's `isPlainReleaseVersion` in clients/openmeld-cli/src/config/version-state.ts.
const PLAIN_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/u;

function isPlainReleaseVersion(value) {
  return PLAIN_RELEASE_VERSION_RE.test(String(value ?? "").trim());
}

function maxSemver(left, right) {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return compareSemverCore(left, right) >= 0 ? left : right;
}

function readPackageMinRequiredCliVersion(packageJson) {
  const openmeld = packageJson?.openmeld;
  if (!openmeld || typeof openmeld !== "object") {
    return null;
  }
  return normalizeOptionalString(openmeld.minRequiredCliVersion);
}

function readPackageReleaseLine(packageJson) {
  const openmeld = packageJson?.openmeld;
  if (!openmeld || typeof openmeld !== "object") {
    return null;
  }
  return normalizeOptionalString(openmeld.releaseLine);
}

// Resolve the monotonic npm update floor before bundling: package metadata is
// bundled into the CLI, so changing it after hashing invalidates the stamp.
function projectCliRequiredFloor({ packageJson, updatePolicy }) {
  const previousFloor = readPackageMinRequiredCliVersion(packageJson);
  const nextFloor =
    updatePolicy === "required"
      ? maxSemver(previousFloor, packageJson.version)
      : previousFloor;
  const changed = nextFloor !== previousFloor;
  return {
    changed,
    packageJson: changed
      ? {
          ...packageJson,
          openmeld: {
            ...packageJson.openmeld,
            minRequiredCliVersion: nextFloor,
          },
        }
      : packageJson,
    projection: { changed, nextFloor, previousFloor },
  };
}

function formatFloorProjectionSuffix(projection) {
  const floor = projection.nextFloor ?? "none";
  const base = `\nCLI required floor: ${floor}${projection.changed ? " (updated)" : ""}`;
  if (!projection.changed) {
    return base;
  }
  // A required release can project a new floor automatically. The forced-update
  // gate depends on npm preserving + serving the custom
  // `openmeld.minRequiredCliVersion` field on the `latest` packument — an external
  // assumption we can only confirm against the live registry AFTER publish.
  // Print a loud, copy-pasteable check so whoever ships that release verifies it
  // instead of trusting it silently; if stripped, the gate silently never fires.
  return `${base}

  ⚠️  REQUIRED-RELEASE FOLLOW-UP — after \`npm publish\`, confirm the floor is live on npm:
      curl -s https://registry.npmjs.org/openmeld/latest \\
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).openmeld?.minRequiredCliVersion ?? "MISSING"))'
      Expect it to print: ${floor}
      If it prints MISSING, npm stripped the field and the forced-update gate will
      NEVER fire — fall back to a dist-tag floor (clients/openmeld-cli/src/config/version-state.ts).`;
}

/**
 * Verifies the published floor stays consistent with the committed manifest so
 * a hand-edited package.json or manifest cannot silently un-gate an unsafe CLI.
 * A `required` release pins the floor to that release. A separately proven
 * compatibility break may raise the floor only to its first safe version while
 * leaving a newer release advisory. Every release must keep the floor valid,
 * monotonic, and no newer than the published version. The base-aware checks run
 * only when a base ref is available (skipped for `--current`).
 */
export function resolveCliRequiredFloorVerificationErrors(input) {
  const errors = [];
  const floor = normalizeOptionalString(input.facts.cliRequiredFloor);
  const baseFloor = normalizeOptionalString(input.baseFloor);
  const releaseLine = normalizeOptionalString(input.facts.cliReleaseLine);
  const baseReleaseLine = normalizeOptionalString(input.baseReleaseLine);
  const cli = input.manifest.components.cli;

  if (floor && !isPlainReleaseVersion(floor)) {
    errors.push(
      `clients/openmeld-cli/package.json openmeld.minRequiredCliVersion is not a valid version: ${floor}`
    );
    return errors;
  }
  errors.push(...resolveCurrentCliRequiredFloorErrors({ cli, floor }));
  errors.push(
    ...resolveBaseAwareCliRequiredFloorErrors({
      baseAware: input.baseAware,
      baseFloor,
      baseReleaseLine,
      floor,
      releaseLine,
      updatePolicy: cli.updatePolicy,
    })
  );
  return errors;
}

function resolveCurrentCliRequiredFloorErrors(input) {
  const errors = [];
  const { cli, floor } = input;

  if (floor && compareSemverCore(floor, cli.packageVersion) > 0) {
    errors.push(
      `openmeld.minRequiredCliVersion (${floor}) must not exceed the published cli.packageVersion (${cli.packageVersion}).`
    );
  }
  if (cli.updatePolicy === "required") {
    if (!floor) {
      errors.push(
        `cli.updatePolicy is required, so clients/openmeld-cli/package.json must set openmeld.minRequiredCliVersion to ${cli.packageVersion}.`
      );
    } else if (compareSemverCore(floor, cli.packageVersion) < 0) {
      errors.push(
        `cli.updatePolicy is required, so openmeld.minRequiredCliVersion (${floor}) must be at least the published cli.packageVersion (${cli.packageVersion}).`
      );
    }
  }
  return errors;
}

function resolveBaseAwareCliRequiredFloorErrors(input) {
  const {
    baseAware,
    baseFloor,
    baseReleaseLine,
    floor,
    releaseLine,
    updatePolicy,
  } = input;
  // Skip the base-aware drift checks when the base floor is untrustworthy (a
  // malformed value — practically impossible since the strict check runs on
  // every release): treat it as "no reliable base signal" rather than failing a
  // legitimate release with a confusing message. `baseFloor` is null or strict
  // below.
  const baseFloorTrustworthy = !baseFloor || isPlainReleaseVersion(baseFloor);
  if (!(baseAware && baseFloorTrustworthy)) {
    return [];
  }
  // OpenMeld's first public npm release line can reset the inherited
  // pre-public ATS floor exactly once. Future release-line changes must not
  // become a generic back door around the forced-update floor.
  if (
    baseReleaseLine === null &&
    releaseLine === OPENMELD_GREENFIELD_RELEASE_LINE
  ) {
    return [];
  }
  if (updatePolicy === "required") {
    return resolveRequiredPolicyBaseFloorErrors({ baseFloor, floor });
  }
  // The floor is monotonic: dropping it (or unsetting it) silently un-gates
  // older CLIs, so any regression below the base floor is rejected for every
  // policy. Deliberately raising it outside a required release is allowed for a
  // separately proven compatibility break: the package field is itself the CLI
  // gate, while the surrounding release can remain advisory for supported CLIs.
  if (!baseFloor || floorsEqualOrAbove(floor, baseFloor)) {
    return [];
  }
  return [
    `cli.updatePolicy is ${updatePolicy}, so openmeld.minRequiredCliVersion (${floor ?? "unset"}) must not regress below the base floor (${baseFloor}).`,
  ];
}

function resolveRequiredPolicyBaseFloorErrors(input) {
  const { baseFloor, floor } = input;
  // A required release may raise the floor but must never regress it below what
  // the base ref already committed.
  if (baseFloor && !floorsEqualOrAbove(floor, baseFloor)) {
    return [
      `openmeld.minRequiredCliVersion (${floor ?? "unset"}) must not regress below the base floor (${baseFloor}).`,
    ];
  }
  return [];
}

function floorsEqualOrAbove(floor, baseFloor) {
  return Boolean(floor) && compareSemverCore(floor, baseFloor) >= 0;
}

function parseExportedStringConstant(source, name, input = {}) {
  const required = input.required ?? true;
  const pattern = new RegExp(
    `export\\s+const\\s+${escapeRegex(name)}\\s*=\\s*["']([^"']+)["']`,
    "u"
  );
  const match = source.match(pattern);
  if (match?.[1]) {
    return match[1];
  }
  if (!required) {
    return null;
  }
  throw new Error(`Could not find exported string constant ${name}.`);
}

function parseDeclaredStringConstant(source, name) {
  const pattern = new RegExp(
    `(?:export\\s+)?const\\s+${escapeRegex(name)}\\s*=\\s*["']([^"']+)["']`,
    "u"
  );
  const match = source.match(pattern);
  if (match?.[1]) {
    return match[1];
  }
  throw new Error(`Could not find string constant ${name}.`);
}

async function computeSkillsBundleHash(input) {
  return await computeDirectoryContentHash({
    ignoredNames: new Set([".openmeld-skill.json"]),
    mode: "skills",
    rootDir: input.rootDir,
  });
}

export async function computeServiceBundleHash(input) {
  return await computeDirectoryContentHash({
    ignoredNames: new Set(),
    ignoredTopLevelDirs: SERVICE_BUNDLE_IGNORED_TOP_LEVEL_DIRS,
    mode: "service",
    rootDir: input.rootDir,
    returnNullWhenMissing: true,
  });
}

async function computeDirectoryContentHash(input) {
  const exists = await pathExists(input.rootDir);
  if (!exists) {
    if (input.returnNullWhenMissing) {
      return null;
    }
    throw new Error(`Missing directory: ${input.rootDir}`);
  }
  const collectedFiles = await collectFiles({
    ignoredNames: input.ignoredNames,
    ignoredTopLevelDirs: input.ignoredTopLevelDirs ?? new Set(),
    rootDir: input.rootDir,
    currentDir: input.rootDir,
  });
  const files =
    input.mode === "service"
      ? collectedFiles.toSorted((left, right) =>
          compareCodeUnitText(left.relativePath, right.relativePath)
        )
      : collectedFiles;
  const hash = createHash("sha256");
  for (const file of files) {
    if (input.mode === "service") {
      hash.update(file.relativePath, "utf8");
      hash.update("\0", "utf8");
      hash.update(await readFile(file.absolutePath));
      hash.update("\0", "utf8");
      continue;
    }
    hash.update(`file:${file.relativePath}\n`);
    hash.update(await readFile(file.absolutePath));
    hash.update("\n");
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
    const relativePath = normalizeRepoPath(
      relative(input.rootDir, absolutePath)
    );
    const topLevelPathSegment = relativePath.split("/")[0] ?? "";
    if (input.ignoredTopLevelDirs.has(topLevelPathSegment)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(
        ...(await collectFiles({
          ...input,
          currentDir: absolutePath,
        }))
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push({
      absolutePath,
      relativePath,
    });
  }
  return files;
}

function compareCodeUnitText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

async function pathExists(path) {
  return await stat(path)
    .then(() => true)
    .catch((error) => {
      if (getErrorCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    });
}

async function resolveChangedPaths(input) {
  const args = ["diff", "--name-only", `${input.base}...HEAD`];
  try {
    const result = await execGit(args, {
      maxBuffer: 1024 * 1024 * 10,
      repoRoot: input.repoRoot,
    });
    return splitLines(result.stdout);
  } catch {
    const fallback = await execGit(["diff", "--name-only", input.base], {
      maxBuffer: 1024 * 1024 * 10,
      repoRoot: input.repoRoot,
    });
    return splitLines(fallback.stdout);
  }
}

function readBaseCommandContractVersion(input) {
  return readBaseExportedStringConstant({
    ...input,
    sourcePath: CLI_LOCAL_COMPONENTS_SOURCE_PATH,
    constantName: "OPENMELD_CLI_COMMAND_CONTRACT_VERSION",
  });
}

function readBaseRuntimeContractEpoch(input) {
  return readBaseExportedStringConstant({
    ...input,
    sourcePath: RUNTIME_TRANSPORT_SCHEMA_SOURCE_PATH,
    constantName: "CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH",
  });
}

async function readBaseServiceContractVersion(input) {
  const baseServiceContractVersion = await readBaseExportedStringConstant({
    ...input,
    sourcePath: CLI_LOCAL_COMPONENTS_SOURCE_PATH,
    constantName: "OPENMELD_SERVICE_CONTRACT_VERSION",
  });
  return baseServiceContractVersion ?? input.baseRuntimeContractEpoch ?? null;
}

function readBaseSkillContractVersion(input) {
  return readBaseExportedStringConstant({
    ...input,
    sourcePath: CLI_LOCAL_COMPONENTS_SOURCE_PATH,
    constantName: "OPENMELD_SKILLS_CONTRACT_VERSION",
  });
}

async function readBaseExportedStringConstant(input) {
  const basePath = `${input.base}:${input.sourcePath}`;
  try {
    const result = await execGit(["show", basePath], {
      maxBuffer: 1024 * 1024,
      repoRoot: input.repoRoot,
    });
    return parseExportedStringConstant(result.stdout, input.constantName, {
      required: false,
    });
  } catch {
    return null;
  }
}

function splitLines(value) {
  return String(value)
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeRepoPath(path) {
  return String(path).split("\\").join("/");
}

function normalizeNonEmptyString(value, label) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatHash(value) {
  return value ? `${value.slice(0, 16)}...` : "missing";
}

function getErrorCode(error) {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalComponentsReleaseTool().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
