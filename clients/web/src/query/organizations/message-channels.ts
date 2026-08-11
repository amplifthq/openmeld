import type {
	LarkPlatformActiveRegistrationListResponse,
	LarkPlatformProvider,
	LarkPlatformRegistrationAttemptProjection,
	LarkPlatformRegistrationResponse,
	MessageChannelConnectionListResponse,
} from "@openmeld/schemas/types";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
	listCurrentOrganizationLarkPlatformRegistrations,
	listCurrentOrganizationMessageChannels,
	type MessageChannelFailure,
	pollCurrentOrganizationLarkPlatformRegistration,
} from "#/lib/organizations/message-channels";
import { baseQueryOptions } from "#/query/query-config";

const MIN_REGISTRATION_POLL_INTERVAL_MS = 1000;

export const messageChannelQueryKeys = {
	all: ["message-channels"] as const,
	list: (organizationId: string) =>
		[...messageChannelQueryKeys.all, organizationId, "list"] as const,
	activeRegistrations: (organizationId: string) =>
		[
			...messageChannelQueryKeys.all,
			organizationId,
			"active-registrations",
		] as const,
	registration: (
		organizationId: string,
		provider: LarkPlatformProvider | null,
		attemptId: string | null
	) =>
		[
			...messageChannelQueryKeys.all,
			organizationId,
			"registration",
			provider,
			attemptId,
		] as const,
};

export function activeLarkPlatformRegistrationListQueryOptions(input: {
	organizationId: string;
	queryClient: QueryClient;
}) {
	const queryKey = messageChannelQueryKeys.activeRegistrations(
		input.organizationId
	);
	return queryOptions<
		LarkPlatformActiveRegistrationListResponse,
		MessageChannelFailure
	>({
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) => {
			const previous =
				input.queryClient.getQueryData<LarkPlatformActiveRegistrationListResponse>(
					queryKey
				);
			const next = await listCurrentOrganizationLarkPlatformRegistrations({
				organizationId: input.organizationId,
				signal,
			});
			const registrationProgressExists =
				next.registrations.length > 0 ||
				(previous?.registrations.length ?? 0) > 0;
			if (registrationProgressExists) {
				await input.queryClient.invalidateQueries(
					{
						exact: true,
						queryKey: messageChannelQueryKeys.list(input.organizationId),
					},
					{ throwOnError: true }
				);
			}
			return next;
		},
		queryKey,
		refetchInterval: (query) =>
			(query.state.data?.registrations.length ?? 0) > 0 ? 10_000 : false,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 5000,
	});
}

export function messageChannelListQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<
		MessageChannelConnectionListResponse,
		MessageChannelFailure
	>({
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentOrganizationMessageChannels({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: messageChannelQueryKeys.list(input.organizationId),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function larkPlatformRegistrationQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	provider: LarkPlatformProvider | null;
	attemptId: string | null;
}) {
	return queryOptions<LarkPlatformRegistrationResponse, MessageChannelFailure>({
		enabled:
			input.enabled && input.provider !== null && input.attemptId !== null,
		gcTime: 0,
		queryFn: async ({ signal }) => {
			if (!(input.provider && input.attemptId)) {
				throw new Error("Lark-platform registration identity is unavailable.");
			}
			return await pollCurrentOrganizationLarkPlatformRegistration({
				attemptId: input.attemptId,
				organizationId: input.organizationId,
				provider: input.provider,
				signal,
			});
		},
		queryKey: messageChannelQueryKeys.registration(
			input.organizationId,
			input.provider,
			input.attemptId
		),
		refetchInterval: (query) => {
			return resolveRegistrationPollInterval(query.state.data?.attempt ?? null);
		},
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: false,
		staleTime: 0,
	});
}

export function resolveRegistrationPollInterval(
	attempt: LarkPlatformRegistrationAttemptProjection | null,
	nowMs = Date.now()
): number | false {
	if (!(attempt && isRegistrationInProgress(attempt.status))) {
		return false;
	}
	return Math.max(
		MIN_REGISTRATION_POLL_INTERVAL_MS,
		new Date(attempt.nextPollAt).getTime() - nowMs
	);
}

export function isRegistrationInProgress(status: string): boolean {
	return (
		status === "pending_registration" ||
		status === "credentials_received" ||
		status === "configuring"
	);
}
