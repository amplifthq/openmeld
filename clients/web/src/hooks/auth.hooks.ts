import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SocialProvider } from "#/components/auth/social-providers";
import { openMeldAuthClient } from "#/lib/auth-client";
import {
	getAuthErrorMessage,
	isWebAuthnCancellationError,
} from "#/lib/auth-errors";
import {
	getFrontendCallbackURL,
	resolvePostAuthRedirect,
} from "#/lib/auth-redirect";
import { generatePasskeyName } from "#/lib/passkey-utils";
import { completeAccountAuthChange } from "#/query/auth-boundary";
import {
	revokeDeviceSession,
	setActiveDeviceSession,
} from "#/query/auth-query";
import { userQueryKeys } from "#/query/query-keys";
import {
	listDeviceSessionsQueryOptionsClient,
	listUserAccountsQueryOptionsClient,
	sessionQueryOptionsClient,
	userPasskeysQueryOptionsClient,
} from "#/query/query-options";

export const useAuthSession = () =>
	useQuery({
		...sessionQueryOptionsClient(),
	});

export const useListUserAccounts = () =>
	useQuery({
		...listUserAccountsQueryOptionsClient(),
	});

export const useDeviceSessions = () =>
	useQuery({
		...listDeviceSessionsQueryOptionsClient(),
	});

export const useUserPasskeys = () =>
	useQuery({
		...userPasskeysQueryOptionsClient(),
	});

export function useHasPassword(): boolean {
	const { data: accounts = [] } = useListUserAccounts();
	return accounts.some((account) => account.providerId === "credential");
}

export function useSocialSignIn() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (providerId: SocialProvider["providerId"]) => {
			const callbackURL = new URL(
				getFrontendCallbackURL("/callback"),
				window.location.origin
			);
			callbackURL.searchParams.set("redirect", resolvePostAuthRedirect());

			const result = await openMeldAuthClient.signIn.social({
				provider: providerId,
				callbackURL: callbackURL.toString(),
			});

			if (result?.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						`Failed to sign in with ${providerId}.`
					)
				);
			}
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "session-created");
		},
	});
}

export function usePasskeySignIn() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const result = await openMeldAuthClient.signIn.passkey();
			if (result.error) {
				if (isWebAuthnCancellationError(result.error)) {
					return { signedIn: false } as const;
				}
				throw new Error(
					getAuthErrorMessage(result.error, "Failed to sign in with passkey.")
				);
			}

			return { signedIn: true } as const;
		},
		onSuccess: async (result) => {
			if (result.signedIn) {
				await completeAccountAuthChange(queryClient, "session-created");
			}
		},
	});
}

export function useAddPasskey() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const result = await openMeldAuthClient.passkey.addPasskey({
				name: generatePasskeyName(),
			});
			if (result.error) {
				if (isWebAuthnCancellationError(result.error)) {
					return;
				}
				throw new Error(
					getAuthErrorMessage(result.error, "Failed to add passkey.")
				);
			}
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.passkeys });
		},
	});
}

export function useSignOut() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			await openMeldAuthClient.signOut();
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "signed-out");
		},
	});
}

export function useSwitchAccount() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: setActiveDeviceSession,
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "account-switched");
		},
	});
}

export function useRevokeAccountSession() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: revokeDeviceSession,
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "session-revoked");
		},
	});
}
