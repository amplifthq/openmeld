import { queryOptions } from "@tanstack/react-query";
import { isFreshSessionRequiredError } from "#/lib/auth-errors";
import {
	getAccountAvatar,
	getSession,
	listAccounts,
	listDeviceSessions,
	listSessions,
	listUserPasskeys,
} from "#/query/auth-query";
import { baseQueryOptions, shouldRetryQuery } from "#/query/query-config";
import { userQueryKeys } from "#/query/query-keys";

export const sessionQueryOptionsClient = () =>
	queryOptions({
		queryKey: userQueryKeys.session,
		queryFn: ({ signal }) => getSession(signal),
		...baseQueryOptions,
	});

export const accountAvatarQueryOptionsClient = () =>
	queryOptions({
		queryKey: userQueryKeys.accountAvatar,
		queryFn: getAccountAvatar,
		...baseQueryOptions,
	});

export const listSessionsQueryOptionsClient = () =>
	queryOptions({
		queryKey: userQueryKeys.listSessions,
		queryFn: listSessions,
		...baseQueryOptions,
		retry: (failureCount, error) =>
			!isFreshSessionRequiredError(error) &&
			shouldRetryQuery(failureCount, error),
	});

export const listDeviceSessionsQueryOptionsClient = () =>
	queryOptions({
		queryKey: userQueryKeys.deviceSessions,
		queryFn: listDeviceSessions,
		...baseQueryOptions,
	});

export const listUserAccountsQueryOptionsClient = () =>
	queryOptions({
		queryKey: userQueryKeys.listUserAccounts,
		queryFn: listAccounts,
		...baseQueryOptions,
	});

export const userPasskeysQueryOptionsClient = () =>
	queryOptions({
		queryKey: userQueryKeys.passkeys,
		queryFn: listUserPasskeys,
		...baseQueryOptions,
	});
