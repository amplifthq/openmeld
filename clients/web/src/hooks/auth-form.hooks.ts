import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthClientError } from "#/lib/auth-client-types";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import {
	type AuthActionResult,
	requestPasswordReset,
	resetPassword,
	sendVerificationEmail,
	signInWithEmail,
	signInWithMagicLink,
	signOutSession,
	signUpWithEmail,
	verifyEmailToken,
	verifyMagicLinkToken,
} from "#/lib/auth-form-api";
import {
	getFrontendCallbackURL,
	getFrontendCallbackURLWithRedirect,
	resolvePostAuthRedirect,
	sanitizeRedirectTarget,
} from "#/lib/auth-redirect";
import { completeAccountAuthChange } from "#/query/auth-boundary";
import { userQueryKeys } from "#/query/query-keys";

function deriveNameFromEmail(email: string): string {
	const localPart = email.split("@")[0]?.trim();
	if (!localPart) {
		return "OpenMeld User";
	}

	return localPart.slice(0, 80);
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function assertNoAuthError<Data>(
	result: AuthActionResult<Data>,
	fallback: string
): Data | null {
	if (result.error) {
		throw createAuthMutationError(result.error, fallback);
	}

	return result.data;
}

function createAuthMutationError(
	error: AuthClientError | null,
	fallback: string
): Error & AuthClientError {
	const message = getAuthErrorMessage(error, fallback);
	const wrappedError = new Error(message) as Error & AuthClientError;

	if (!error || typeof error !== "object") {
		return wrappedError;
	}

	const code =
		typeof error.code === "string" && error.code.trim()
			? error.code.trim().toUpperCase()
			: undefined;
	const description =
		typeof error.description === "string" && error.description.trim()
			? error.description.trim()
			: undefined;

	return Object.assign(wrappedError, error, {
		...(code ? { code } : {}),
		...(description ? { description } : {}),
		message,
	});
}

export function useEmailSignIn() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: {
			email: string;
			password: string;
			redirectTo?: string;
		}) => {
			const result = await signInWithEmail({
				email: normalizeEmail(input.email),
				password: input.password,
				callbackURL: getFrontendCallbackURL("/callback"),
			});

			assertNoAuthError(result, "Failed to sign in with email.");

			return {
				redirectTo: sanitizeRedirectTarget(
					input.redirectTo,
					resolvePostAuthRedirect()
				),
			};
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "session-created");
		},
	});
}

export function useEmailSignUp() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: {
			email: string;
			password: string;
			name?: string;
			redirectTo?: string;
		}) => {
			const email = normalizeEmail(input.email);
			const result = await signUpWithEmail({
				email,
				password: input.password,
				name: input.name?.trim() || deriveNameFromEmail(email),
				callbackURL: getFrontendCallbackURLWithRedirect("/verify-email"),
			});

			assertNoAuthError(result, "Failed to create account.");

			return {
				email,
				redirectTo: sanitizeRedirectTarget(
					input.redirectTo,
					resolvePostAuthRedirect()
				),
			};
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "session-created");
		},
	});
}

export function useMagicLinkSignIn() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { email: string; redirectTo?: string }) => {
			const result = await signInWithMagicLink({
				email: normalizeEmail(input.email),
				callbackURL: getFrontendCallbackURLWithRedirect("/magic-link"),
			});

			assertNoAuthError(result, "Failed to send magic link.");

			return {
				redirectTo: sanitizeRedirectTarget(
					input.redirectTo,
					resolvePostAuthRedirect()
				),
			};
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.session });
		},
	});
}

export function useRequestPasswordReset() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { email: string }) => {
			const result = await requestPasswordReset({
				email: normalizeEmail(input.email),
				redirectTo: getFrontendCallbackURL("/reset-password"),
			});

			assertNoAuthError(result, "Failed to request password reset.");
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.session });
		},
	});
}

export function useResetPassword() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { token: string; newPassword: string }) => {
			const result = await resetPassword({
				token: input.token,
				newPassword: input.newPassword,
			});

			assertNoAuthError(result, "Failed to reset password.");
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.session });
		},
	});
}

export function useVerifyEmailToken() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { token: string; callbackURL?: string }) => {
			const result = await verifyEmailToken({
				token: input.token,
				callbackURL: input.callbackURL,
			});
			assertNoAuthError(result, "Failed to verify email token.");
			return { redirectTo: resolvePostAuthRedirect() };
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "session-created");
		},
	});
}

export function useVerifyMagicLinkToken() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { token: string; callbackURL?: string }) => {
			const result = await verifyMagicLinkToken({
				token: input.token,
				callbackURL: input.callbackURL,
			});
			assertNoAuthError(result, "Failed to verify magic link token.");
			return { redirectTo: resolvePostAuthRedirect() };
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "session-created");
		},
	});
}

export function useResendVerificationEmail() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { email: string }) => {
			const result = await sendVerificationEmail({
				email: normalizeEmail(input.email),
				callbackURL: getFrontendCallbackURLWithRedirect("/verify-email"),
			});

			assertNoAuthError(result, "Failed to send verification email.");
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: userQueryKeys.session });
		},
	});
}

export function useLogoutAction() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			const result = await signOutSession();
			assertNoAuthError(result, "Failed to sign out.");
		},
		onSuccess: async () => {
			await completeAccountAuthChange(queryClient, "signed-out");
		},
	});
}
