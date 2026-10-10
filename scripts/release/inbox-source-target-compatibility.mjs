import { isDeepStrictEqual } from "node:util";
// biome-ignore lint/performance/noNamespaceImport: This Node-only validator calls the installed TypeScript syntax API.
import * as ts from "typescript";
import { parseDocument } from "yaml";
import { parseUnambiguousConfig } from "./remote-ai-usage-compatibility.mjs";

const INBOX = "packages/schemas/src/schemas/http/inbox.ts";
const CORE_RPC = "services/core/src/inbox/transport/rpc/inbox-rpc.ts";
const GATEWAY_RPC = "services/gateway/src/routes/rpc-http.inbox.ts";
const CORE_INDEX = "services/core/src/index.ts";
const TARGET_DECLARATIONS = [
  "identifierSchema",
  "centerAgentInboxSourceTargetSchema",
  "slackInboxSourceTargetSchema",
  "computerInboxSourceTargetSchema",
  "desktopUpdateInboxSourceTargetSchema",
  "inboxSourceTargetSchema",
  "inboxItemWireSchema",
  "inboxItemSchema",
  "inboxSourceCandidateWireSchema",
  "inboxSourceCandidateSchema",
  "listInboxItemsResponseSchema",
  "listInboxItemsWireResponseSchema",
  "getInboxItemResponseSchema",
  "getInboxItemWireResponseSchema",
  "markInboxItemReadResponseSchema",
  "markInboxItemReadWireResponseSchema",
  "inboxNotificationObservationsResponseSchema",
];
const GATEWAY_PROJECTIONS = [
  "projectPluginRequestForClient",
  "projectInboxSpaceTargetForClient",
  "resolveInboxSourceTargetVersion",
  "InboxSourceTargetClientVersion",
  "resolveInboxItemResponse",
  "resolveInboxListResponse",
  "supportsInboxAccountItems",
];
const TARGET_METHODS = [
  "listInboxFeed",
  "listInboxItems",
  "observeInboxNotifications",
  "getInboxItem",
  "getSpaceInboxSummary",
  "getSpaceInboxUnreadTargets",
  "markInboxItemRead",
];
const TYPESCRIPT_LEAVES = [
  "packages/schemas/tsconfig.json",
  "packages/db/tsconfig.json",
  "packages/api-client/tsconfig.json",
  "services/core/tsconfig.json",
  "services/gateway/tsconfig.json",
];
const TYPESCRIPT_PARENT = "tooling/typescript-config/base.jsonc";
const UNCHANGED_FILES = [
  "packages/schemas/src/lazy-zod.ts",
  "packages/schemas/src/schemas/daemon/service-contract.ts",
  "packages/schemas/src/schemas/runtime/message-channel.ts",
  "packages/schemas/package.json",
  "packages/schemas/tsdown.config.ts",
  "packages/db/src/postgresql.ts",
  "packages/db/package.json",
  "packages/db/tsdown.config.ts",
  "packages/api-client/src/inbox/routes.ts",
  "packages/api-client/src/inbox/notification-policy.ts",
  "packages/api-client/src/client.ts",
  "packages/api-client/package.json",
  "packages/api-client/tsdown.config.ts",
  "packages/gateway-contract/package.json",
  "packages/gateway-contract/src/index.ts",
  "clients/web/src/lib/inbox/source-target.ts",
  "clients/web/src/lib/profile-routes.ts",
  "packages/schemas/src/navigation-action.ts",
  "clients/web/tsconfig.json",
  "clients/web/vite.config.ts",
  ...TYPESCRIPT_LEAVES,
  TYPESCRIPT_PARENT,
  "services/core/wrangler.jsonc",
  "services/core/src/inbox/infrastructure/postgresql/inbox-item-repo.ts",
  "services/core/src/inbox/application/inbox-legacy-space-awareness.ts",
  "services/core/src/inbox/application/inbox-legacy-interaction-attention.ts",
  "services/core/src/inbox/application/inbox-feed-service.ts",
  "services/core/src/inbox/application/inbox-notification-observations.ts",
  "services/gateway/src/routes/rpc-http.helpers.ts",
  "services/gateway/src/routes/rpc-http.parsers.ts",
  "services/core/src/remote-agent/application/native-delivery-inbox-producer.ts",
  "services/core/src/remote-agent/application/slack-inbox-source-target.ts",
  "services/core/src/runtime-transport/application/runtime-coordinator-interaction-inbox-producer.ts",
  "services/core/src/rpc/space-ref.ts",
];
const MEMBERSHIP_PROJECTORS = [
  "projectSpaceInboxSummaryForMembershipReceiver",
  "projectSpaceInboxUnreadTargetsForMembershipReceiver",
];
const SHARED_ROUTE_NAMES = [
  "encodePathSegment",
  "buildOrganizationRootPath",
  "buildOrganizationSpacePath",
  "buildOrganizationAgentsPath",
  "buildOrganizationAgentCreationRequestsPath",
  "buildOrganizationComputersPath",
  "buildOrganizationComputerPath",
  "buildOrganizationInboxPath",
  "buildOrganizationChannelsPath",
  "buildOrganizationDirectMessagesPath",
  "buildOrganizationDirectMessagePath",
  "buildOrganizationDocumentsPath",
  "buildOrganizationDocumentPath",
  "buildOrganizationCenterAgentChatPath",
];
const EXACT_SHA = /^[0-9a-f]{40}$/u;

// This classifier proves only the existing durable sourceTarget contract.
// Membership requests, kinds and counts retain their independent obligation.
// It never emits a receiver witness or blesses another contract on that pair.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: These finite owner comparisons intentionally fail together at the original release gate.
export function hasUnchangedInboxSourceTargetContract(context) {
  if (
    !(
      EXACT_SHA.test(context.base) &&
      EXACT_SHA.test(context.sourceSha) &&
      typeof context.readGitFile === "function"
    )
  ) {
    return false;
  }
  try {
    const read = (sha, file) => {
      const source = context.readGitFile(sha, file);
      if (typeof source !== "string" || !source) {
        throw new Error(`Unreadable Inbox owner: ${file}`);
      }
      return source;
    };
    const pair = (file) => [
      read(context.base, file),
      read(context.sourceSha, file),
    ];
    const syntaxPair = (file) =>
      pair(file).map((source) => syntax(source, file));
    if (
      !UNCHANGED_FILES.every((file) => {
        const [a, b] = pair(file);
        return a === b;
      })
    ) {
      return false;
    }
    const api = syntaxPair("packages/api-client/src/inbox/api.ts");
    if (
      normalizeUnreadTargetsQuery(api[0]) !==
      normalizeUnreadTargetsQuery(api[1])
    ) {
      return false;
    }
    const schemas = syntaxPair(INBOX);
    for (const name of TARGET_DECLARATIONS) {
      if (!sameNamed(schemas, name)) {
        return false;
      }
      if (TARGET_DECLARATIONS.indexOf(name) < 6) {
        for (const file of schemas) {
          assertTargetDependencies(named(file, name));
        }
      }
    }
    if (!sameImports(schemas)) {
      return false;
    }
    const feed = syntaxPair("packages/schemas/src/schemas/http/inbox-feed.ts");
    if (
      !(
        sameImports(feed) &&
        [
          "opaqueKeySchema",
          "identifierSchema",
          "countSchema",
          "inboxFeedCategorySchema",
          "inboxFeedCountsSchema",
          "inboxFeedRowSchema",
          "inboxFeedResponseSchema",
        ].every((name) => sameNamed(feed, name))
      )
    ) {
      return false;
    }
    if (
      schemas.some((file) => file.statements.some(ts.isExpressionStatement))
    ) {
      return false;
    }
    for (const file of [
      "packages/schemas/src/index.ts",
      "packages/schemas/src/schemas/index.ts",
    ]) {
      const stars = syntaxPair(file).map((value) =>
        value.statements
          .filter(
            (node) =>
              ts.isExportDeclaration(node) &&
              !node.isTypeOnly &&
              (!node.exportClause || ts.isNamespaceExport(node.exportClause))
          )
          .map(tokens)
      );
      if (!isDeepStrictEqual(stars[0], stars[1])) {
        return false;
      }
    }
    for (const sha of [context.base, context.sourceSha]) {
      assertBindingsAndExports(sha, read);
    }
    const gatewayConfig = pair("services/gateway/wrangler.jsonc").map(
      (source) => parseUnambiguousConfig("gateway.jsonc", source)
    );
    for (const key of [
      "alias",
      "build",
      "rules",
      "no_bundle",
      "find_additional_modules",
      "compatibility_date",
      "compatibility_flags",
    ]) {
      if (
        !(
          isDeepStrictEqual(gatewayConfig[0][key], gatewayConfig[1][key]) &&
          isDeepStrictEqual(
            gatewayConfig[0].env.prod[key],
            gatewayConfig[1].env.prod[key]
          )
        )
      ) {
        return false;
      }
    }
    for (const [file, names] of [
      [
        "packages/gateway-contract/src/headers.ts",
        [
          "OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION",
          "OPENMELD_INBOX_SOURCE_TARGET_THREAD_UNAWARE_VERSION",
          "OPENMELD_INBOX_SOURCE_TARGET_VERSION",
        ],
      ],
      [
        "clients/web/src/lib/organizations/organization-routes.ts",
        SHARED_ROUTE_NAMES,
      ],
    ]) {
      const files = syntaxPair(file);
      if (
        !(sameImports(files) && names.every((name) => sameNamed(files, name)))
      ) {
        return false;
      }
    }
    const core = syntaxPair(CORE_RPC),
      gateway = syntaxPair(GATEWAY_RPC);
    for (const files of [core, gateway]) {
      if (
        files.some((file) =>
          file.statements.some(
            (node) =>
              ts.isExpressionStatement(node) || ts.isClassDeclaration(node)
          )
        )
      ) {
        return false;
      }
      const globals = files.map((file) =>
        file.statements.filter(ts.isVariableStatement).map(tokens)
      );
      if (!isDeepStrictEqual(globals[0], globals[1])) {
        return false;
      }
    }
    if (
      !(
        sameImports(core, MEMBERSHIP_PROJECTORS, true) &&
        sameImports(gateway, MEMBERSHIP_PROJECTORS)
      )
    ) {
      return false;
    }
    const sourceReadDelegates = core.map((file) => {
      const delegate = assertExclusiveSourceReadBindings(file);
      return replacedModuleTokens(
        named(file, "rpcMutateSpaceInboxRead"),
        new Map(delegate ? [[delegate, undefined]] : [])
      );
    });
    if (sourceReadDelegates[0] !== sourceReadDelegates[1]) {
      return false;
    }
    for (const file of core) {
      assertUnreadSourcePassthrough(file, "core");
    }
    for (const file of gateway) {
      assertUnreadSourcePassthrough(file, "gateway");
    }
    if (!GATEWAY_PROJECTIONS.every((name) => sameNamed(gateway, name))) {
      return false;
    }
    const coreProjection = core.map((file) => normalizeCoreProjection(file));
    const gatewayProjection = gateway.map((file) =>
      normalizeGatewayProjection(file)
    );
    if (
      coreProjection[0] !== coreProjection[1] ||
      gatewayProjection[0] !== gatewayProjection[1]
    ) {
      return false;
    }
    if (!compareTargetTransports(core, gateway)) {
      return false;
    }
    const entries = syntaxPair(CORE_INDEX);
    if (!compareInboxEntrypoints(entries)) {
      return false;
    }
    const nativeFile =
      "services/core/src/remote-agent/application/native-delivery-service.ts";
    const native = pair(nativeFile).map((source) =>
      normalizeNativeTime(source, nativeFile, read, context)
    );
    if (native[0] !== native[1]) {
      return false;
    }
    const storageFile =
      "services/core/src/inbox/application/inbox-item-service.ts";
    const storage = pair(storageFile).map((source) =>
      normalizeStorageGuard(source, storageFile)
    );
    if (storage[0] !== storage[1]) {
      return false;
    }
    if (
      !compareInboxRowMapper(
        syntaxPair("services/core/src/inbox/application/inbox-service.ts")
      )
    ) {
      return false;
    }
    return (
      compareParserLock(...pair("pnpm-lock.yaml")) &&
      compareParserWorkspace(...pair("pnpm-workspace.yaml"))
    );
  } catch {
    // Unknown syntax, dependencies, bindings or source retain the original gate.
    return false;
  }
}

function syntax(source, file) {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  if (parsed.parseDiagnostics.length) {
    throw new Error(`Cannot parse Inbox owner: ${file}`);
  }
  return parsed;
}
function tokens(node) {
  // Complete syntax structure, including operators and const/let binding.
  // Formatting, comments and optional trailing separators are not semantics.
  const visit = (child) => {
    const children = [];
    ts.forEachChild(child, (value) => {
      children.push(visit(value));
    });
    let value;
    if (ts.isVariableDeclarationList(child)) {
      // biome-ignore lint/suspicious/noBitwiseOperators: TypeScript represents binding kinds as NodeFlags bits.
      value = child.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let);
    } else if (
      ts.isIdentifier(child) ||
      ts.isPrivateIdentifier(child) ||
      ts.isLiteralExpression(child)
    ) {
      value = child.text;
    }
    return [child.kind, value, children];
  };
  return JSON.stringify(visit(node));
}
function named(file, name) {
  const nodes = file.statements.flatMap((node) => {
    if (ts.isVariableStatement(node)) {
      return [...node.declarationList.declarations].filter(
        (n) => ts.isIdentifier(n.name) && n.name.text === name
      );
    }
    return (ts.isFunctionDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)) &&
      node.name?.text === name
      ? [node]
      : [];
  });
  if (nodes.length !== 1) {
    throw new Error(`Missing or ambiguous Inbox declaration: ${name}`);
  }
  return nodes[0];
}
function sameNamed(files, name) {
  return tokens(named(files[0], name)) === tokens(named(files[1], name));
}
function compareInboxRowMapper(files) {
  const protectedNames = new Set([
    "mapInboxItemRow",
    "toIsoTimestamp",
    "inboxItemSchema",
    "inboxSourceTargetSchema",
    "JSON",
    "Error",
    "Number",
    "Date",
  ]);
  if (
    !(
      sameImports(files) &&
      [
        "mapInboxItemRow",
        "toIsoTimestamp",
        "readInboxItem",
        "inboxItemScopeSql",
      ].every((name) => sameNamed(files, name))
    )
  ) {
    return false;
  }
  const factories = files.map((file) => {
    for (const statement of file.statements) {
      if (ts.isExpressionStatement(statement)) {
        throw new Error("Unknown Inbox mapper module mutation.");
      }
      if (
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (node) =>
            !ts.isIdentifier(node.name) || protectedNames.has(node.name.text)
        )
      ) {
        throw new Error("Shadowed Inbox mapper binding.");
      }
      if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        protectedNames.has(statement.name?.text) &&
        !["mapInboxItemRow", "toIsoTimestamp"].includes(statement.name?.text)
      ) {
        throw new Error("Shadowed Inbox mapper global.");
      }
    }
    const factory = named(file, "createInboxService");
    rejectLocalTargetBindings(factory, protectedNames);
    const statements = [...factory.body.statements];
    const result = statements.pop();
    if (
      !(
        ts.isReturnStatement(result) &&
        ts.isObjectLiteralExpression(result.expression)
      )
    ) {
      throw new Error("Unknown Inbox service factory.");
    }
    const methods = ["get", "list", "markRead"].map((name) => {
      const found = result.expression.properties.filter(
        (node) =>
          ts.isMethodDeclaration(node) && node.name?.getText(file) === name
      );
      if (found.length !== 1) {
        throw new Error("Ambiguous Inbox target service method.");
      }
      return tokens(found[0]);
    });
    return [
      factory.modifiers?.map(tokens),
      factory.name && tokens(factory.name),
      factory.typeParameters?.map(tokens),
      factory.parameters.map(tokens),
      factory.type && tokens(factory.type),
      statements.map(tokens),
      methods,
      file.statements.filter(ts.isClassDeclaration).map(tokens),
    ];
  });
  return isDeepStrictEqual(factories[0], factories[1]);
}
function rejectLocalTargetBindings(owner, names) {
  const visit = (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      ts.isIdentifier(node.name ?? {}) &&
      names.has(node.name.text)
    ) {
      throw new Error("Shadowed local Inbox target binding.");
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(node.left) &&
      names.has(node.left.text)
    ) {
      throw new Error("Reassigned Inbox target binding.");
    }
    ts.forEachChild(node, visit);
  };
  visit(owner.body);
}
function sameImports(files, ignored = [], sourceRead = false) {
  if (sourceRead) {
    for (const file of files) {
      assertExclusiveSourceReadBindings(file);
    }
  }
  const imports = (file) =>
    file.statements.filter(ts.isImportDeclaration).flatMap((node) => {
      if (node.importClause?.isTypeOnly) {
        return [];
      }
      const clause = node.importClause,
        bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const names = bindings.elements
          .filter(
            (binding) =>
              !(
                binding.isTypeOnly ||
                (node.moduleSpecifier.text === "@openmeld/schemas" &&
                  !binding.propertyName &&
                  (ignored.includes(binding.name.text) ||
                    (sourceRead &&
                      binding.name.text === "inboxSourceCandidateSchema"))) ||
                (sourceRead &&
                  node.moduleSpecifier.text === "../../../rpc/space-ref" &&
                  !binding.propertyName &&
                  binding.name.text === "resolveSpaceStub")
              )
          )
          .map(tokens);
        return names.length
          ? [
              [
                node.moduleSpecifier.text,
                clause.name?.text,
                names,
                node.attributes && tokens(node.attributes),
              ],
            ]
          : [];
      }
      return [tokens(node)];
    });
  return isDeepStrictEqual(imports(files[0]), imports(files[1]));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The one complete query mutation must fail together before the module comparison.
function normalizeUnreadTargetsQuery(file) {
  const owner = named(file, "createInboxApi");
  const arrow = owner.initializer;
  const body = ts.isArrowFunction(arrow ?? {}) && arrow.body;
  const object = ts.isParenthesizedExpression(body ?? {})
    ? body.expression
    : body;
  if (!ts.isObjectLiteralExpression(object ?? {})) {
    throw new Error("Unknown Inbox API factory.");
  }
  const methods = object.properties.filter(
    (node) => node.name?.getText(file) === "spaceUnreadTargets"
  );
  const method = methods[0];
  if (
    methods.length !== 1 ||
    !ts.isPropertyAssignment(method ?? {}) ||
    !ts.isArrowFunction(method.initializer) ||
    !ts.isBlock(method.initializer.body)
  ) {
    throw new Error("Ambiguous Inbox unread query.");
  }
  const statements = [...method.initializer.body.statements];
  const replacements = new Map();
  if (statements.length === 5) {
    for (const [index, expected] of [
      [1, "const query = new URLSearchParams();"],
      [2, 'if (input.includeItemIds) { query.set("includeItemIds", "true"); }'],
      [
        3,
        'if (input.includeSourceKeys) { query.set("includeSourceKeys", "true"); }',
      ],
    ]) {
      assertStatement(statements[index], expected);
      replacements.set(statements[index], undefined);
    }
    const returned = statements[4];
    const awaited = ts.isReturnStatement(returned) && returned.expression;
    const call = ts.isAwaitExpression(awaited ?? {}) && awaited.expression;
    const input = ts.isCallExpression(call ?? {}) && call.arguments[0];
    if (
      call.expression?.getText(file) !== "client.requestJson" ||
      call.arguments.length !== 1 ||
      !ts.isObjectLiteralExpression(input ?? {})
    ) {
      throw new Error("Unknown Inbox unread request.");
    }
    const urls = input.properties.filter(
      (node) => node.name?.getText(file) === "url"
    );
    const expected = syntax(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compare the literal product TypeScript query expression.
      'const url = buildSpaceInboxUnreadTargetsPath(params.spaceId) + (query.size ? `?${query}` : "");',
      "expected.ts"
    ).statements[0].declarationList.declarations[0].initializer;
    if (
      urls.length !== 1 ||
      !ts.isPropertyAssignment(urls[0]) ||
      tokens(urls[0].initializer) !== tokens(expected)
    ) {
      throw new Error("Unknown Inbox unread URL.");
    }
    replacements.set(
      urls[0].initializer,
      ts.factory.createBinaryExpression(
        ts.factory.createCallExpression(
          ts.factory.createIdentifier("buildSpaceInboxUnreadTargetsPath"),
          undefined,
          [
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier("params"),
              "spaceId"
            ),
          ]
        ),
        ts.SyntaxKind.PlusToken,
        ts.factory.createParenthesizedExpression(
          ts.factory.createConditionalExpression(
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier("input"),
              "includeItemIds"
            ),
            undefined,
            ts.factory.createStringLiteral("?includeItemIds=true"),
            undefined,
            ts.factory.createStringLiteral("")
          )
        )
      )
    );
  } else if (statements.length !== 2) {
    throw new Error("Unknown Inbox unread query statements.");
  }
  // All other methods, imports, globals, options and response readers remain
  // part of this complete module comparison.
  return replacedModuleTokens(file, replacements);
}

function assertUnreadSourcePassthrough(file, side) {
  const owner = named(
    file,
    side === "core" ? "rpcGetSpaceInboxUnreadTargets" : "registerInboxRoutes"
  );
  const requests = [];
  const expectedCall = syntax(
    side === "core"
      ? "const call = prepared.service.spaceUnreadTargets;"
      : "const call = c.var.coreRpc.getSpaceInboxUnreadTargets;",
    "expected.ts"
  ).statements[0].declarationList.declarations[0].initializer;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      tokens(node.expression) === tokens(expectedCall)
    ) {
      requests.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  if (
    requests.length !== 1 ||
    requests[0].arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(requests[0].arguments[0])
  ) {
    throw new Error("Unknown unread source request.");
  }
  const input = requests[0].arguments[0];
  const flags = input.properties.filter((node) =>
    node.getText(file).includes("includeSourceKeys")
  );
  if (flags.length > 1) {
    throw new Error("Ambiguous unread source flag.");
  }
  if (flags.length) {
    const expected = syntax(
      side === "core"
        ? "const input = { includeSourceKeys: request.includeSourceKeys };"
        : 'const input = { ...(c.req.query("includeSourceKeys") === "true" ? { includeSourceKeys: true } : {}) };',
      "expected.ts"
    ).statements[0].declarationList.declarations[0].initializer.properties[0];
    if (tokens(flags[0]) !== tokens(expected)) {
      throw new Error("Unknown unread source passthrough.");
    }
  }
}

function assertExclusiveSourceReadBindings(file) {
  const owner = named(file, "rpcMutateSpaceInboxRead");
  const delegates = [];
  const findDelegate = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === "resolveReadCandidates"
    ) {
      delegates.push(node);
    }
    ts.forEachChild(node, findDelegate);
  };
  findDelegate(owner);
  if (delegates.length > 1) {
    throw new Error("Ambiguous source-read delegate.");
  }
  if (delegates.length === 1) {
    const expected = syntax(
      `const request = {
      resolveReadCandidates: async (sources) => {
        const space = resolveSpaceStub(env.OPENMELD_SPACES, request.body.spaceId);
        if (!space) {
          throw new InboxServiceError({ code: "inbox.space_not_found", status: 404, message: "This Space is unavailable." });
        }
        return inboxSourceCandidateSchema.array().parse(await space.rpcGetSpaceInboxReadCandidates({
          spaceId: request.body.spaceId, organizationId: prepared.organizationId,
          recipientUserId: prepared.userId, sources,
        }));
      },
    };`,
      "expected.ts"
    ).statements[0].declarationList.declarations[0].initializer.properties[0];
    const call = delegates[0].parent.parent;
    if (
      tokens(delegates[0]) !== tokens(expected) ||
      !ts.isCallExpression(call) ||
      call.expression.getText(file) !== "mutateSpaceInboxRead" ||
      call.arguments.length !== 1 ||
      call.arguments[0] !== delegates[0].parent
    ) {
      throw new Error("Unknown source-read passthrough.");
    }
  }
  for (const [name, module] of [
    ["inboxSourceCandidateSchema", "@openmeld/schemas"],
    ["resolveSpaceStub", "../../../rpc/space-ref"],
  ]) {
    const bindings = file.statements
      .filter(ts.isImportDeclaration)
      .flatMap((node) => {
        const namedImports = node.importClause?.namedBindings;
        return namedImports && ts.isNamedImports(namedImports)
          ? namedImports.elements
              .filter((binding) => binding.name.text === name)
              .map((binding) => ({ node, binding }))
          : [];
      });
    if (bindings.length === 0) {
      if (delegates.length) {
        throw new Error("Missing source-read import binding.");
      }
      continue;
    }
    if (!delegates.length) {
      throw new Error("Source-read binding has no verified delegate.");
    }
    const { node, binding } = bindings[0];
    if (
      bindings.length !== 1 ||
      node.moduleSpecifier.text !== module ||
      node.attributes ||
      node.importClause.isTypeOnly ||
      binding.isTypeOnly ||
      binding.propertyName
    ) {
      throw new Error("Unknown source-read import binding.");
    }
    rejectLocalTargetBindings(owner, new Set([name]));
    const uses = [];
    const visit = (child) => {
      if (
        ts.isIdentifier(child) &&
        child.text === name &&
        child !== binding.name
      ) {
        uses.push(child);
      }
      ts.forEachChild(child, visit);
    };
    visit(file);
    if (
      uses.length !== 1 ||
      uses[0].pos < delegates[0].pos ||
      uses[0].end > delegates[0].end
    ) {
      throw new Error("Source-read binding escapes its read delegate.");
    }
  }
  return delegates[0];
}
function assertTargetDependencies(declaration) {
  const allowed = new Set([
    ...TARGET_DECLARATIONS,
    "z",
    "daemonServiceLaneSchema",
    "slackMessagePermalinkSchema",
    "target",
    "context",
    "undefined",
  ]);
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) ||
          ts.isPropertyAssignment(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isParameter(parent)) &&
        parent.name === node
      ) {
        return;
      }
      if (!allowed.has(node.text)) {
        throw new Error(`Unknown Inbox target dependency: ${node.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.initializer);
}

function normalizeCoreProjection(file) {
  const projection = named(file, "projectReplyToRecipientForReceiver");
  const parameter = projection.parameters.find(
    (value) => value.name.getText(file) === "includeMembershipNotices"
  );
  if (parameter) {
    assertMembershipHelper(
      file,
      "projectMembershipNoticeForReceiver",
      "supported?: boolean",
      "supported !== true"
    );
    const expected = syntax(
      "function projection(includeMembershipNotices?: boolean) {}",
      CORE_RPC
    ).statements[0].parameters[0];
    if (
      projection.parameters.length !== 4 ||
      parameter !== projection.parameters[3] ||
      tokens(parameter) !== tokens(expected)
    ) {
      throw new Error("Unknown membership projection parameter.");
    }
    const statements = [...projection.body.statements];
    for (const [index, source] of [
      [
        0,
        "const projected = projectMembershipNoticeForReceiver(item, includeMembershipNotices);",
      ],
      [1, "const { sourceFacts: _sourceFacts, ...legacyItem } = projected;"],
      [
        2,
        "const compatibleItem = includeSourceFacts === true ? projected : legacyItem;",
      ],
    ]) {
      assertStatement(statements[index], source);
    }
    const destructure = statements[1],
      compatible = statements[2];
    const replaceInitializer = (statement, initializer) =>
      ts.factory.updateVariableStatement(
        statement,
        statement.modifiers,
        ts.factory.updateVariableDeclarationList(statement.declarationList, [
          ts.factory.updateVariableDeclaration(
            statement.declarationList.declarations[0],
            statement.declarationList.declarations[0].name,
            undefined,
            undefined,
            initializer
          ),
        ])
      );
    statements[1] = replaceInitializer(
      destructure,
      ts.factory.createIdentifier("item")
    );
    const value = compatible.declarationList.declarations[0].initializer;
    statements[2] = replaceInitializer(
      compatible,
      ts.factory.updateConditionalExpression(
        value,
        value.condition,
        value.questionToken,
        ts.factory.createIdentifier("item"),
        value.colonToken,
        value.whenFalse
      )
    );
    statements.shift();
    return transformedTokens(
      projection,
      ts.factory.updateFunctionDeclaration(
        projection,
        projection.modifiers,
        projection.asteriskToken,
        projection.name,
        projection.typeParameters,
        projection.parameters.slice(0, 3),
        projection.type,
        ts.factory.updateBlock(projection.body, statements)
      )
    );
  }
  return tokens(projection);
}
function normalizeGatewayProjection(file) {
  const projection = named(file, "projectInboxItemForClient"),
    statement = projection.body.statements[0];
  const declaration =
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations[0];
  const input = declaration?.initializer;
  const item =
    ts.isObjectLiteralExpression(input ?? {}) &&
    input.properties.find((value) => value.name?.getText(file) === "item");
  const pluginCall = ts.isPropertyAssignment(item ?? {}) && item.initializer;
  const wrapper =
    ts.isCallExpression(pluginCall ?? {}) && pluginCall.arguments[0];
  if (
    ts.isCallExpression(wrapper ?? {}) &&
    wrapper.expression.getText(file) === "projectMembershipNoticeForClient"
  ) {
    assertMembershipHelper(
      file,
      "projectMembershipNoticeForClient",
      "version: InboxItemKindClientVersion",
      'version !== "current"'
    );
    assertStatement(
      statement,
      "const input = { ...value, item: projectPluginRequestForClient(projectMembershipNoticeForClient(value.item, value.itemKindVersion), value.sourceTargetVersion) };"
    );
    const call = ts.factory.updateCallExpression(
      pluginCall,
      pluginCall.expression,
      pluginCall.typeArguments,
      [wrapper.arguments[0], pluginCall.arguments[1]]
    );
    const object = ts.factory.updateObjectLiteralExpression(
      input,
      input.properties.map((property) =>
        property === item
          ? ts.factory.updatePropertyAssignment(item, item.name, call)
          : property
      )
    );
    const updated = ts.factory.updateVariableStatement(
      statement,
      statement.modifiers,
      ts.factory.updateVariableDeclarationList(statement.declarationList, [
        ts.factory.updateVariableDeclaration(
          declaration,
          declaration.name,
          declaration.exclamationToken,
          declaration.type,
          object
        ),
      ])
    );
    return transformedTokens(
      projection,
      ts.factory.updateFunctionDeclaration(
        projection,
        projection.modifiers,
        projection.asteriskToken,
        projection.name,
        projection.typeParameters,
        projection.parameters,
        projection.type,
        ts.factory.updateBlock(projection.body, [
          updated,
          ...projection.body.statements.slice(1),
        ])
      )
    );
  }
  return tokens(projection);
}
function assertMembershipHelper(file, name, parameter, condition) {
  const expected = syntax(
    `function ${name}(item: InboxItem, ${parameter}): InboxItem { return item.kind === "space_joined" && ${condition} ? { ...item, kind: "system_issue" } : item; }`,
    file.fileName
  );
  if (tokens(named(file, name)) !== tokens(named(expected, name))) {
    throw new Error("Unknown membership target projection.");
  }
}
function assertStatement(node, source) {
  if (
    !node ||
    tokens(node) !== tokens(syntax(source, "expected.ts").statements[0])
  ) {
    throw new Error("Unknown Inbox target projection structure.");
  }
}
function transformedTokens(original, updated) {
  const printer = ts.createPrinter({ removeComments: true });
  return tokens(
    syntax(
      printer.printNode(
        ts.EmitHint.Unspecified,
        updated,
        original.getSourceFile()
      ),
      "normalized.ts"
    ).statements[0]
  );
}

function compareTargetTransports(core, gateway) {
  const expression = (source) =>
    syntax(`const value = ${source};`, "expected.ts").statements[0]
      .declarationList.declarations[0].initializer;
  const coreCallbacks = [
    "response => ({ ...response, rows: response.rows.map(row => ({ ...row, item: projectMembershipNoticeForReceiver(row.item, includeMembershipNotices) })) })",
    "response => ({ ...response, items: response.items.map(item => projectMembershipNoticeForReceiver(item, request.includeMembershipNotices)) })",
  ].map((source) => tokens(expression(source)));
  const observer = expression(
    "async () => { const response = await c.var.coreRpc.observeInboxNotifications({ includeMembershipNotices: true, ...query.data, context: buildCoreRpcContext(c) }); return { ...response, items: response.items.map(item => projectMembershipNoticeForClient(item, resolveInboxItemKindVersion(c))) }; }"
  );
  const legacyObserver = expression(
    "() => c.var.coreRpc.observeInboxNotifications({ ...query.data, context: buildCoreRpcContext(c) })"
  );
  const normalize = (original, side) => {
    const transformed = ts.transform(original, [
      (context) => {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Only the listed complete membership syntax structures can disappear from this transport comparison.
        const rewrite = (node) => {
          if (
            side === "gateway" &&
            ts.isArrowFunction(node) &&
            tokens(node) === tokens(observer)
          ) {
            return legacyObserver;
          }
          if (ts.isCallExpression(node)) {
            if (
              side === "core" &&
              ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "then" &&
              node.arguments.length === 1 &&
              coreCallbacks.includes(tokens(node.arguments[0]))
            ) {
              return ts.visitNode(node.expression.expression, rewrite);
            }
            if (
              side === "gateway" &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === "projectMembershipNoticeForClient"
            ) {
              if (
                ![
                  "projectMembershipNoticeForClient(row.item, resolveInboxItemKindVersion(c))",
                  "projectMembershipNoticeForClient(item, resolveInboxItemKindVersion(c))",
                ].some((source) => tokens(node) === tokens(expression(source)))
              ) {
                throw new Error("Unknown membership target call.");
              }
              return ts.visitNode(node.arguments[0], rewrite);
            }
            if (
              side === "core" &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === "projectReplyToRecipientForReceiver" &&
              node.arguments.length === 4
            ) {
              if (
                tokens(node.arguments[3]) !==
                tokens(expression("request.includeMembershipNotices"))
              ) {
                throw new Error("Unknown Inbox target caller.");
              }
              return ts.factory.updateCallExpression(
                node,
                node.expression,
                node.typeArguments,
                node.arguments.slice(0, 3)
              );
            }
            if (
              side === "gateway" &&
              ts.isPropertyAccessExpression(node.expression) &&
              [
                "listInboxFeed",
                "listInboxItems",
                "getInboxItem",
                "markInboxItemRead",
              ].includes(node.expression.name.text) &&
              node.expression.expression.getText(original.getSourceFile()) ===
                "c.var.coreRpc"
            ) {
              const input = node.arguments[0];
              if (
                node.arguments.length !== 1 ||
                !ts.isObjectLiteralExpression(input ?? {})
              ) {
                throw new Error("Unknown Inbox target request.");
              }
              const flags = input.properties.filter(
                (property) =>
                  property.name?.getText(original.getSourceFile()) ===
                  "includeMembershipNotices"
              );
              if (
                flags.length > 1 ||
                (flags.length === 1 &&
                  tokens(flags[0]) !==
                    tokens(
                      expression("({ includeMembershipNotices: true })")
                        .expression.properties[0]
                    ))
              ) {
                throw new Error("Unknown membership opt-in.");
              }
              const updated = ts.factory.updateCallExpression(
                node,
                node.expression,
                node.typeArguments,
                [
                  ts.factory.updateObjectLiteralExpression(
                    input,
                    input.properties.filter(
                      (property) => !flags.includes(property)
                    )
                  ),
                ]
              );
              return ts.visitEachChild(updated, rewrite, context);
            }
          }
          if (
            side === "core" &&
            ts.isVariableStatement(node) &&
            node.declarationList.declarations[0]?.name.getText(
              original.getSourceFile()
            ) === "{ context, includeMembershipNotices, ...query }"
          ) {
            assertStatement(
              node,
              "const { context, includeMembershipNotices, ...query } = parseRequest(listInboxFeedRpcInputSchema, input);"
            );
            return syntax(
              "const { context, ...query } = parseRequest(listInboxFeedRpcInputSchema, input);",
              "expected.ts"
            ).statements[0];
          }
          return ts.visitEachChild(node, rewrite, context);
        };
        return (node) => ts.visitNode(node, rewrite);
      },
    ]);
    try {
      return transformedTokens(original, transformed.transformed[0]);
    } finally {
      transformed.dispose();
    }
  };
  for (const name of [
    "rpcListInboxFeed",
    "rpcObserveInboxNotifications",
    "rpcListInboxItems",
    "rpcGetInboxItem",
    "rpcMarkInboxItemRead",
  ]) {
    const values = core.map((file) => normalize(named(file, name), "core"));
    if (values[0] !== values[1]) {
      return false;
    }
  }
  if (
    !["parseRequest", "parseResponse", "prepareRequest", "runService"].every(
      (name) => sameNamed(core, name)
    )
  ) {
    return false;
  }
  const routeNames = [
    "INBOX_ROUTE",
    "INBOX_FEED_ROUTE",
    "INBOX_ITEM_ROUTE",
    "INBOX_ITEM_READ_ROUTE",
  ];
  if (!routeNames.every((name) => sameNamed(gateway, name))) {
    return false;
  }
  const registrations = gateway.map((file) => {
    const owner = named(file, "registerInboxRoutes");
    rejectLocalTargetBindings(
      owner,
      new Set([
        ...GATEWAY_PROJECTIONS,
        "projectInboxItemForClient",
        "projectMembershipNoticeForClient",
        "executeRpcRoute",
        "buildCoreRpcContext",
        "readJsonRequestBody",
        "invalidPayloadResponse",
        "resolveInboxItemKindVersion",
        "inboxFeedResponseSchema",
        "inboxFeedQuerySchema",
        "inboxNotificationObservationsResponseSchema",
        "inboxNotificationObservationsQuerySchema",
        "getInboxItemResponseSchema",
        "getInboxItemWireResponseSchema",
        "listInboxItemsResponseSchema",
        "listInboxItemsWireResponseSchema",
        "markInboxItemReadResponseSchema",
        "markInboxItemReadWireResponseSchema",
      ])
    );
    return [
      owner.parameters.map(tokens),
      owner.type && tokens(owner.type),
      owner.body.statements.map((statement) => {
        const call =
          ts.isExpressionStatement(statement) && statement.expression;
        if (
          !(
            ts.isCallExpression(call) &&
            ts.isPropertyAccessExpression(call.expression) &&
            ts.isIdentifier(call.expression.expression) &&
            call.expression.expression.text === "app" &&
            ["get", "post", "put", "delete", "patch"].includes(
              call.expression.name.text
            ) &&
            call.arguments.length === 2 &&
            ts.isArrowFunction(call.arguments[1])
          )
        ) {
          throw new Error("Unknown local Inbox route statement.");
        }
        return [tokens(call.expression), tokens(call.arguments[0])];
      }),
    ];
  });
  if (!isDeepStrictEqual(registrations[0], registrations[1])) {
    return false;
  }
  const routes = gateway.map((file) =>
    named(file, "registerInboxRoutes")
      .body.statements.filter(
        (statement) =>
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          (routeNames.includes(
            statement.expression.arguments[0]?.getText(file)
          ) ||
            statement.expression.arguments[0]?.getText(file) ===
              // biome-ignore lint/suspicious/noTemplateCurlyInString: This is the literal TypeScript source expression being checked.
              "`${INBOX_ROUTE}/notification-observations`")
      )
      .map((statement) => normalize(statement.expression, "gateway"))
  );
  return (
    routes[0].length === 5 &&
    routes[1].length === 5 &&
    isDeepStrictEqual(routes[0], routes[1])
  );
}

function assertBindingsAndExports(sha, read) {
  for (const file of TYPESCRIPT_LEAVES) {
    if (
      parseUnambiguousConfig(file, read(sha, file)).extends !==
      "../../tooling/typescript-config/base.jsonc"
    ) {
      throw new Error("Unknown Inbox config inheritance.");
    }
  }
  for (const file of [TYPESCRIPT_PARENT, "clients/web/tsconfig.json"]) {
    if (parseUnambiguousConfig(file, read(sha, file)).extends !== undefined) {
      throw new Error("Unknown Inbox config parent.");
    }
  }
  const coreFile = "services/core/wrangler.jsonc",
    gatewayFile = "services/gateway/wrangler.jsonc";
  const core = parseUnambiguousConfig(coreFile, read(sha, coreFile)),
    gateway = parseUnambiguousConfig(gatewayFile, read(sha, gatewayFile));
  const binding = gateway.env?.prod?.services?.filter(
    (entry) => entry.binding === "OPENMELD_CORE_WORKER"
  );
  if (
    core.main !== "src/index.ts" ||
    core.name !== "openmeld-core" ||
    !core.env?.prod ||
    core.env.prod.main ||
    core.env.prod.name ||
    core.legacy_env === false ||
    gateway.main !== "src/index.ts" ||
    gateway.env?.prod?.main ||
    binding?.length !== 1 ||
    binding[0].service !== "openmeld-core-prod" ||
    binding[0].entrypoint !== "GatewayRpcEntrypoint"
  ) {
    throw new Error("Unknown Inbox production binding.");
  }
  const exported = syntax(read(sha, INBOX), INBOX)
    .statements.filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
    )
    .flatMap((node) =>
      [...node.declarationList.declarations].map(
        (declaration) => declaration.name.text
      )
    );
  for (const [file, owner] of [
    ["packages/schemas/src/index.ts", "./schemas/index"],
    ["packages/schemas/src/schemas/index.ts", "./http/inbox"],
  ]) {
    const statements = syntax(read(sha, file), file).statements;
    const stars = statements.filter(
      (node) =>
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        !node.exportClause &&
        node.moduleSpecifier?.text === owner
    );
    if (
      stars.length !== 1 ||
      stars[0].attributes ||
      statements.some(
        (node) =>
          ts.isExportDeclaration(node) &&
          !node.isTypeOnly &&
          node.exportClause?.elements?.some(
            (binding) =>
              !binding.isTypeOnly && exported.includes(binding.name.text)
          )
      )
    ) {
      throw new Error("Ambiguous Inbox schema export binding.");
    }
  }
  const api = syntax(
    read(sha, "packages/api-client/src/index.ts"),
    "api-index.ts"
  );
  for (const [name, owner] of [
    ["createInboxApi", "./inbox/api"],
    ["createOpenMeldApiClient", "./client"],
    ["isInboxItemVisibleConversation", "./inbox/notification-policy"],
  ]) {
    const exports = api.statements.flatMap((node) =>
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements
            .filter(
              (binding) => !binding.isTypeOnly && binding.name.text === name
            )
            .map((binding) => [node, binding])
        : []
    );
    if (
      exports.length !== 1 ||
      exports[0][0].moduleSpecifier?.text !== owner ||
      exports[0][0].attributes ||
      exports[0][1].propertyName
    ) {
      throw new Error("Unknown Inbox API export binding.");
    }
  }
}
function compareInboxEntrypoints(files) {
  const imports = [
    "WorkerEntrypoint",
    "withPostgresRequest",
    "tracing",
    ...TARGET_METHODS.map(
      (name) => `rpc${name[0].toUpperCase()}${name.slice(1)}`
    ),
  ];
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep import, class registration, inheritance and delegate rejection in one finite signature.
  const signature = (file) => {
    const importTable = file.statements
      .filter(ts.isImportDeclaration)
      .flatMap((node) =>
        node.importClause?.isTypeOnly ||
        !ts.isNamedImports(node.importClause?.namedBindings ?? {})
          ? []
          : node.importClause.namedBindings.elements
              .filter(
                (binding) =>
                  !binding.isTypeOnly && imports.includes(binding.name.text)
              )
              .map((binding) => [
                binding.name.text,
                binding.propertyName?.text,
                node.moduleSpecifier.text,
              ])
      );
    if (
      imports.some(
        (name) => importTable.filter(([local]) => local === name).length !== 1
      )
    ) {
      throw new Error("Unknown Inbox RPC import.");
    }
    for (const [local, imported, module] of importTable) {
      let expected = "./inbox/transport/rpc/inbox-rpc";
      if (["WorkerEntrypoint", "tracing"].includes(local)) {
        expected = "cloudflare:workers";
      } else if (local === "withPostgresRequest") {
        expected = "@openmeld/db/postgresql";
      }
      if ((imported && imported !== local) || module !== expected) {
        throw new Error("Unknown Inbox RPC import binding.");
      }
    }
    if (
      file.statements.some(
        (node) =>
          ts.isExpressionStatement(node) ||
          (ts.isExportDeclaration(node) &&
            node.exportClause?.elements?.some((binding) =>
              ["CoreRpcEntrypoint", "GatewayRpcEntrypoint"].includes(
                binding.name.text
              )
            ))
      )
    ) {
      throw new Error("Unknown Inbox runtime registration.");
    }
    const members = [];
    for (const name of ["CoreRpcEntrypoint", "GatewayRpcEntrypoint"]) {
      const classes = file.statements.filter(
        (node) => ts.isClassDeclaration(node) && node.name?.text === name
      );
      if (classes.length !== 1) {
        throw new Error("Unknown Inbox RPC registration.");
      }
      const declaration = classes[0],
        seen = new Set();
      for (const member of declaration.members) {
        if (
          !(
            ts.isMethodDeclaration(member) &&
            (ts.isIdentifier(member.name) ||
              ts.isPrivateIdentifier(member.name)) &&
            member.body
          ) ||
          seen.has(member.name.text) ||
          ["constructor", "env", "ctx"].includes(member.name.text) ||
          member.modifiers?.some(
            (modifier) => modifier.kind !== ts.SyntaxKind.AsyncKeyword
          )
        ) {
          throw new Error("Unknown Inbox RPC class structure.");
        }
        seen.add(member.name.text);
      }
      if (
        declaration.typeParameters?.length ||
        declaration.heritageClauses?.length !== 1 ||
        declaration.heritageClauses[0].getText(file) !==
          (name === "CoreRpcEntrypoint"
            ? "extends WorkerEntrypoint<CoreBindings>"
            : "extends CoreRpcEntrypoint") ||
        (name === "CoreRpcEntrypoint"
          ? declaration.modifiers?.length
          : declaration.modifiers?.length !== 1 ||
            declaration.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword)
      ) {
        throw new Error("Unknown Inbox RPC inheritance.");
      }
      for (const method of TARGET_METHODS) {
        const node = declaration.members.find(
          (member) => member.name.text === method
        );
        if (!node) {
          throw new Error("Missing Inbox RPC method.");
        }
        members.push(tokens(node));
      }
    }
    return [importTable, members];
  };
  return isDeepStrictEqual(signature(files[0]), signature(files[1]));
}
// The predicate sees only workHandoff. The exact rejection forwards the original
// message unchanged. The complete native module comparison below includes its
// failure notice, terminal-effects delegates and all original import bindings.
function normalizeNativeCodeRejection(file, read, context) {
  const owner = named(file, "submitRemoteAgentNativeDelivery");
  const imports = [
    "spaceCodeWorkHandoffSchema",
    "CODE_HANDOFF_RECEIVER_UNSUPPORTED_PUBLIC_COPY",
  ];
  const expected = syntax(
    `if (spaceCodeWorkHandoffSchema.safeParse(input.message.sourceSignalSnapshot?.workHandoff).success) {
    await rejectNativeDeliveryWithSpaceFailure({ ...input, failureCode: "space.handoff.code_receiver_unsupported", ledgerStatus: "failed", text: CODE_HANDOFF_RECEIVER_UNSUPPORTED_PUBLIC_COPY });
    return { shouldAck: true, status: "failed" };
  }`,
    "expected.ts"
  ).statements[0];
  const blocks = owner.body.statements.filter(
    (node) =>
      ts.isIfStatement(node) &&
      node.expression.getText(file).includes("spaceCodeWorkHandoffSchema")
  );
  const replacements = new Map();
  if (blocks.length > 1) {
    throw new Error("Ambiguous native handoff rejection.");
  }
  if (blocks.length) {
    const index = owner.body.statements.indexOf(blocks[0]);
    assertStatement(
      owner.body.statements[index - 1],
      "if (replayOutcome) { return replayOutcome; }"
    );
    assertStatement(
      owner.body.statements[index + 1],
      "const designationDb = getPostgresDatabase(input.env);"
    );
    if (tokens(blocks[0]) !== tokens(expected)) {
      throw new Error("Unknown native handoff rejection.");
    }
    replacements.set(blocks[0], undefined);
    assertNativePredicateExports(read, context.sourceSha);
  }
  for (const name of imports) {
    const found = file.statements
      .filter(ts.isImportDeclaration)
      .flatMap((node) => {
        const bindings = node.importClause?.namedBindings;
        return bindings && ts.isNamedImports(bindings)
          ? bindings.elements
              .filter((binding) => binding.name.text === name)
              .map((binding) => ({ node, binding }))
          : [];
      });
    if (found.length !== blocks.length) {
      throw new Error("Missing or ambiguous native predicate binding.");
    }
    if (!found.length) {
      continue;
    }
    const { node, binding } = found[0];
    if (
      node.moduleSpecifier.text !== "@openmeld/schemas" ||
      node.attributes ||
      node.importClause.isTypeOnly ||
      binding.isTypeOnly ||
      binding.propertyName
    ) {
      throw new Error("Unknown native predicate import.");
    }
    rejectLocalTargetBindings(
      owner,
      new Set([name, "rejectNativeDeliveryWithSpaceFailure"])
    );
    const uses = [];
    const visit = (child) => {
      if (
        ts.isIdentifier(child) &&
        child.text === name &&
        child !== binding.name
      ) {
        uses.push(child);
      }
      ts.forEachChild(child, visit);
    };
    visit(file);
    if (
      uses.length !== 1 ||
      uses[0].pos < blocks[0].pos ||
      uses[0].end > blocks[0].end
    ) {
      throw new Error("Native predicate binding escapes its rejection.");
    }
    const existing = replacements.get(node) ?? node;
    replacements.set(
      node,
      ts.factory.updateImportDeclaration(
        existing,
        existing.modifiers,
        ts.factory.updateImportClause(
          existing.importClause,
          false,
          existing.importClause.name,
          ts.factory.updateNamedImports(
            existing.importClause.namedBindings,
            existing.importClause.namedBindings.elements.filter(
              (element) => element.name.text !== name
            )
          )
        ),
        existing.moduleSpecifier,
        existing.attributes
      )
    );
  }
  return replacements;
}
function assertNativePredicateExports(read, sha) {
  const index = syntax(
    read(sha, "packages/schemas/src/index.ts"),
    "schema-index.ts"
  );
  for (const [name, module] of [
    ["spaceCodeWorkHandoffSchema", "./space-work-handoff"],
    [
      "CODE_HANDOFF_RECEIVER_UNSUPPORTED_PUBLIC_COPY",
      "./public-agent-failure-reason",
    ],
  ]) {
    const bindings = index.statements.flatMap((node) =>
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements
            .filter((binding) => binding.name.text === name)
            .map((binding) => ({ node, binding }))
        : []
    );
    if (
      bindings.length !== 1 ||
      bindings[0].node.moduleSpecifier?.text !== module ||
      bindings[0].node.attributes ||
      bindings[0].binding.propertyName ||
      bindings[0].binding.isTypeOnly
    ) {
      throw new Error("Unknown native predicate export.");
    }
    const declaration = named(
      syntax(read(sha, `packages/schemas/src/${module.slice(2)}.ts`), module),
      name
    );
    if (
      !(
        ts.isVariableDeclaration(declaration) &&
        declaration.parent.parent.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
      )
    ) {
      throw new Error("Unknown native predicate declaration.");
    }
    if (
      name === "CODE_HANDOFF_RECEIVER_UNSUPPORTED_PUBLIC_COPY" &&
      !ts.isStringLiteral(declaration.initializer)
    ) {
      throw new Error("Unknown native rejection text.");
    }
    if (name === "spaceCodeWorkHandoffSchema") {
      // This read checks the actual binding. Its new version does not establish
      // receiver compatibility; the exact call never uses parsed output to form
      // a durable target, and the unchanged target-effect delegates remain read.
      const expected = syntax(
        `const schema = workHandoffV2BaseSchema.extend({
        code: executionContextProjectWorkSchema.required({ commit: true }),
        execution: z.strictObject({ workspace: z.enum(["current", "isolated"]), access: z.enum(["read_only", "workspace"]).optional() }),
      });`,
        "expected.ts"
      ).statements[0].declarationList.declarations[0].initializer;
      if (tokens(declaration.initializer) !== tokens(expected)) {
        throw new Error("Unknown native handoff predicate.");
      }
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Validate all four known time-context edits together before comparing the complete module.
function normalizeNativeTime(source, file, read, proofContext) {
  const parsed = syntax(source, file);
  const earlyRejection = normalizeNativeCodeRejection(
    parsed,
    read,
    proofContext
  );
  const context = named(parsed, "resolveTaskContinuationTurnContext");
  const delivery = named(parsed, "submitRemoteAgentTaskContinuationDelivery");
  const parameter = context.parameters[0];
  if (
    context.parameters.length !== 1 ||
    !ts.isTypeLiteralNode(parameter?.type ?? {})
  ) {
    throw new Error("Unknown retained-time input.");
  }
  const unique = (nodes, predicate) => {
    const matches = nodes.filter(predicate);
    if (matches.length !== 1) {
      throw new Error("Missing or ambiguous retained-time owner.");
    }
    return matches[0];
  };
  const property = (node, name) => node.name?.getText(parsed) === name;
  const typeMember = parameter.type.members.filter((node) =>
    property(node, "inheritedWorkerRequest")
  );
  const shared = unique(
    context.body.statements,
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((node) =>
        property(node, "sharedEnvelopeInput")
      )
  );
  const declaration = unique([...shared.declarationList.declarations], (node) =>
    property(node, "sharedEnvelopeInput")
  );
  if (
    shared.declarationList.declarations.length !== 1 ||
    !ts.isObjectLiteralExpression(declaration.initializer ?? {})
  ) {
    throw new Error("Unknown retained-time envelope.");
  }
  const timeMember = declaration.initializer.properties.filter((node) =>
    property(node, "requestTimeContext")
  );
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "resolveTaskContinuationTurnContext"
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(delivery.body);
  const call = unique(calls, () => true);
  if (
    call.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(call.arguments[0])
  ) {
    throw new Error("Unknown retained-time caller.");
  }
  const callerMember = call.arguments[0].properties.filter((node) =>
    property(node, "inheritedWorkerRequest")
  );
  const added = [typeMember.length, timeMember.length, callerMember.length];
  if (
    !(
      added.every((count) => count === 0) || added.every((count) => count === 1)
    )
  ) {
    throw new Error("Incomplete retained-time edit.");
  }
  const inherited = unique(
    delivery.body.statements,
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((node) =>
        property(node, "inheritedWorkerRequest")
      )
  );
  assertStatement(
    inherited,
    "const inheritedWorkerRequest = requireInheritedCenterAgentWorkerRequest(observer);"
  );
  const next =
    delivery.body.statements[delivery.body.statements.indexOf(inherited) + 1];
  if (!ts.isVariableStatement(next ?? {})) {
    throw new Error("Unknown retained-time declaration order.");
  }
  const nextName = next.declarationList.declarations[0]?.name.getText(parsed);
  if (
    added[0]
      ? nextName !== "{ author, targetProfile, turnEnvelope }"
      : nextName !== "request"
  ) {
    throw new Error("Unknown retained-time relocation.");
  }
  const replacements = new Map([...earlyRejection, [inherited, undefined]]);
  if (added[0]) {
    const expected = syntax(
      "type Input = { inheritedWorkerRequest: RemoteAgentWorkerSubmitTurnRequest }; const envelope = { requestTimeContext: input.inheritedWorkerRequest.turnEnvelope.requestTimeContext }; const caller = { inheritedWorkerRequest };",
      "expected.ts"
    );
    const expectedNodes = [
      expected.statements[0].type.members[0],
      expected.statements[1].declarationList.declarations[0].initializer
        .properties[0],
      expected.statements[2].declarationList.declarations[0].initializer
        .properties[0],
    ];
    for (const [index, members] of [
      typeMember,
      timeMember,
      callerMember,
    ].entries()) {
      if (tokens(members[0]) !== tokens(expectedNodes[index])) {
        throw new Error("Unknown retained-time structure.");
      }
    }
    replacements.set(
      parameter.type,
      ts.factory.updateTypeLiteralNode(
        parameter.type,
        parameter.type.members.filter((node) => node !== typeMember[0])
      )
    );
    replacements.set(
      declaration.initializer,
      ts.factory.updateObjectLiteralExpression(
        declaration.initializer,
        declaration.initializer.properties.filter(
          (node) => node !== timeMember[0]
        )
      )
    );
    replacements.set(
      call.arguments[0],
      ts.factory.updateObjectLiteralExpression(
        call.arguments[0],
        call.arguments[0].properties.filter((node) => node !== callerMember[0])
      )
    );
  }
  return replacedModuleTokens(parsed, replacements);
}

function normalizeStorageGuard(source, file) {
  const parsed = syntax(source, file);
  const owner = named(parsed, "ensureInboxItem");
  const parameter = owner.parameters[0];
  if (
    owner.parameters.length !== 1 ||
    !ts.isTypeLiteralNode(parameter?.type ?? {})
  ) {
    throw new Error("Unknown Inbox storage input.");
  }
  const guards = parameter.type.members.filter(
    (node) => node.name?.getText(parsed) === "sourceGuard"
  );
  const prepared = owner.body.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (node) => node.name.getText(parsed) === "prepared"
      )
  );
  if (
    prepared.length !== 1 ||
    prepared[0].declarationList.declarations.length !== 1
  ) {
    throw new Error("Unknown Inbox storage delegate.");
  }
  const initializer = prepared[0].declarationList.declarations[0].initializer;
  if (
    !(
      ts.isAwaitExpression(initializer ?? {}) &&
      ts.isCallExpression(initializer.expression)
    ) ||
    initializer.expression.expression.getText(parsed) !==
      "prepareEnsureInboxItemStatementsInRepo" ||
    initializer.expression.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(initializer.expression.arguments[0])
  ) {
    throw new Error("Unknown Inbox storage call.");
  }
  const input = initializer.expression.arguments[0];
  const forwards = input.properties.filter(
    (node) => node.name?.getText(parsed) === "sourceGuard"
  );
  if (
    !(
      (guards.length === 0 && forwards.length === 0) ||
      (guards.length === 1 && forwards.length === 1)
    )
  ) {
    throw new Error("Incomplete Inbox storage guard forwarding.");
  }
  const replacements = new Map();
  if (guards.length) {
    const expected = syntax(
      "type Input = { sourceGuard?: InboxSourceWriteGuard }; const input = { sourceGuard: input.sourceGuard };",
      "expected.ts"
    );
    if (
      tokens(guards[0]) !== tokens(expected.statements[0].type.members[0]) ||
      tokens(forwards[0]) !==
        tokens(
          expected.statements[1].declarationList.declarations[0].initializer
            .properties[0]
        )
    ) {
      throw new Error("Unknown Inbox storage guard structure.");
    }
    replacements.set(
      parameter.type,
      ts.factory.updateTypeLiteralNode(
        parameter.type,
        parameter.type.members.filter((node) => node !== guards[0])
      )
    );
    replacements.set(
      input,
      ts.factory.updateObjectLiteralExpression(
        input,
        input.properties.filter((node) => node !== forwards[0])
      )
    );
  }
  return replacedModuleTokens(parsed, replacements);
}

function replacedModuleTokens(parsed, replacements) {
  const transformed = ts.transform(parsed, [
    (transformation) => {
      const rewrite = (node) =>
        replacements.has(node)
          ? replacements.get(node)
          : ts.visitEachChild(node, rewrite, transformation);
      return (node) => ts.visitNode(node, rewrite);
    },
  ]);
  try {
    return tokens(
      syntax(
        ts.isSourceFile(parsed)
          ? ts
              .createPrinter({ removeComments: true })
              .printFile(transformed.transformed[0])
          : ts
              .createPrinter({ removeComments: true })
              .printNode(
                ts.EmitHint.Unspecified,
                transformed.transformed[0],
                parsed.getSourceFile()
              ),
        parsed.getSourceFile().fileName
      )
    );
  } finally {
    transformed.dispose();
  }
}
function compareParserLock(beforeSource, afterSource) {
  const locks = [beforeSource, afterSource].map((source) => {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) {
      throw new Error("Unknown Inbox lockfile.");
    }
    const lock = document.toJS();
    if (!(lock?.importers && lock.packages && lock.snapshots)) {
      throw new Error("Unknown Inbox lockfile structure.");
    }
    return lock;
  });
  const [before, after] = locks;
  for (const importer of [
    "packages/schemas",
    "packages/db",
    "packages/api-client",
    "packages/gateway-contract",
    "services/core",
    "services/gateway",
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
  return ["packages", "snapshots"].every((section) => {
    const resolutions = (lock) =>
      Object.fromEntries(
        Object.entries(lock[section]).filter(([name]) =>
          name.startsWith("zod@")
        )
      );
    return (
      Object.keys(resolutions(before)).length > 0 &&
      isDeepStrictEqual(resolutions(before), resolutions(after))
    );
  });
}

function compareParserWorkspace(...sources) {
  const projection = (source) => {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) {
      throw new Error("Unknown Inbox dependency configuration.");
    }
    const value = document.toJS();
    if (
      !value?.catalog?.zod ||
      value.catalogs ||
      Object.keys(value.overrides ?? {}).some(
        (name) =>
          name.includes("*") ||
          (name.includes("zod") && name !== "@modelcontextprotocol/sdk>zod")
      ) ||
      Object.keys(value.patchedDependencies ?? {}).some((name) =>
        name.includes("zod")
      ) ||
      Object.values(value.packageExtensions ?? {}).some(
        (extension) =>
          extension.dependencies?.zod || extension.peerDependencies?.zod
      )
    ) {
      throw new Error("Unknown Inbox parser resolution.");
    }
    return [
      value.packages,
      value.catalog.zod,
      value.overrides?.["@modelcontextprotocol/sdk>zod"],
    ];
  };
  return isDeepStrictEqual(projection(sources[0]), projection(sources[1]));
}
