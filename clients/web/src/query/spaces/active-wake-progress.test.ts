import { createWakeProgressItem } from "@openmeld/space";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { SPACE_WAKE_PROGRESS_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import {
	setSpaceWakeProgressPresentationItems,
	spaceActiveWakeProgressSummaryQueryOptions,
	spaceWakeProgressPresentationQueryOptions,
} from "./active-wake-progress";

const getActiveWakeProgressMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createWebSpaceApi: (...args: Parameters<typeof createWebSpaceApiMock>) =>
		createWebSpaceApiMock(...args),
}));

describe("spaceActiveWakeProgressSummaryQueryOptions", () => {
	it("keeps a cached summary for route returns and always revalidates without Stop enrichment", async () => {
		getActiveWakeProgressMock.mockResolvedValue({
			items: [],
			query: {
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: getActiveWakeProgressMock,
		});

		const options = spaceActiveWakeProgressSummaryQueryOptions({
			enabled: true,
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});
		await (options.queryFn as () => Promise<unknown>)();

		expect(options.queryKey).toEqual([
			"spaces",
			"active-wake-progress-summary",
			"space-123",
			"profile-123",
		]);
		expect(options.gcTime).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(options.staleTime).toBe(0);
		expect(options.refetchOnMount).toBe("always");
		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "profile-123",
		});
		expect(getActiveWakeProgressMock).toHaveBeenCalledWith({
			includeTiming: true,
			includeWakeStopEligibility: false,
			spaceId: "space-123",
			timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
		});
	});
});

describe("Space Wake progress presentation cache", () => {
	it("shows the same working item synchronously when the conversation remounts", () => {
		const queryClient = new QueryClient();
		const options = spaceWakeProgressPresentationQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});
		const compactConversation = new QueryObserver(queryClient, options);
		const stopObservingCompactConversation = compactConversation.subscribe(
			() => undefined
		);
		const workingItem = createWakeProgressItem({
			clientMessageId: "client-message-123",
			dispatchId: null,
			phase: "request_sent",
			sourceSignalId: "signal-123",
			targetLabel: "Center Agent",
			targetProfileId: "agent-123",
			updatedAtMs: 1_775_000_000_000,
		});

		setSpaceWakeProgressPresentationItems({
			items: [workingItem],
			queryClient,
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});
		expect(compactConversation.getCurrentResult().data).toEqual([workingItem]);

		stopObservingCompactConversation();
		const fullConversation = new QueryObserver(queryClient, options);
		expect(fullConversation.getCurrentResult().data).toEqual([workingItem]);

		fullConversation.destroy();
		queryClient.clear();
	});
});
