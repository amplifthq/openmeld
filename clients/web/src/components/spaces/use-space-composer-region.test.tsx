import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { spaceComposerTrayDisplayQueryKey } from "#/query/spaces/composer-tray-display";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	accountMemberSpacesDisplayQueryKey,
	spaceViewerMembershipDisplayQueryKey,
} from "#/query/spaces/viewer-membership-display";
import {
	useSpaceComposerTraySpace,
	useSpaceComposerTraysHeld,
	useSpaceViewerMembership,
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

function renderViewerMembership(
	client: QueryClient,
	confirmed: "member" | "nonmember" | "unknown" = "unknown"
) {
	return renderHook(
		(props: { confirmed: "member" | "nonmember" | "unknown" }) =>
			useSpaceViewerMembership({
				confirmed: props.confirmed,
				organizationId: "org",
				ownerAccountId: "account",
				profileId: "human",
				spaceId: "space",
			}),
		{ initialProps: { confirmed }, wrapper: createWrapper(client) }
	);
}

it("paints with the saved membership until the members read confirms it", async () => {
	const client = new QueryClient();
	client.setQueryData(spaceViewerMembershipDisplayQueryKey("space", "human"), {
		version: 1,
		membership: "member",
	});
	const { result, rerender } = renderViewerMembership(client);
	expect(result.current.membership).toBe("member");

	rerender({ confirmed: "nonmember" });
	expect(result.current.membership).toBe("nonmember");
	await waitFor(() =>
		expect(
			client.getQueryData(
				spaceViewerMembershipDisplayQueryKey("space", "human")
			)
		).toEqual({ version: 1, membership: "nonmember" })
	);
});

it("knows a member from the cached account Spaces list or member directory", () => {
	const listed = new QueryClient();
	listed.setQueryData(accountSpaceQueryKeys.items("human", "account"), {
		pinnedItems: [],
		spaceItems: [
			{
				joinedProfiles: [{ profileId: "human" }],
				spaceId: "space",
			},
		],
	});
	expect(renderViewerMembership(listed).result.current.membership).toBe(
		"member"
	);

	const directory = new QueryClient();
	directory.setQueryData(
		spaceQueryKeys.memberDirectoryDisplay("space", "human"),
		{ version: 1, members: [{ profileId: "human" }] }
	);
	expect(renderViewerMembership(directory).result.current.membership).toBe(
		"member"
	);
});

it("saves the account Spaces list and reads it back before the list loads again", async () => {
	const live = new QueryClient();
	live.setQueryData(accountSpaceQueryKeys.items("human", "account"), {
		pinnedItems: [],
		spaceItems: [
			{
				directMessageProfileIds: ["human", "agent"],
				joinedProfiles: [],
				spaceId: "space",
			},
		],
	});
	renderViewerMembership(live);
	await waitFor(() =>
		expect(
			live.getQueryData(accountMemberSpacesDisplayQueryKey("account", "org"))
		).toEqual({
			version: 1,
			spaces: [{ spaceId: "space", profileIds: ["agent", "human"] }],
		})
	);

	const refreshed = new QueryClient();
	refreshed.setQueryData(
		accountMemberSpacesDisplayQueryKey("account", "org"),
		live.getQueryData(accountMemberSpacesDisplayQueryKey("account", "org"))
	);
	expect(renderViewerMembership(refreshed).result.current.membership).toBe(
		"member"
	);
});

it("prefers the account Spaces list over a saved non-member state", () => {
	const client = new QueryClient();
	client.setQueryData(spaceViewerMembershipDisplayQueryKey("space", "human"), {
		version: 1,
		membership: "nonmember",
	});
	const { result } = renderViewerMembership(client);
	expect(result.current.membership).toBe("nonmember");
	act(() => {
		client.setQueryData(accountSpaceQueryKeys.items("human", "account"), {
			pinnedItems: [],
			spaceItems: [
				{
					directMessageProfileIds: ["human", "agent"],
					joinedProfiles: [],
					spaceId: "space",
				},
			],
		});
	});
	expect(result.current.membership).toBe("member");
});

it("stays unknown without cached data, then reads the Organization directory", () => {
	const client = new QueryClient();
	const { result } = renderViewerMembership(client);
	expect(result.current.membership).toBe("unknown");
	act(() => {
		client.setQueryData(organizationQueryKeys.spaces("org"), {
			spaces: [{ joined: false, spaceId: "space" }],
		});
	});
	expect(result.current.membership).toBe("nonmember");
});

it("returns the saved direct message Join prompt only for a non-member", () => {
	const client = new QueryClient();
	const join = {
		defaultName: "Tali and Codex",
		prompt: "Join to send",
		selectedNames: ["Felix"],
	};
	client.setQueryData(spaceViewerMembershipDisplayQueryKey("space", "human"), {
		version: 1,
		membership: "nonmember",
		directMessageJoin: join,
	});
	const { result, rerender } = renderViewerMembership(client);
	expect(result.current.savedDirectMessageJoin).toEqual(join);
	rerender({ confirmed: "member" });
	expect(result.current.savedDirectMessageJoin).toBeUndefined();
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

it("keeps the saved tray space only while the trays are held", () => {
	const client = new QueryClient();
	client.setQueryData(spaceComposerTrayDisplayQueryKey("space", "human"), {
		version: 1,
		height: 46,
	});
	const { result, rerender } = renderHook(
		(props: { held: boolean }) =>
			useSpaceComposerTraySpace({
				held: props.held,
				profileId: "human",
				spaceId: "space",
			}),
		{ initialProps: { held: true }, wrapper: createWrapper(client) }
	);
	expect(result.current.reservedHeight).toBe(46);
	rerender({ held: false });
	expect(result.current.reservedHeight).toBe(0);
});
