import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import {
	type Query,
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	MAX_COMPOSER_TRAY_DISPLAY_HEIGHT,
	spaceComposerTrayDisplayQueryOptions,
} from "#/query/spaces/composer-tray-display";
import type { SpaceMemberDirectoryDisplay } from "#/query/spaces/member-directory-display";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	type AccountMemberSpacesDisplay,
	accountMemberSpacesDisplayQueryKey,
	type SpaceViewerMembershipDisplay,
	spaceViewerMembershipDisplayQueryKey,
	spaceViewerMembershipDisplayQueryOptions,
} from "#/query/spaces/viewer-membership-display";

export type ViewerMembershipState = "member" | "nonmember" | "unknown";

/**
 * Only an unknown membership keeps the neutral bar: a member gets the input and
 * a non-member the Join prompt as soon as either is known, from a confirmed
 * read or from cached data. A deleted Space or a failed member load never
 * waits.
 */
export function isSpaceComposerAccessPending(input: {
	isDeleted: boolean;
	membersFailed: boolean;
	membershipState: ViewerMembershipState;
}): boolean {
	return (
		!(input.isDeleted || input.membersFailed) &&
		input.membershipState === "unknown"
	);
}

/**
 * What the composer region paints during a load: whether the bar is still the
 * neutral placeholder and whether the trays are still held.
 */
export function useSpaceComposerRegion(input: {
	isDeleted: boolean;
	membersFailed: boolean;
	membershipState: ViewerMembershipState;
	profileId: string;
	spaceId: string;
}): { barPending: boolean; traysHeld: boolean } {
	const barPending = isSpaceComposerAccessPending(input);
	const traysHeld = useSpaceComposerTraysHeld({
		accessPending: barPending,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	return { barPending, traysHeld };
}

export type SavedDirectMessageJoin = NonNullable<
	SpaceViewerMembershipDisplay["directMessageJoin"]
>;

/**
 * The membership the conversation paints with. A confirmed members read wins.
 * Until it arrives, cached data picks the bar so the first frame already has
 * the input or the Join prompt: the account's Spaces list (live, or saved
 * from its last load), the Space's member directory, the viewer's last
 * confirmed membership (saved with the conversation), then the Organization's
 * Space directory. Only presentation reads this; the server still decides
 * every send and join.
 */
export function useSpaceViewerMembership(input: {
	confirmed: ViewerMembershipState;
	organizationId: string | null;
	ownerAccountId: string;
	profileId: string;
	spaceId: string;
}): {
	membership: ViewerMembershipState;
	savedDirectMessageJoin: SavedDirectMessageJoin | undefined;
} {
	const queryClient = useQueryClient();
	const options = spaceViewerMembershipDisplayQueryOptions(
		input.spaceId,
		input.profileId
	);
	const saved = useQuery(options).data;
	useSaveAccountMemberSpaces(input);
	const savedMembership = saved?.membership;
	const settled = input.confirmed !== "unknown";
	const subscribe = useCallback(
		(onChange: () => void) =>
			settled
				? () => undefined
				: queryClient.getQueryCache().subscribe(onChange),
		[queryClient, settled]
	);
	const cached = useSyncExternalStore(subscribe, () =>
		settled
			? input.confirmed
			: readCachedSpaceMembership(queryClient, {
					organizationId: input.organizationId,
					ownerAccountId: input.ownerAccountId,
					profileId: input.profileId,
					savedMembership,
					spaceId: input.spaceId,
				})
	);
	useEffect(() => {
		if (input.confirmed === "unknown" || input.confirmed === savedMembership) {
			return;
		}
		queryClient.setQueryData(options.queryKey, {
			version: 1,
			membership: input.confirmed,
		});
	}, [input.confirmed, options.queryKey, queryClient, savedMembership]);
	const membership = settled ? input.confirmed : cached;
	return {
		membership,
		savedDirectMessageJoin:
			membership === "nonmember" ? saved?.directMessageJoin : undefined,
	};
}

/** Saves the Join prompt a confirmed observer sees, for the next load. */
export function useSaveDirectMessageJoin(input: {
	join: SavedDirectMessageJoin | null;
	profileId: string;
	spaceId: string;
}): void {
	const queryClient = useQueryClient();
	const serialized = input.join ? JSON.stringify(input.join) : null;
	useEffect(() => {
		if (!serialized) {
			return;
		}
		const key = spaceViewerMembershipDisplayQueryKey(
			input.spaceId,
			input.profileId
		);
		const current = queryClient.getQueryData<SpaceViewerMembershipDisplay>(key);
		if (
			current?.membership === "nonmember" &&
			JSON.stringify(current.directMessageJoin) === serialized
		) {
			return;
		}
		queryClient.setQueryData<SpaceViewerMembershipDisplay>(key, {
			version: 1,
			membership: "nonmember",
			directMessageJoin: JSON.parse(serialized) as SavedDirectMessageJoin,
		});
	}, [input.profileId, input.spaceId, queryClient, serialized]);
}

/**
 * Keeps the saved account Spaces index in step with the live account Spaces
 * list, so the next hard refresh knows the viewer's Spaces before that list
 * loads again.
 */
function useSaveAccountMemberSpaces(input: {
	organizationId: string | null;
	ownerAccountId: string;
}): void {
	const queryClient = useQueryClient();
	const { organizationId, ownerAccountId } = input;
	useEffect(() => {
		if (!(organizationId && ownerAccountId)) {
			return;
		}
		const key = accountMemberSpacesDisplayQueryKey(
			ownerAccountId,
			organizationId
		);
		const save = () => {
			const next = readAccountMemberSpaces(queryClient);
			if (!next) {
				return;
			}
			const current = queryClient.getQueryData<AccountMemberSpacesDisplay>(key);
			if (JSON.stringify(current?.spaces) !== JSON.stringify(next)) {
				queryClient.setQueryData<AccountMemberSpacesDisplay>(key, {
					version: 1,
					spaces: next,
				});
			}
		};
		save();
		return queryClient.getQueryCache().subscribe((event) => {
			if (
				event.type === "updated" &&
				event.query.queryKey[1] === accountSpaceQueryKeys.all[1] &&
				event.query.queryKey[3] === "account"
			) {
				save();
			}
		});
	}, [organizationId, ownerAccountId, queryClient]);
}

function readAccountMemberSpaces(
	queryClient: QueryClient
): AccountMemberSpacesDisplay["spaces"] | null {
	const loaded = queryClient
		.getQueryCache()
		.findAll({ queryKey: accountSpaceQueryKeys.all })
		.find(
			(query) =>
				query.queryKey[3] === "account" && query.state.status === "success"
		);
	const sections = loaded?.state.data as AccountSpaceSections | undefined;
	if (!sections) {
		return null;
	}
	return [...sections.pinnedItems, ...sections.spaceItems]
		.filter((item) => !item.deletedAt)
		.map((item) => ({
			spaceId: item.spaceId,
			profileIds: [
				...new Set([
					...item.joinedProfiles.map((joined) => joined.profileId),
					...(item.directMessageProfileIds ?? []),
				]),
			].sort(),
		}))
		.sort((left, right) => left.spaceId.localeCompare(right.spaceId));
}

function readCachedSpaceMembership(
	queryClient: QueryClient,
	input: {
		organizationId: string | null;
		ownerAccountId: string;
		profileId: string;
		savedMembership: "member" | "nonmember" | undefined;
		spaceId: string;
	}
): ViewerMembershipState {
	if (
		isInCachedAccountSpaces(queryClient, input.spaceId, input.profileId) ||
		isInSavedAccountSpaces(queryClient, input) ||
		isInCachedMemberDirectory(queryClient, input.spaceId, input.profileId)
	) {
		return "member";
	}
	if (input.savedMembership) {
		return input.savedMembership;
	}
	const joined = input.organizationId
		? queryClient
				.getQueryData<OrganizationSpaceDirectoryWithMemberCountsResponse>(
					organizationQueryKeys.spaces(input.organizationId)
				)
				?.spaces.find((space) => space.spaceId === input.spaceId)?.joined
		: undefined;
	if (joined === undefined) {
		return "unknown";
	}
	return joined ? "member" : "nonmember";
}

function isInCachedAccountSpaces(
	queryClient: QueryClient,
	spaceId: string,
	profileId: string
): boolean {
	return queryClient
		.getQueriesData<AccountSpaceSections>({
			queryKey: accountSpaceQueryKeys.all,
		})
		.some(([, sections]) =>
			[...(sections?.pinnedItems ?? []), ...(sections?.spaceItems ?? [])].some(
				(item) =>
					item.spaceId === spaceId &&
					!item.deletedAt &&
					(item.joinedProfiles.some(
						(joined) => joined.profileId === profileId
					) ||
						item.directMessageProfileIds?.includes(profileId) === true)
			)
		);
}

function isInSavedAccountSpaces(
	queryClient: QueryClient,
	input: {
		organizationId: string | null;
		ownerAccountId: string;
		profileId: string;
		spaceId: string;
	}
): boolean {
	if (!input.organizationId) {
		return false;
	}
	return (
		queryClient
			.getQueryData<AccountMemberSpacesDisplay>(
				accountMemberSpacesDisplayQueryKey(
					input.ownerAccountId,
					input.organizationId
				)
			)
			?.spaces.some(
				(space) =>
					space.spaceId === input.spaceId &&
					space.profileIds.includes(input.profileId)
			) === true
	);
}

function isInCachedMemberDirectory(
	queryClient: QueryClient,
	spaceId: string,
	profileId: string
): boolean {
	return (
		queryClient
			.getQueryData<SpaceMemberDirectoryDisplay>(
				spaceQueryKeys.memberDirectoryDisplay(spaceId, profileId)
			)
			?.members.some((member) => member.profileId === profileId) === true
	);
}

/**
 * Composer trays (Agent requests, pending Agent actions, queued messages) load
 * from separate reads. Painting each as it lands grows the composer region in
 * steps and pushes the bottom-anchored message list up each time. Hold them
 * until the bar is settled and every tray read for this conversation has
 * answered, then show them in one frame. A conversation releases once; later
 * refetches never hide the trays again.
 */
export function useSpaceComposerTraysHeld(input: {
	accessPending: boolean;
	profileId: string;
	spaceId: string;
}): boolean {
	const queryClient = useQueryClient();
	const identity = `${input.spaceId}:${input.profileId}`;
	const [releasedIdentity, setReleasedIdentity] = useState<string | null>(null);
	const released = releasedIdentity === identity;
	useEffect(() => {
		if (released || input.accessPending) {
			return;
		}
		// Effects run after the trays mounted their queries, so every tray read
		// for this conversation is already in the cache here.
		const release = () => {
			if (
				areComposerTrayReadsSettled(queryClient, input.spaceId, input.profileId)
			) {
				setReleasedIdentity(identity);
				return true;
			}
			return false;
		};
		if (release()) {
			return;
		}
		const unsubscribe = queryClient.getQueryCache().subscribe(() => {
			if (release()) {
				unsubscribe();
			}
		});
		return unsubscribe;
	}, [
		identity,
		input.accessPending,
		input.profileId,
		input.spaceId,
		queryClient,
		released,
	]);
	return !released;
}

const COMPOSER_TRAY_SETTLE_MS = 1200;

/**
 * Keeps the space the trays took on the last visit while they are held, so
 * the composer does not grow when they appear. The trays' height is measured
 * once per release (composer height after the trays settle minus the height
 * while held) and saved per conversation. Layout only.
 */
export function useSpaceComposerTraySpace(input: {
	held: boolean;
	profileId: string;
	spaceId: string;
}) {
	const queryClient = useQueryClient();
	const { held, profileId, spaceId } = input;
	const savedQuery = useQuery(
		spaceComposerTrayDisplayQueryOptions(spaceId, profileId)
	);
	const saved = savedQuery.data?.height ?? 0;
	const reservedHeight = held ? saved : 0;
	const sectionRef = useRef<HTMLDivElement>(null);
	const heldHeight = useRef<number | null>(null);
	useLayoutEffect(() => {
		if (held && sectionRef.current) {
			heldHeight.current =
				sectionRef.current.getBoundingClientRect().height - reservedHeight;
		}
	});
	useEffect(() => {
		const before = heldHeight.current;
		if (held || before === null) {
			return;
		}
		const timer = setTimeout(() => {
			heldHeight.current = null;
			const section = sectionRef.current;
			if (!section) {
				return;
			}
			const height = Math.max(
				0,
				Math.round(section.getBoundingClientRect().height - before)
			);
			if (height <= MAX_COMPOSER_TRAY_DISPLAY_HEIGHT && height !== saved) {
				queryClient.setQueryData(
					spaceComposerTrayDisplayQueryOptions(spaceId, profileId).queryKey,
					{ version: 1, height }
				);
			}
		}, COMPOSER_TRAY_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [held, profileId, queryClient, saved, spaceId]);
	return { reservedHeight, sectionRef };
}

function areComposerTrayReadsSettled(
	queryClient: QueryClient,
	spaceId: string,
	profileId: string
): boolean {
	return queryClient
		.getQueryCache()
		.findAll({
			predicate: (query) => isComposerTrayRead(query, spaceId, profileId),
		})
		.every(
			(query) =>
				query.state.status !== "pending" ||
				query.state.fetchStatus !== "fetching" ||
				// A read that failed once shows no tray while it retries.
				query.state.fetchFailureCount > 0
		);
}

const ACTIVE_WAKE_PROGRESS_KEY =
	spaceQueryKeys.activeWakeProgressSummary("")[1];

function isComposerTrayRead(
	query: Query,
	spaceId: string,
	profileId: string
): boolean {
	const key = query.queryKey;
	switch (key[0]) {
		case "space-input-queue":
			return key[1] === spaceId && key[2] === profileId;
		case "pending-plugin-action-requests":
		case "pending-permission-mode-suggestions":
			return key[3] === spaceId;
		case "agent-access":
			return (
				key[2] === "list" &&
				typeof key[3] === "object" &&
				key[3] !== null &&
				"spaceId" in key[3] &&
				key[3].spaceId === spaceId
			);
		case "spaces":
			// Pending Agent actions come from the active Wake progress read.
			return (
				key[1] === ACTIVE_WAKE_PROGRESS_KEY &&
				key[2] === spaceId &&
				key[3] === profileId
			);
		default:
			return false;
	}
}
