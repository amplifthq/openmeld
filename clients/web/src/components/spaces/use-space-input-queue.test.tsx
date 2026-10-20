import type { SpaceInputQueueResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type PendingOutgoingSignal,
	pendingOutgoingSignalsQueryKey,
} from "./space-pending-outgoing-signals";
import { useSpaceInputQueue } from "./use-space-input-queue";

const api = vi.hoisted(() => ({ readOrUpdate: vi.fn() }));
vi.mock("@openmeld/api-client", () => ({
	readOrUpdateSpaceInputQueue: api.readOrUpdate,
}));
vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: () => ({}),
}));

const item: SpaceInputQueueResponse["items"][number] = {
	inputId: "queued-follow-up",
	authorProfileId: "author",
	target: { dispatchId: "response", targetProfileId: "agt_claude" },
	text: "Also add a second line",
	state: "queued",
	blocked: false,
};
const pendingKey = pendingOutgoingSignalsQueryKey("space", "author", null);
let queryClient: QueryClient;

function renderQueue() {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			useSpaceInputQueue({
				spaceId: "space",
				profileId: "author",
				enabled: true,
			}),
		{ wrapper }
	);
}
function timelineIds() {
	return (
		queryClient.getQueryData<PendingOutgoingSignal[]>(pendingKey) ?? []
	).map((pending) => pending.clientMessageId);
}

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	api.readOrUpdate.mockReset();
});
afterEach(cleanup);

it("moves a sent message from the queue to the timeline at once", async () => {
	let respond!: (value: SpaceInputQueueResponse) => void;
	api.readOrUpdate.mockImplementation((_client, request) =>
		request.mutation
			? new Promise((resolve) => {
					respond = resolve;
				})
			: Promise.resolve({ items: [item] })
	);
	const { result } = renderQueue();
	await waitFor(() => expect(result.current.items).toHaveLength(1));
	let sent!: Promise<void>;
	act(() => {
		sent = result.current.sendNow(item);
	});
	await waitFor(() => expect(result.current.items).toHaveLength(0));
	expect(timelineIds()).toEqual([item.inputId]);
	api.readOrUpdate.mockResolvedValue({ items: [] });
	await act(async () => {
		respond({ items: [] });
		await sent;
	});
	expect(result.current.items).toHaveLength(0);
	// The timeline entry stays until the persisted message replaces it.
	expect(timelineIds()).toEqual([item.inputId]);
});

it("puts the message back in the queue when the agent does not take it", async () => {
	const rejected = { ...item, blocked: true };
	api.readOrUpdate.mockResolvedValue({ items: [item] });
	const { result } = renderQueue();
	await waitFor(() => expect(result.current.items).toHaveLength(1));
	api.readOrUpdate.mockResolvedValue({ items: [rejected] });
	await act(async () => {
		await expect(result.current.sendNow(item)).rejects.toThrow(
			"Couldn't send this message now. It's still queued."
		);
	});
	expect(result.current.items).toEqual([rejected]);
	expect(timelineIds()).toEqual([]);
});

it("rolls back when the request fails", async () => {
	api.readOrUpdate.mockImplementation((_client, request) =>
		request.mutation
			? Promise.reject(new Error("Couldn't connect."))
			: Promise.resolve({ items: [item] })
	);
	const { result } = renderQueue();
	await waitFor(() => expect(result.current.items).toHaveLength(1));
	await act(async () => {
		await expect(result.current.sendNow(item)).rejects.toThrow(
			"Couldn't connect."
		);
	});
	expect(result.current.items).toEqual([item]);
	expect(timelineIds()).toEqual([]);
});
