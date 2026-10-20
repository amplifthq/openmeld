import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { spaceViewerMembershipDisplayQueryKey } from "#/query/spaces/viewer-membership-display";
import {
	useSpaceComposerMembershipState,
	useSpaceComposerTraysHeld,
} from "./use-space-composer-region";

afterEach(cleanup);

function createWrapper(client: QueryClient) {
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

it("paints with the saved membership until the members read confirms it", async () => {
	const client = new QueryClient();
	client.setQueryData(spaceViewerMembershipDisplayQueryKey("space", "human"), {
		version: 1,
		membership: "member",
	});
	const { result, rerender } = renderHook(
		(props: { confirmed: "member" | "nonmember" | "unknown" }) =>
			useSpaceComposerMembershipState({
				confirmed: props.confirmed,
				profileId: "human",
				spaceId: "space",
			}),
		{ initialProps: { confirmed: "unknown" }, wrapper: createWrapper(client) }
	);
	expect(result.current).toBe("member");

	rerender({ confirmed: "nonmember" });
	expect(result.current).toBe("nonmember");
	await waitFor(() =>
		expect(
			client.getQueryData(
				spaceViewerMembershipDisplayQueryKey("space", "human")
			)
		).toEqual({ version: 1, membership: "nonmember" })
	);
});

it("stays unknown without a saved membership", () => {
	const { result } = renderHook(
		() =>
			useSpaceComposerMembershipState({
				confirmed: "unknown",
				profileId: "human",
				spaceId: "space",
			}),
		{ wrapper: createWrapper(new QueryClient()) }
	);
	expect(result.current).toBe("unknown");
});

it("holds the trays until every tray read answers, then never holds again", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const queue = deferred<string[]>();
	const requests = deferred<string[]>();
	const { result } = renderHook(
		(props: { accessPending: boolean }) => {
			useQuery({
				queryKey: ["space-input-queue", "space", "human"],
				queryFn: () => queue.promise,
			});
			useQuery({
				queryKey: ["agent-access", "org", "list", { spaceId: "space" }],
				queryFn: () => requests.promise,
			});
			// Another Space's tray read does not hold this one.
			useQuery({
				queryKey: ["space-input-queue", "other-space", "human"],
				queryFn: () => new Promise<string[]>(() => undefined),
			});
			return useSpaceComposerTraysHeld({
				accessPending: props.accessPending,
				profileId: "human",
				spaceId: "space",
			});
		},
		{ initialProps: { accessPending: false }, wrapper: createWrapper(client) }
	);
	expect(result.current).toBe(true);

	await act(async () => {
		queue.resolve(["queued"]);
		await queue.promise;
	});
	expect(result.current).toBe(true);

	await act(async () => {
		requests.resolve([]);
		await requests.promise;
	});
	await waitFor(() => expect(result.current).toBe(false));

	await act(async () => {
		await client.invalidateQueries({
			queryKey: ["space-input-queue", "space", "human"],
		});
	});
	expect(result.current).toBe(false);
});

it("does not wait for a tray read that is retrying after a failure", async () => {
	const client = new QueryClient();
	let calls = 0;
	const { result } = renderHook(
		() => {
			useQuery({
				queryKey: ["space-input-queue", "space", "human"],
				queryFn: () => {
					calls += 1;
					return Promise.reject(new Error("Forbidden"));
				},
				retry: 3,
				retryDelay: 60_000,
			});
			return useSpaceComposerTraysHeld({
				accessPending: false,
				profileId: "human",
				spaceId: "space",
			});
		},
		{ wrapper: createWrapper(client) }
	);
	await waitFor(() => expect(result.current).toBe(false));
	expect(calls).toBe(1);
});

it("keeps the trays held while the composer bar is still pending", async () => {
	const client = new QueryClient();
	const { result, rerender } = renderHook(
		(props: { accessPending: boolean }) =>
			useSpaceComposerTraysHeld({
				accessPending: props.accessPending,
				profileId: "human",
				spaceId: "space",
			}),
		{ initialProps: { accessPending: true }, wrapper: createWrapper(client) }
	);
	expect(result.current).toBe(true);
	rerender({ accessPending: false });
	await waitFor(() => expect(result.current).toBe(false));
});
