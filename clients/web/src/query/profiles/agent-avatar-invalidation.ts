import {
	type AgentAvatarInvalidation,
	agentAvatarInvalidationSchema,
} from "@openmeld/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { organizationDirectoryQueryFilters } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";

const CHANNEL = "openmeld.agent-avatar-invalidation.v1";
export type AgentAvatarInvalidationScope = Pick<
	AgentAvatarInvalidation,
	"ownerAccountId" | "organizationId"
>;

export function publishAgentAvatarInvalidation(
	message: AgentAvatarInvalidation
): void {
	const channel = openChannel();
	if (!channel) {
		return;
	}
	try {
		channel.postMessage(message);
	} catch (error) {
		reportUnavailable(error);
	} finally {
		channel.close();
	}
}

export function subscribeAgentAvatarInvalidations(input: {
	queryClient: QueryClient;
	ownerAccountId: string;
	organizationId: string;
}): () => void {
	const channel = openChannel();
	if (!channel) {
		return () => undefined;
	}
	const handleMessage = (event: MessageEvent<unknown>) => {
		const parsed = agentAvatarInvalidationSchema.safeParse(event.data);
		if (
			!parsed.success ||
			parsed.data.ownerAccountId !== input.ownerAccountId ||
			parsed.data.organizationId !== input.organizationId
		) {
			return;
		}
		const { profileId } = parsed.data;
		const directories = organizationDirectoryQueryFilters({
			organizationId: input.organizationId,
		});
		if (
			!input.queryClient
				.getQueryCache()
				.findAll(directories)
				.some((query) => directoryContainsProfile(query.state.data, profileId))
		) {
			return;
		}
		// The receiving tab re-reads its own authorized projection. No incoming data
		// can update the saved identity, populate a directory, or grant access.
		Promise.all([
			input.queryClient.invalidateQueries({
				...directories,
				predicate: (query) =>
					directories.predicate(query) &&
					directoryContainsProfile(query.state.data, profileId),
			}),
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.profilesForStorageScope(input.ownerAccountId),
			}),
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.accountProfiles(input.ownerAccountId),
			}),
		]).catch(reportUnavailable);
	};
	channel.addEventListener("message", handleMessage);
	return () => {
		channel.removeEventListener("message", handleMessage);
		channel.close();
	};
}

export function directoryContainsProfile(
	value: unknown,
	profileId: string
): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"agentProfiles" in value &&
		Array.isArray(value.agentProfiles) &&
		value.agentProfiles.some(
			(profile: unknown) =>
				typeof profile === "object" &&
				profile !== null &&
				"profileId" in profile &&
				profile.profileId === profileId
		)
	);
}

function openChannel(): BroadcastChannel | null {
	if (
		typeof window === "undefined" ||
		typeof BroadcastChannel === "undefined"
	) {
		return null;
	}
	try {
		return new BroadcastChannel(CHANNEL);
	} catch (error) {
		reportUnavailable(error);
		return null;
	}
}

function reportUnavailable(error: unknown): void {
	console.warn("Agent avatar refresh could not be shared with other tabs.", {
		errorName: error instanceof Error ? error.name : typeof error,
	});
}
