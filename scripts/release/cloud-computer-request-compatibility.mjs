import path from "node:path";
import { isDeepStrictEqual } from "node:util";
// biome-ignore lint/performance/noNamespaceImport: Node-only inspection uses the installed TypeScript parser.
import * as ts from "typescript";
import { parseDocument } from "yaml";

const SCHEMA = "packages/schemas/src/schemas/runtime/cloud-computer.ts";
const REQUESTS = [
  "cloudComputerOperationSchema",
  "cloudComputerRpcRequestSchema",
  "cloudComputerWorkerRequestSchema",
];
const CALLERS = [
  "services/core/src/computer/computer-rpc.ts",
  "services/gateway/src/routes/rpc-http.cloud-computer.ts",
  "packages/api-client/src/cloud-computer.ts",
  "clients/openmeld-cli/src/commands/cloud-computer.ts",
  "packages/schemas/package.json",
  "packages/schemas/tsdown.config.ts",
];

const SCHEMA_METHODS = new Set([
  "union",
  "strictObject",
  "object",
  "literal",
  "record",
  "unknown",
  "string",
  "min",
  "max",
  "enum",
  "array",
  "number",
  "int",
  "nonnegative",
  "positive",
  "optional",
  "nullable",
  "json",
  "extend",
  "boolean",
  "catchall",
]);

function hasPublicRequestExports(source) {
  const parsed = ts.createSourceFile(
    "index.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  if (parsed.parseDiagnostics.length) {
    return false;
  }
  const exports = parsed.statements.filter(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
  );
  return REQUESTS.every((name) => {
    const owners = exports.filter((statement) =>
      statement.exportClause.elements.some((item) => item.name.text === name)
    );
    return (
      owners.length === 1 &&
      owners[0].moduleSpecifier?.text === "./schemas/runtime/cloud-computer" &&
      owners[0].exportClause.elements.some(
        (item) =>
          item.name.text === name &&
          (!item.propertyName || item.propertyName.text === name)
      )
    );
  });
}

function schemaExpression(node, names) {
  if (ts.isIdentifier(node)) {
    return names.has(node.text);
  }
  if (
    ts.isLiteralExpression(node) ||
    [
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.NullKeyword,
    ].includes(node.kind)
  ) {
    return true;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every((item) => schemaExpression(item, names));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (item) =>
        (ts.isShorthandPropertyAssignment(item) && names.has(item.name.text)) ||
        (ts.isPropertyAssignment(item) &&
          !ts.isComputedPropertyName(item.name) &&
          schemaExpression(item.initializer, names))
    );
  }
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    SCHEMA_METHODS.has(node.expression.name.text) &&
    schemaExpression(node.expression.expression, names) &&
    node.arguments.every((argument) => schemaExpression(argument, names))
  );
}

function assertDeclarativeResults(parsed, boundary) {
  const names = new Set([
    "z",
    ...parsed.statements
      .filter(
        (statement) =>
          statement.pos < boundary.pos && ts.isVariableStatement(statement)
      )
      .flatMap((statement) =>
        statement.declarationList.declarations.map((declaration) =>
          declaration.name.getText(parsed)
        )
      ),
  ]);
  for (const statement of parsed.statements.filter(
    (item) => item.pos >= boundary.pos
  )) {
    if (ts.isTypeAliasDeclaration(statement)) {
      continue;
    }
    if (
      !(
        ts.isVariableStatement(statement) &&
        statement.declarationList.flags === ts.NodeFlags.Const
      )
    ) {
      throw new Error("Executable Computer result suffix");
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        names.has(declaration.name.text) ||
        !declaration.initializer ||
        !schemaExpression(declaration.initializer, names)
      ) {
        throw new Error("Unknown Computer result declaration");
      }
      names.add(declaration.name.text);
    }
  }
}

function requestPrefix(source) {
  const parsed = ts.createSourceFile(
    "cloud-computer.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  if (parsed.parseDiagnostics.length) {
    throw new Error("Invalid Computer schema");
  }
  const boundary = parsed.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          declaration.name.getText(parsed) ===
          "cloudComputerOperationResultSchema"
      )
  );
  if (!boundary) {
    throw new Error("Missing Computer response boundary");
  }
  assertDeclarativeResults(parsed, boundary);
  const prefix = source.slice(0, boundary.getFullStart());
  for (const name of REQUESTS) {
    if (!prefix.includes(`export const ${name} =`)) {
      throw new Error("Unknown Computer request layout");
    }
  }
  return prefix;
}

function yaml(source) {
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (parsed.errors.length) {
    throw new Error("Invalid dependency manifest");
  }
  return parsed.toJS();
}

function parserResolution(read, ref) {
  const lock = yaml(read(ref, "pnpm-lock.yaml"));
  const workspace = yaml(read(ref, "pnpm-workspace.yaml"));
  const dependency = lock.importers?.["packages/schemas"]?.dependencies?.zod;
  if (!(dependency?.version && workspace.catalog?.zod)) {
    throw new Error("Missing parser resolution");
  }
  const key = `zod@${dependency.version}`;
  if (!(lock.packages?.[key] && lock.snapshots?.[key])) {
    throw new Error("Missing parser lock");
  }
  return {
    dependency,
    package: lock.packages[key],
    snapshot: lock.snapshots[key],
    catalog: workspace.catalog.zod,
    catalogs: workspace.catalogs,
    overrides: Object.entries(workspace.overrides ?? {}).filter(
      ([name]) => name.includes("zod") || name.includes("*")
    ),
    packageExtensions: Object.entries(workspace.packageExtensions ?? {}).filter(
      ([, extension]) =>
        extension.dependencies?.zod || extension.peerDependencies?.zod
    ),
    patches: Object.entries(workspace.patchedDependencies ?? {}).filter(
      ([name]) => name.includes("zod")
    ),
  };
}

/** Only proves that the existing public Computer requests have not changed.
 * Result additions and native storage changes do not introduce opt-in callers.
 * Missing history, changed callers or imported parsers retain receiver ordering. */
export function hasUnchangedCloudComputerRequests(context) {
  if (!(context.base && context.sourceSha && context.readGitFile)) {
    return false;
  }
  try {
    const read = (ref, file) => {
      const source = context.readGitFile(ref, file);
      if (typeof source !== "string" || !source) {
        throw new Error(`Missing ${file}`);
      }
      return source;
    };
    const pair = (file) => [
      read(context.base, file),
      read(context.sourceSha, file),
    ];
    if (!pair("packages/schemas/src/index.ts").every(hasPublicRequestExports)) {
      return false;
    }
    if (
      !CALLERS.every((file) => {
        const [a, b] = pair(file);
        return a === b;
      })
    ) {
      return false;
    }
    if (
      !isDeepStrictEqual(
        parserResolution(read, context.base),
        parserResolution(read, context.sourceSha)
      )
    ) {
      return false;
    }
    const [before, after] = pair(SCHEMA).map(requestPrefix);
    if (before !== after) {
      return false;
    }
    return unchangedImportedSchemas(pair, before);
  } catch {
    return false;
  }
}

function unchangedImportedSchemas(pair, before) {
  const pending = [[SCHEMA, before]];
  const visited = new Set([SCHEMA]);
  while (pending.length) {
    const [file, source] = pending.pop();
    for (const dependency of ts.preProcessFile(source, true, true)
      .importedFiles) {
      const specifier = dependency.fileName;
      if (specifier === "zod/v4") {
        continue;
      }
      if (!specifier.startsWith(".")) {
        throw new Error("Unknown Computer schema dependency");
      }
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), `${specifier}.ts`)
      );
      if (visited.has(target)) {
        continue;
      }
      visited.add(target);
      const [a, b] = pair(target);
      if (a !== b) {
        return false;
      }
      pending.push([target, a]);
    }
  }
  return true;
}
