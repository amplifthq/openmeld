import {
	type Query,
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { spaceQueryKeys } from "#/query/spaces/status";
import { spaceViewerMembershipDisplayQueryOptions } from "#/query/spaces/viewer-membership-display";

type ViewerMembershipState = "member" | "nonmember" | "unknown";

/**
 * Until membership is known, neither the input nor the Join prompt is safe to
 * show: a non-member would see the input flash before the Join prompt.
 * A known member keeps the input while access settles, and a failed member
 * load falls back to the input with its own retry.
 */
export function isSpaceComposerAccessPending(input: {
	isAccessConfirmed: boolean;
	isDeleted: boolean;
	membersFailed: boolean;
	membershipState: ViewerMembershipState;
}): boolean {
	if (
		input.isDeleted ||
		input.membersFailed ||
		input.membershipState === "member"
	) {
		return false;
	}
	return input.membershipState === "unknown" || !input.isAccessConfirmed;
}

/**
 * What the composer region paints during a load: whether the bar is still the
 * neutral placeholder and whether the trays are still held. An input is shown
 * as soon as membership is known (saved or confirmed). Any other bar (Join,
 * observer) arrives together with the trays, so the region changes once.
 */
export function useSpaceComposerRegion(input: {
	confirmedMembership: ViewerMembershipState;
	isAccessConfirmed: boolean;
	isDeleted: boolean;
	membersFailed: boolean;
	profileId: string;
	spaceId: string;
}): { barPending: boolean; traysHeld: boolean } {
	const membershipState = useSpaceComposerMembershipState({
		confirmed: input.confirmedMembership,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	const accessPending = isSpaceComposerAccessPending({
		isAccessConfirmed: input.isAccessConfirmed,
		isDeleted: input.isDeleted,
		membersFailed: input.membersFailed,
		membershipState,
	});
	const traysHeld = useSpaceComposerTraysHeld({
		accessPending,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	return {
		barPending: accessPending || (traysHeld && membershipState !== "member"),
		traysHeld,
	};
}

/**
 * The membership the composer region paints with. A confirmed members read
 * wins; until it arrives the viewer's last confirmed membership, saved with
 * the conversation, picks the bar so a hard refresh does not flip it. Only
 * presentation reads this: send, join and read-only decisions keep using the
 * confirmed state.
 */
export function useSpaceComposerMembershipState(input: {
	confirmed: ViewerMembershipState;
	profileId: string;
	spaceId: string;
}): ViewerMembershipState {
	const queryClient = useQueryClient();
	const options = spaceViewerMembershipDisplayQueryOptions(
		input.spaceId,
		input.profileId
	);
	const saved = useQuery(options).data?.membership;
	useEffect(() => {
		if (input.confirmed === "unknown" || input.confirmed === saved) {
			return;
		}
		queryClient.setQueryData(options.queryKey, {
			version: 1,
			membership: input.confirmed,
		});
	}, [input.confirmed, options.queryKey, queryClient, saved]);
	return input.confirmed === "unknown" ? (saved ?? "unknown") : input.confirmed;
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
