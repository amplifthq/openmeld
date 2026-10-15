// @vitest-environment node
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// Compile the production function with the installed Start compiler, then use
// its real GET decoder, middleware, error serializer and final Start Response.
// Only environment values and the outbound Gateway HTTP boundary are fixtures.
// No database, listener, application backdoor or mock response-header setter.
const SOURCE_ALIAS = /^#\//;
const webRoot = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(path.join(webRoot, "package.json"));
const startRequire = createRequire(
	require.resolve("@tanstack/react-start/package.json")
);
const pluginRoot = path.dirname(
	startRequire.resolve("@tanstack/start-plugin-core/package.json")
);
const serverRequire = createRequire(
	startRequire.resolve("@tanstack/react-start-server/package.json")
);
const coreRoot = path.dirname(
	serverRequire.resolve("@tanstack/start-server-core/package.json")
);
const coreRequire = createRequire(path.join(coreRoot, "package.json"));
const clientRoot = path.dirname(
	coreRequire.resolve("@tanstack/start-client-core/package.json")
);
const storageRoot = path.dirname(
	coreRequire.resolve("@tanstack/start-storage-context/package.json")
);
const sourceFile = path.join(
	webRoot,
	"src/lib/spaces/public-space-initial-read.ts"
);
const providerId = `${sourceFile}?tss-serverfn-split`;
const spaceId = "space-response-fixture";
const messageText = "Authorized response fixture body";
const secret = "upstream-secret-must-not-escape";
let vite: ViteDevServer;
let invoke: (
	data: unknown
) => Promise<{ response: Response; value?: unknown; error?: unknown }>;
let denied = false;
let failed = false;
let text = messageText;
let requests: Request[] = [];

function gatewayResponse(request: Request): Response {
	requests.push(request);
	if (new URL(request.url).origin !== "https://gateway.openmeld.test") {
		throw new Error("Only the isolated Gateway fixture may be requested");
	}
	const pathname = new URL(request.url).pathname;
	if (pathname.endsWith("/entry-resolution")) {
		return Response.json({
			target: { spaceId },
			view: denied
				? { state: "unavailable" }
				: { state: "allowed", experience: "public" },
			participation: { state: denied ? "unavailable" : "self_join_available" },
			safeContext: {},
			recovery: null,
		});
	}
	if (failed) {
		return new Response(secret, { status: 503 });
	}
	if (pathname.endsWith("/status")) {
		return Response.json({
			spaceId,
			generatedAt: "2026-09-17T00:00:00.000Z",
			name: "Response fixture",
			accessMode: "public",
			passwordProtected: false,
			dispatchPolicy: { mode: "mention_only" },
			publicationMode: "collaboration",
			allowedActions: ["post_message", "post_status", "stay_silent"],
			resultArchivePolicy: { mode: "space_reply_only" },
			entryBrief: "default",
			dispatchBrief: "default",
			members: {
				totalCount: 1,
				humanCount: 1,
				agentCount: 0,
				liveNowCount: 0,
				liveHumanCount: 0,
				liveAgentCount: 0,
			},
		});
	}
	if (pathname.endsWith("/signals")) {
		return Response.json({
			signals: [
				{
					v: 1,
					id: "fixture-message",
					spaceId,
					ts: 1_800_000_000_000,
					profile: {
						kind: "human",
						profileId: "fixture-author",
						profileName: "Fixture",
					},
					type: "signal.text",
					data: { text },
				},
			],
			nextCursor: null,
		});
	}
	if (pathname.endsWith("/threads")) {
		return Response.json({ threads: [], previews: [] });
	}
	if (pathname.endsWith("/history-navigation")) {
		return Response.json({ entries: [], total: 1 });
	}
	throw new Error(`Unexpected Gateway request: ${pathname}`);
}

beforeAll(async () => {
	// Start does not export its compiler/HTTP dispatcher as public app APIs.
	// Resolve them from the installed package, never a hard-coded pnpm version.
	const { createStartCompiler } = await import(
		pathToFileURL(path.join(pluginRoot, "dist/esm/start-compiler/host.js")).href
	);
	const compiler = createStartCompiler({
		env: "server",
		envName: "ssr",
		providerEnvName: "ssr",
		root: webRoot,
		framework: "react",
		mode: "build",
		getKnownServerFns: () => ({}),
		// This provider directly imports Start. Other imports are external to
		// symbol discovery, not replaced in the executed production module.
		resolveId: async (id: string) => (id.startsWith("@tanstack/") ? id : null),
		loadModule: (id: string) => {
			throw new Error(`Unexpected indirect compiler import: ${id}`);
		},
	});
	vite = await createServer({
		root: webRoot,
		configFile: false,
		envFile: false,
		logLevel: "silent",
		server: { middlewareMode: true, watch: null, hmr: false },
		resolve: {
			alias: [{ find: SOURCE_ALIAS, replacement: `${webRoot}/src/` }],
		},
		ssr: {
			noExternal: [
				"@tanstack/start-server-core",
				"@tanstack/react-start-server",
			],
		},
		plugins: [
			{
				name: "public-space-response-fixture",
				enforce: "pre",
				resolveId(id) {
					return id === "#tanstack-start-server-fn-resolver" ? `\0${id}` : null;
				},
				load(id) {
					if (id === "\0#tanstack-start-server-fn-resolver") {
						return `import * as functions from ${JSON.stringify(providerId)};
						export function getServerFnById(id) {
							const fn = Object.values(functions).find(fn => fn.serverFnMeta?.id === id);
							if (!fn) throw new Error('Unknown fixture function');
							return fn;
						}`;
					}
					if (id === path.join(webRoot, "src/env.ts")) {
						return `export const env = {};
						export function getRequiredServerEnv(key) {
							return key === 'OPENMELD_GATEWAY_URL'
								? 'https://gateway.openmeld.test' : 'https://openmeld.test';
						}`;
					}
					return null;
				},
				async transform(code, id) {
					return id === providerId
						? await compiler.compile({ code, id })
						: null;
				},
			},
		],
	});
	const provider = await vite.ssrLoadModule(providerId);
	const functions = Object.values(provider) as Array<{
		serverFnMeta: { id: string };
	}>;
	if (functions.length !== 1) {
		throw new Error("Expected exactly one compiled public Space function");
	}
	const serverFnId = functions[0].serverFnMeta.id;
	const { handleServerAction, DeferredResponse } = await vite.ssrLoadModule(
		path.join(coreRoot, "dist/esm/server-functions-handler.js")
	);
	const { withStartRequest, finalizeResponse } = await vite.ssrLoadModule(
		path.join(coreRoot, "dist/esm/internal-request-response.js")
	);
	const { runWithStartContext } = await import(
		pathToFileURL(path.join(storageRoot, "dist/esm/index.js")).href
	);
	const { serverFnFetcher } = await import(
		pathToFileURL(
			path.join(clientRoot, "dist/esm/client-rpc/serverFnFetcher.js")
		).href
	);
	const handler = withStartRequest(
		async (request: Request, _options: unknown, event: unknown) => {
			const result = await runWithStartContext(
				{
					request,
					startOptions: {},
					contextAfterGlobalMiddlewares: {},
					executedRequestMiddlewares: new Set(),
					handlerType: "serverFn",
					getRouter: () => {
						throw new Error("A function read must not load the router");
					},
				},
				() => handleServerAction({ request, context: {}, serverFnId })
			);
			return result instanceof DeferredResponse
				? result.createResponse(event)
				: finalizeResponse(result, event);
		}
	);
	invoke = async (data) => {
		let response: Response | undefined;
		let value: unknown;
		let error: unknown;
		try {
			value = await runWithStartContext({ startOptions: {} }, () =>
				serverFnFetcher(
					`https://openmeld.test/_serverFn/${serverFnId}`,
					[
						{
							method: "GET",
							data,
							context: {},
						},
					],
					async (url: string, init: RequestInit) => {
						const finalResponse: Response = await handler(
							new Request(url, init),
							{}
						);
						response = finalResponse;
						return finalResponse.clone();
					}
				)
			);
			const envelope = value as { result?: unknown; error?: unknown };
			value = envelope.result;
			error = envelope.error;
		} catch (caught) {
			error = caught;
		}
		if (!response) {
			throw error ?? new Error("No final transport response");
		}
		return { response, value, error };
	};
}, 30_000);

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	denied = false;
	failed = false;
	text = messageText;
	requests = [];
});

afterAll(async () => {
	await vite?.close();
});

describe("public Space GET response boundary", () => {
	it.each([
		"allowed",
		"revoked",
		"invalid input",
		"upstream failure",
	])("keeps the final %s response private and non-cacheable", async (scenario) => {
		vi.stubGlobal(
			"fetch",
			vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
				Promise.resolve(gatewayResponse(new Request(input, init)))
			)
		);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		if (scenario === "revoked") {
			const previous = await invoke({ spaceId });
			expect(previous.error).toBeUndefined();
			expect(JSON.stringify(previous.value)).toContain(messageText);
			requests = [];
			denied = true;
		}
		failed = scenario === "upstream failure";
		const { response, value, error } = await invoke({
			spaceId: scenario === "invalid input" ? " " : spaceId,
		});
		// Start serializes function errors in its existing HTTP 200 envelope.
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("x-tss-serialized")).toBe("true");
		const body = await response.text();
		expect(body).not.toContain(secret);
		for (const request of requests) {
			expect(request.method).toBe("GET");
			expect(request.headers.get("cookie")).toBeNull();
		}
		if (scenario === "allowed") {
			expect(response.status).toBe(200);
			expect(error).toBeUndefined();
			expect(JSON.parse(value as string).content.signals[0].data.text).toBe(
				messageText
			);
			expect(body).toContain(messageText);
			text = "Updated response fixture body";
			expect(JSON.stringify((await invoke({ spaceId })).value)).toContain(text);
		} else {
			expect(body).not.toContain(messageText);
			if (scenario === "revoked") {
				expect(response.status).toBe(200);
				expect(error).toBeUndefined();
				expect(JSON.parse(value as string)).toEqual({
					entryResolution: expect.objectContaining({
						view: { state: "unavailable" },
					}),
				});
				expect(requests).toHaveLength(1);
			} else {
				expect(value).toBeUndefined();
				expect(error).toBeDefined();
				if (scenario === "invalid input") {
					expect(requests).toHaveLength(0);
					expect(body).toContain("spaceId");
				} else {
					expect(body).toContain("503");
					expect(requests.length).toBeGreaterThan(1);
				}
			}
		}
	});
});
