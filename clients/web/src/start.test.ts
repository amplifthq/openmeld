import { afterEach, describe, expect, it, vi } from "vitest";
import { startInstance } from "./start";

afterEach(() => vi.restoreAllMocks());

describe("Start error middleware", () => {
	it("retains server-function CSRF protection without blocking ordinary navigation", async () => {
		const options = await startInstance.getOptions();
		const csrf = options.requestMiddleware?.[1].options.server;
		if (!csrf) {
			throw new Error("Missing CSRF middleware");
		}
		const request = new Request("https://openmeld.ai/guide.md");
		const result = {
			request,
			pathname: "/guide.md",
			context: undefined,
			response: new Response("Guide"),
		};
		const next = vi.fn().mockResolvedValue(result);
		const routerResult = await csrf({ ...result, handlerType: "router", next });
		expect(routerResult).toBe(result);
		next.mockClear();
		const denied = await csrf({ ...result, handlerType: "serverFn", next });
		expect(denied).toBeInstanceOf(Response);
		expect((denied as Response).status).toBe(403);
		expect(next).not.toHaveBeenCalled();
	});

	it("logs a failed request without replacing its response or original exception", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const options = await startInstance.getOptions();
		const middleware = options.requestMiddleware?.[0].options.server;
		if (!middleware) {
			throw new Error("Missing error middleware");
		}
		const request = new Request("https://openmeld.ai/guide.md");
		const result = {
			request,
			pathname: "/guide.md",
			context: undefined,
			response: new Response(null, { status: 500 }),
		};
		expect(
			await middleware({
				...result,
				handlerType: "router",
				next: vi.fn().mockResolvedValue(result),
			})
		).toBe(result);
		expect(console.error).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "web.openmeld.application_error",
				status: 500,
			})
		);
		const error = new TypeError("Cannot read properties of undefined");
		await expect(
			middleware({
				...result,
				request: new Request(request),
				handlerType: "router",
				next: () => Promise.reject(error),
			})
		).rejects.toBe(error);
	});
});
