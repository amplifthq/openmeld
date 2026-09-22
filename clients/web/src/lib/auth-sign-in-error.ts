// Better Auth redirects every browser-visible sign-in failure back to this
// app with `?error=<code>` (see `onAPIError.errorURL` in
// `packages/auth/src/configs/auth.config.ts`). Two very different situations
// produce those codes:
//
// - The person canceled or abandoned the sign-in attempt: they denied
//   provider consent, went back, double-clicked "Continue with...", or the
//   OAuth callback simply arrived too late to verify. Better Auth already
//   fails closed here — no session is ever created — so the honest, calm
//   result is the ordinary sign-in page, not a scary error.
// - Something is actually broken (misconfigured provider, a provider that
//   won't return an email, an account conflict). That deserves a visible,
//   specific failure so it gets noticed and fixed, not silently swallowed.
//
// This module is the one place that decides which bucket an error code falls
// into, so Login and any other renderer reach the same conclusion.
const ABANDONED_SIGN_IN_ERROR_CODES = new Set([
	// The OAuth/SSO callback state could not be verified. Better Auth collapses
	// several distinct causes into this one wire code: the verification record
	// was already consumed (a replayed or double-loaded callback), the request
	// expired, or the callback simply never carried a usable state. All of
	// them mean the same thing to the person signing in: this attempt did not
	// complete. Better Auth still never creates a session in any of these
	// cases, so presenting them calmly does not weaken that guarantee — it
	// only changes what the browser shows after the request was already
	// safely rejected. The specific cause remains visible in Better Auth's own
	// server-side logs for diagnosing a systemic cookie or callback problem.
	"state_mismatch",
	"state_not_found",
	"state_invalid",
	// The identity provider itself reported that the person declined access
	// (GitHub, Google, and other OAuth providers use this exact code).
	"access_denied",
]);

export type SignInErrorPresentation =
	| { kind: "none" }
	| { kind: "abandoned" }
	| { kind: "failed"; message: string };

export function classifySignInError(
	error: string | null | undefined
): SignInErrorPresentation {
	const code = error?.trim();
	if (!code) {
		return { kind: "none" };
	}

	if (ABANDONED_SIGN_IN_ERROR_CODES.has(code)) {
		return { kind: "abandoned" };
	}

	return { kind: "failed", message: resolveFailedSignInMessage(code) };
}

function resolveFailedSignInMessage(code: string): string {
	return `We couldn't finish signing you in. Try again, or contact support if this continues. (${code})`;
}
