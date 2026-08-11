import { openMeldAuthClient } from "#/lib/auth-client";
import {
	type AuthTransportResult,
	requestAuthEndpoint,
	resolveClientResult,
} from "./auth-transport";

type AuthActionResult<Data = unknown> = AuthTransportResult<Data>;

type EmailSignInInput = {
	email: string;
	password: string;
	callbackURL: string;
};

type EmailSignUpInput = {
	email: string;
	password: string;
	name: string;
	callbackURL: string;
};

type MagicLinkSignInInput = {
	email: string;
	callbackURL: string;
};

type RequestPasswordResetInput = {
	email: string;
	redirectTo: string;
};

type ResetPasswordInput = {
	token: string;
	newPassword: string;
};

type VerifyTokenInput = {
	token: string;
	callbackURL?: string;
};

type SendVerificationEmailInput = {
	email: string;
	callbackURL: string;
};

type AuthFormClient = {
	signIn?: {
		email?: (input: EmailSignInInput) => Promise<unknown>;
		magicLink?: (input: MagicLinkSignInInput) => Promise<unknown>;
	};
	signUp?: {
		email?: (input: EmailSignUpInput) => Promise<unknown>;
	};
	requestPasswordReset?: (input: RequestPasswordResetInput) => Promise<unknown>;
	resetPassword?: (input: ResetPasswordInput) => Promise<unknown>;
	verifyEmail?: (input: { query: VerifyTokenInput }) => Promise<unknown>;
	magicLink?: {
		verify?: (input: { query: VerifyTokenInput }) => Promise<unknown>;
	};
	sendVerificationEmail?: (
		input: SendVerificationEmailInput
	) => Promise<unknown>;
	signOut?: () => Promise<unknown>;
};

const authFormClient = openMeldAuthClient as unknown as AuthFormClient;

function resolveVerificationCallbackURL(
	callbackURL: string | undefined,
	fallbackPath: string
): string {
	if (callbackURL) {
		return callbackURL;
	}

	if (typeof window === "undefined") {
		return fallbackPath;
	}

	return `${window.location.origin}${fallbackPath}`;
}

export function signInWithEmail(input: EmailSignInInput) {
	if (authFormClient.signIn?.email) {
		return resolveClientResult(
			() => authFormClient.signIn?.email?.(input),
			"Failed to sign in with email."
		);
	}

	return requestAuthEndpoint({
		path: "/sign-in/email",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to sign in with email.",
	});
}

export function signUpWithEmail(input: EmailSignUpInput) {
	if (authFormClient.signUp?.email) {
		return resolveClientResult(
			() => authFormClient.signUp?.email?.(input),
			"Failed to create account."
		);
	}

	return requestAuthEndpoint({
		path: "/sign-up/email",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to create account.",
	});
}

export function signInWithMagicLink(input: MagicLinkSignInInput) {
	if (authFormClient.signIn?.magicLink) {
		return resolveClientResult(
			() => authFormClient.signIn?.magicLink?.(input),
			"Failed to send magic link."
		);
	}

	return requestAuthEndpoint({
		path: "/sign-in/magic-link",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to send magic link.",
	});
}

export function requestPasswordReset(input: RequestPasswordResetInput) {
	if (authFormClient.requestPasswordReset) {
		return resolveClientResult(
			() => authFormClient.requestPasswordReset?.(input),
			"Failed to request password reset."
		);
	}

	return requestAuthEndpoint({
		path: "/request-password-reset",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to request password reset.",
	});
}

export function resetPassword(input: ResetPasswordInput) {
	if (authFormClient.resetPassword) {
		return resolveClientResult(
			() => authFormClient.resetPassword?.(input),
			"Failed to reset password."
		);
	}

	return requestAuthEndpoint({
		path: "/reset-password",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to reset password.",
	});
}

export function verifyEmailToken(input: VerifyTokenInput) {
	const callbackURL = resolveVerificationCallbackURL(
		input.callbackURL,
		"/verify-email"
	);

	return requestAuthEndpoint({
		path: `/verify-email?token=${encodeURIComponent(input.token)}&callbackURL=${encodeURIComponent(callbackURL)}`,
		request: {
			method: "GET",
		},
		fallbackMessage: "Failed to verify email token.",
		redirectErrorHandling: "enabled",
	});
}

export function verifyMagicLinkToken(input: VerifyTokenInput) {
	const callbackURL = resolveVerificationCallbackURL(
		input.callbackURL,
		"/magic-link"
	);

	return requestAuthEndpoint({
		path: `/magic-link/verify?token=${encodeURIComponent(input.token)}&callbackURL=${encodeURIComponent(callbackURL)}`,
		request: {
			method: "GET",
		},
		fallbackMessage: "Failed to verify magic link token.",
		redirectErrorHandling: "enabled",
	});
}

export function sendVerificationEmail(input: SendVerificationEmailInput) {
	if (authFormClient.sendVerificationEmail) {
		return resolveClientResult(
			() => authFormClient.sendVerificationEmail?.(input),
			"Failed to send verification email."
		);
	}

	return requestAuthEndpoint({
		path: "/send-verification-email",
		request: {
			method: "POST",
			body: JSON.stringify(input),
		},
		fallbackMessage: "Failed to send verification email.",
	});
}

export function signOutSession() {
	if (authFormClient.signOut) {
		return resolveClientResult(
			() => authFormClient.signOut?.(),
			"Failed to sign out."
		);
	}

	return requestAuthEndpoint({
		path: "/sign-out",
		request: {
			method: "POST",
			body: JSON.stringify({}),
		},
		fallbackMessage: "Failed to sign out.",
	});
}

export type { AuthActionResult };
