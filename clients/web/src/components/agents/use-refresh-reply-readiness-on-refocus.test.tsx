import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startQueryKeys } from "#/query/query-keys";
import { useRefreshReplyReadinessOnRefocus } from "./use-refresh-reply-readiness-on-refocus";

function setDocumentVisibility(visibilityState: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: visibilityState,
	});
	document.dispatchEvent(new Event("visibilitychange"));
}

function Harness(input: { enabled: boolean; storageScope: string }) {
	useRefreshReplyReadinessOnRefocus(input);
	return null;
}

function renderHarness(input: {
	enabled: boolean;
	queryClient: QueryClient;
	storageScope: string;
}) {
	return render(
		<QueryClientProvider client={input.queryClient}>
			<Harness enabled={input.enabled} storageScope={input.storageScope} />
		</QueryClientProvider>
	);
}

describe("useRefreshReplyReadinessOnRefocus", () => {
	beforeEach(() => {
		setDocumentVisibility("visible");
	});

	afterEach(() => {
		cleanup();
		setDocumentVisibility("visible");
		vi.restoreAllMocks();
	});

	it("re-checks reply readiness when the tab becomes visible again", () => {
		const queryClient = new QueryClient();
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue(undefined);

		renderHarness({ enabled: true, queryClient, storageScope: "scope-a" });
		invalidateQueries.mockClear();

		setDocumentVisibility("hidden");
		expect(invalidateQueries).not.toHaveBeenCalled();

		setDocumentVisibility("visible");
		expect(invalidateQueries).toHaveBeenCalledTimes(1);
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness("scope-a"),
		});
	});

	it("does not re-check while the readiness query is disabled", () => {
		const queryClient = new QueryClient();
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue(undefined);

		renderHarness({ enabled: false, queryClient, storageScope: "scope-a" });

		setDocumentVisibility("visible");
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("stops re-checking after the hook unmounts", () => {
		const queryClient = new QueryClient();
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue(undefined);

		const view = renderHarness({
			enabled: true,
			queryClient,
			storageScope: "scope-a",
		});
		invalidateQueries.mockClear();

		view.unmount();
		setDocumentVisibility("visible");
		expect(invalidateQueries).not.toHaveBeenCalled();
	});
});
