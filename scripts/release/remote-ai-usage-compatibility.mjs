import { isDeepStrictEqual } from "node:util";
import {
  createSourceFile,
  forEachChild,
  isClassDeclaration,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isMethodDeclaration,
  isNamedImports,
  isObjectLiteralExpression,
  isPrivateIdentifier,
  isPropertyAssignment,
  isStringLiteral,
  parseConfigFileTextToJson,
  parseJsonText,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from "typescript";
import { parseDocument } from "yaml";

const CORE_INDEX = "services/core/src/index.ts";
const CORE_CONFIG = "services/core/wrangler.jsonc";
const REMOTE_CONFIG = "services/remote-agent/wrangler.jsonc";
const LOCKFILE = "pnpm-lock.yaml";
const EXACT_SHA = /^[0-9a-f]{40}$/u;

// Bounded receiver owners, not a general import graph. Compare the complete
// schema export closure and usage modules so an unchanged method name cannot
// bless a different parser, allowance policy, storage delegate or DB wrapper.
export const REMOTE_AI_USAGE_RECEIVER_PATHS = [
  CORE_INDEX,
  CORE_CONFIG,
  REMOTE_CONFIG,
  "services/core/src/usage",
  "services/core/src/rpc/errors.ts",
  "services/core/package.json",
  "services/core/tsconfig.json",
  "packages/schemas/src",
  "packages/schemas/package.json",
  "packages/schemas/tsdown.config.ts",
  "packages/db/src/postgresql.ts",
  "packages/db/package.json",
  "packages/db/tsdown.config.ts",
  "pnpm-workspace.yaml",
  LOCKFILE,
];

export function compareRemoteAiUsageReceiver(input) {
  if (!(EXACT_SHA.test(input.fromSha) && EXACT_SHA.test(input.toSha))) {
    throw new Error("AI usage receiver proof requires exact source SHAs.");
  }
  for (const sha of [input.fromSha, input.toSha]) {
    assertUsageEntrypoint(input.readGitFile(sha, CORE_INDEX));
    assertProductionBinding(
      input.readGitFile(sha, CORE_CONFIG),
      input.readGitFile(sha, REMOTE_CONFIG)
    );
  }
  return (
    input.compareGitPathContents({
      fromSha: input.fromSha,
      toSha: input.toSha,
      paths: REMOTE_AI_USAGE_RECEIVER_PATHS.filter((path) => path !== LOCKFILE),
    }) &&
    compareReceiverLockfile(
      input.readGitFile(input.fromSha, LOCKFILE),
      input.readGitFile(input.toSha, LOCKFILE)
    )
  );
}

function assertUsageEntrypoint(source) {
  const file = createSourceFile(
    CORE_INDEX,
    source,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS
  );
  if (file.parseDiagnostics.length > 0) {
    throw new Error("Cannot parse the AI usage receiver entrypoint.");
  }
  if (
    file.statements.some(
      (node) =>
        isExportDeclaration(node) &&
        node.exportClause?.elements?.some((binding) =>
          ["CoreRpcEntrypoint", "CenterAgentRpcEntrypoint"].includes(
            binding.name.text
          )
        )
    )
  ) {
    throw new Error("Ambiguous AI usage receiver export binding.");
  }
  const classes = ["CoreRpcEntrypoint", "CenterAgentRpcEntrypoint"].map(
    (name) => {
      const matches = file.statements.filter(
        (node) => isClassDeclaration(node) && node.name?.text === name
      );
      if (matches.length !== 1) {
        throw new Error(
          `AI usage receiver class ${name} is missing or ambiguous.`
        );
      }
      const node = matches[0];
      const names = new Set();
      for (const member of node.members) {
        if (
          !(
            isMethodDeclaration(member) &&
            (isIdentifier(member.name) || isPrivateIdentifier(member.name)) &&
            member.body &&
            !names.has(member.name.text) &&
            !["env", "ctx", "constructor"].includes(member.name.text) &&
            (member.modifiers ?? []).every(
              (modifier) => modifier.kind === SyntaxKind.AsyncKeyword
            )
          )
        ) {
          throw new Error(
            `Unknown AI usage receiver class structure: ${name}.`
          );
        }
        names.add(member.name.text);
      }
      return node;
    }
  );
  const [base, receiver] = classes;
  if (
    base.modifiers?.length ||
    receiver.modifiers?.length !== 1 ||
    receiver.modifiers[0].kind !== SyntaxKind.ExportKeyword ||
    base.typeParameters?.length ||
    receiver.typeParameters?.length ||
    base.heritageClauses?.length !== 1 ||
    receiver.heritageClauses?.length !== 1 ||
    base.heritageClauses[0].getText(file) !==
      "extends WorkerEntrypoint<CoreBindings>" ||
    receiver.heritageClauses[0].getText(file) !== "extends CoreRpcEntrypoint"
  ) {
    throw new Error("Unknown AI usage receiver export or inheritance.");
  }
  const member = receiver.members.find(
    (node) => node.name.text === "recordRemoteAiUsage"
  );
  if (
    !member ||
    base.members.some((node) => node.name.text === "recordRemoteAiUsage")
  ) {
    throw new Error("The AI usage receiver must own one complete RPC method.");
  }
  for (const [local, module] of [
    ["WorkerEntrypoint", "cloudflare:workers"],
    ["withPostgresRequest", "@openmeld/db/postgresql"],
    ["rpcRecordRemoteAiUsage", "./usage/ai-usage-rpc"],
  ]) {
    const bindings = file.statements
      .filter(isImportDeclaration)
      .flatMap((node) => {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        if (clause?.isTypeOnly || !named || !isNamedImports(named)) {
          return [];
        }
        return named.elements
          .filter((binding) => binding.name.text === local)
          .map((binding) => ({ binding, module: node.moduleSpecifier.text }));
      });
    if (
      bindings.length !== 1 ||
      bindings[0].module !== module ||
      bindings[0].binding.isTypeOnly ||
      (bindings[0].binding.propertyName?.text ?? local) !== local
    ) {
      throw new Error(`Unknown AI usage receiver runtime import: ${local}.`);
    }
  }
}

function parseUnambiguousConfig(path, source) {
  const tree = parseJsonText(path, source);
  const check = (node) => {
    if (isObjectLiteralExpression(node)) {
      const names = new Set();
      for (const property of node.properties) {
        if (
          !(isPropertyAssignment(property) && isStringLiteral(property.name)) ||
          names.has(property.name.text)
        ) {
          throw new Error(
            `Ambiguous AI usage receiver configuration: ${path}.`
          );
        }
        names.add(property.name.text);
      }
    }
    forEachChild(node, check);
  };
  check(tree);
  const parsed = parseConfigFileTextToJson(path, source);
  if (tree.parseDiagnostics.length > 0 || parsed.error || !parsed.config) {
    throw new Error(`Cannot parse AI usage receiver configuration: ${path}.`);
  }
  return parsed.config;
}

function assertProductionBinding(coreSource, remoteSource) {
  const core = parseUnambiguousConfig(CORE_CONFIG, coreSource);
  const remote = parseUnambiguousConfig(REMOTE_CONFIG, remoteSource);
  const bindings = remote.env?.prod?.services?.filter(
    (binding) => binding.binding === "OPENMELD_CORE_WORKER"
  );
  if (
    core.main !== "src/index.ts" ||
    core.name !== "openmeld-core" ||
    !core.env?.prod ||
    core.env.prod.name ||
    core.env.prod.main ||
    core.legacy_env === false ||
    bindings?.length !== 1 ||
    bindings[0].service !== `${core.name}-prod` ||
    bindings[0].entrypoint !== "CenterAgentRpcEntrypoint"
  ) {
    throw new Error(
      "AI usage does not use the expected production Core RPC binding."
    );
  }
}

function readLockfile(source) {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error("Cannot parse an unambiguous AI usage receiver lockfile.");
  }
  const lock = document.toJS();
  if (!(lock?.importers && lock.packages && lock.snapshots)) {
    throw new Error("Unknown AI usage receiver lockfile structure.");
  }
  return lock;
}

function compareReceiverLockfile(beforeSource, afterSource) {
  const before = readLockfile(beforeSource);
  const after = readLockfile(afterSource);
  for (const importer of [
    ".",
    "services/core",
    "packages/db",
    "packages/schemas",
  ]) {
    if (
      !(
        before.importers[importer] &&
        isDeepStrictEqual(before.importers[importer], after.importers[importer])
      )
    ) {
      return false;
    }
  }
  // Unrelated workspaces may add packages. Every existing resolution and
  // snapshot must remain intact, so the unchanged receiver importers keep
  // exactly the same transitive dependencies without a new dependency walker.
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "importers") {
      continue;
    }
    if (["packages", "snapshots"].includes(key)) {
      if (
        !Object.entries(before[key]).every(([name, value]) =>
          isDeepStrictEqual(value, after[key][name])
        )
      ) {
        return false;
      }
    } else if (!isDeepStrictEqual(before[key], after[key])) {
      return false;
    }
  }
  return true;
}
