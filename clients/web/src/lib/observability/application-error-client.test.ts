import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import { webApplicationErrorReportSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRIVATE_CONTENT = /token|private|https/;

describe("browser application error reporting", () => {
	let dispose: (() => void) | undefined;
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
		);
	});
	afterEach(() => {
		dispose?.();
		dispose = undefined;
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("reports the incoming route and caught area without sending a URL or error text", async () => {
		const {
			recordApplicationErrorNavigation,
			reportCaughtComponentError,
			setApplicationErrorRouteReader,
		} = await import("./application-error-client");
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(1000)
			.mockReturnValue(1250);
		setApplicationErrorRouteReader(
			() => "/o/$orgSlug/_center-agent/chats/center-agent"
		);
		recordApplicationErrorNavigation("/o/$orgSlug/inbox");
		const error = new Error("private token from https://openmeld.ai/o/secret");
		reportCaughtComponentError(error, "space_conversation");
		const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
		expect(first).toMatchObject({
			routeId: "/o/$orgSlug/_center-agent/chats/center-agent",
			navigation: { fromRouteId: "/o/$orgSlug/inbox", elapsedMs: 250 },
			reactBoundary: "space_conversation",
		});
		expect(JSON.stringify(first)).not.toMatch(PRIVATE_CONTENT);
		reportCaughtComponentError(error, "space_conversation");
		expect(fetch).toHaveBeenCalledOnce();
		recordApplicationErrorNavigation("/o/private?token=private");
		reportCaughtComponentError(error, "markdown_editor");
		const second = JSON.parse(
			String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)
		);
		expect(second.navigation).toBeUndefined();
		expect(second.reactBoundary).toBe("markdown_editor");
	});

	it("attaches only recent fixed update labels to a React depth report", async () => {
		const { recordReactUpdate } = await import("./react-update-trace");
		const { reportClientApplicationError, submitApplicationErrorReport } =
			await import("./application-error-client");
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(100)
			.mockReturnValueOnce(110)
			.mockReturnValueOnce(120)
			.mockReturnValue(130);
		recordReactUpdate("composer_draft_set");
		recordReactUpdate("composer_editor_external_value");
		recordReactUpdate("space_timeline_agent_controller_changed");
		const error = new Error("Minified React error #185; private token");
		reportClientApplicationError(error, "react_caught");
		const body = String(vi.mocked(fetch).mock.calls[0]?.[1]?.body);
		expect(JSON.parse(body)).toMatchObject({
			error: { code: "react_update_depth" },
			reactUpdateTrace: [
				{ event: "composer_draft_set", ageMs: 30 },
				{ event: "composer_editor_external_value", ageMs: 20 },
				{ event: "space_timeline_agent_controller_changed", ageMs: 10 },
			],
		});
		expect(body).not.toMatch(PRIVATE_CONTENT);
		vi.spyOn(performance, "now").mockReturnValue(6200);
		await submitApplicationErrorReport(error);
		const manual = JSON.parse(
			String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)
		);
		expect(manual.submission).toBe("user");
		expect(manual.reactUpdateTrace).toEqual(JSON.parse(body).reactUpdateTrace);
		await submitApplicationErrorReport(
			new Error("Minified React error #185; a later private token")
		);
		expect(
			JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body))
				.reactUpdateTrace
		).toBeUndefined();
		reportClientApplicationError(new Error("ordinary failure"), "route");
		expect(
			JSON.parse(String(vi.mocked(fetch).mock.calls[3]?.[1]?.body))
				.reactUpdateTrace
		).toBeUndefined();
	});

	it("expires the previous route before a later error or manual report", async () => {
		const { recordApplicationErrorNavigation, submitApplicationErrorReport } =
			await import("./application-error-client");
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(1000)
			.mockReturnValue(601_001);
		recordApplicationErrorNavigation("/o/$orgSlug/inbox");
		await submitApplicationErrorReport(new Error("late failure"));
		const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
		expect(body.navigation).toBeUndefined();
	});

	it("retains the account read correlation in route and manually submitted reports", async () => {
		const { reportClientApplicationError, submitApplicationErrorReport } =
			await import("./application-error-client");
		const error = Object.assign(new Error("private response text"), {
			code: "network.timeout",
			operation: "account.organizationContext.read",
			requestId: "req-account-context",
		});
		reportClientApplicationError(error, "route");
		await submitApplicationErrorReport(error);
		for (const [, init] of vi.mocked(fetch).mock.calls) {
			const body = String(init?.body);
			expect(
				webApplicationErrorReportSchema.parse(JSON.parse(body)).query
			).toEqual({
				category: "account_organization_context",
				failure: {
					code: "network.timeout",
					requestId: "req-account-context",
					status: null,
				},
			});
			expect(body).not.toContain("private response text");
		}
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("reports the catch-up stage with API status, code, and request ID", async () => {
		const { reportClientQueryError } = await import(
			"./application-error-client"
		);
		reportClientQueryError(
			new OpenMeldApiClientHttpError({
				code: "auth.unauthenticated",
				message: "private response body",
				rawBody: "private response body",
				requestId: "req-catch-up-401",
				status: 401,
			}),
			"inbox",
			"persist"
		);
		const body = String(vi.mocked(fetch).mock.calls[0]?.[1]?.body);
		expect(
			webApplicationErrorReportSchema.parse(JSON.parse(body)).query
		).toEqual({
			category: "inbox",
			stage: "persist",
			failure: {
				code: "auth.unauthenticated",
				requestId: "req-catch-up-401",
				status: 401,
			},
		});
		expect(body).not.toContain("private response body");
	});

	it("captures resource and route failures without suppressing the original error", async () => {
		const {
			installApplicationErrorReporting,
			reportClientApplicationError,
			setApplicationErrorRouteReader,
		} = await import("./application-error-client");
		setApplicationErrorRouteReader(() => "/spaces/$spaceId");
		dispose = installApplicationErrorReporting();
		const error = new TypeError(
			"Failed to fetch dynamically imported module: https://openmeld.ai/assets/space-ab12.js?token=private"
		);
		const event = Object.assign(
			new Event("vite:preloadError", { cancelable: true }),
			{ payload: error }
		);
		window.dispatchEvent(event);
		reportClientApplicationError(error, "route");
		expect(event.defaultPrevented).toBe(false);
		expect(fetch).toHaveBeenCalledOnce();
		const [url, options] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe("/v1/observability/application-errors");
		expect(options).toMatchObject({
			credentials: "omit",
			keepalive: true,
			method: "POST",
		});
		const body = JSON.parse(String(options?.body));
		expect(body).toMatchObject({
			source: "preload",
			routeId: "/spaces/$spaceId",
			error: { code: "module_load_failed", frames: ["assets/space-ab12.js"] },
		});
		expect(String(options?.body)).not.toMatch(PRIVATE_CONTENT);
	});

	it("captures global errors, stops after a bounded number, and never retries failed delivery", async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError("network unavailable"));
		const { installApplicationErrorReporting } = await import(
			"./application-error-client"
		);
		dispose = installApplicationErrorReporting();
		for (let i = 0; i < 30; i++) {
			window.dispatchEvent(
				new ErrorEvent("error", {
					error: new Error(`Failure in assets/page-${i}.js:1:2`),
				})
			);
		}
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledTimes(20);
	});

	it("sends one sanitized record when Wake progress is rendered without confirmation", async () => {
		const { reportUnconfirmedWakeProgressPresentation } = await import(
			"./application-error-client"
		);
		const wakeProgress = {
			spaceId: "space-123",
			clientMessageId: "message-123",
			dispatchId: "dispatch-123",
			sourceSignalId: "signal-123",
			streamId: null,
			sourceThreadId: null,
			replyThreadRootSignalId: null,
			targetProfileId: "profile-123",
			phase: "running" as const,
			updatedAtMs: 100,
			fromRestoredPresentation: true,
			fromCachedSpaceSummary: true,
			fromCachedOwnSummary: false,
			fromBootstrapStream: false,
			fromHistoricalSignal: true,
			spaceSummaryFetchedAfterMount: false,
			ownSummaryFetchedAfterMount: false,
			bootstrapFetchedAfterMount: false,
		};
		reportUnconfirmedWakeProgressPresentation(wakeProgress);
		reportUnconfirmedWakeProgressPresentation(wakeProgress);
		expect(fetch).toHaveBeenCalledOnce();
		const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
		expect(body).toMatchObject({
			source: "wake_progress_presentation",
			error: { code: "unconfirmed_wake_progress_displayed" },
			wakeProgress,
		});
		expect(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).not.toMatch(
			PRIVATE_CONTENT
		);
		reportUnconfirmedWakeProgressPresentation({
			...wakeProgress,
			clientMessageId: null,
			streamId: "stream-123",
			fromRestoredPresentation: false,
			fromCachedSpaceSummary: false,
			fromBootstrapStream: true,
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(
			JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).wakeProgress
		).toMatchObject({ streamId: "stream-123", fromBootstrapStream: true });
		reportUnconfirmedWakeProgressPresentation({
			...wakeProgress,
			spaceId: "space-123?token=private",
		});
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("allows an explicit report after automatic capture and returns its searchable ID", async () => {
		const { reportClientApplicationError, submitApplicationErrorReport } =
			await import("./application-error-client");
		const error = new Error("private token in assets/page.js:12:34");
		reportClientApplicationError(error, "route");
		const id = await submitApplicationErrorReport(error);
		expect(fetch).toHaveBeenCalledTimes(2);
		const body = String(vi.mocked(fetch).mock.calls[1][1]?.body);
		expect(JSON.parse(body)).toMatchObject({
			id,
			submission: "user",
			source: "route",
			error: { frames: ["assets/page.js:12:34"] },
		});
		expect(body).not.toMatch(PRIVATE_CONTENT);
	});

	it("never claims successful manual delivery on rejection or a network failure", async () => {
		const { submitApplicationErrorReport } = await import(
			"./application-error-client"
		);
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 }));
		await expect(
			submitApplicationErrorReport(new Error("error"))
		).rejects.toThrow();
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Offline"));
		await expect(
			submitApplicationErrorReport(new Error("error"))
		).rejects.toThrow("Offline");
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
