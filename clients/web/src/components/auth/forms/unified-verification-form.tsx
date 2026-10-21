import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { resolveStatusToneVerificationIconClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	CheckCircleIcon,
	WarningCircleIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	useResendVerificationEmail,
	useVerifyEmailToken,
	useVerifyMagicLinkToken,
} from "#/hooks/auth-form.hooks";
import { DEFAULT_AUTHENTICATED_ENTRY_PATH } from "#/lib/auth-entry-policy";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { isInvitationRedirectTarget } from "#/lib/auth-login-preference";
import {
	getCurrentRedirectTarget,
	getFrontendCallbackURLWithRedirect,
	resolvePostAuthRedirect,
} from "#/lib/auth-redirect";
import { resolveActiveOrganizationEntryPath } from "#/lib/organizations/organization-scope";

type VerificationKind = "email" | "magic-link";
type VerificationState =
	| "checking"
	| "success"
	| "tokenExpired"
	| "invalidToken"
	| "sessionNotEstablished"
	| "unauthorized"
	| "networkError"
	| "unknownError";

type VerificationFailureState = Exclude<
	VerificationState,
	"checking" | "success"
>;

type VerificationFailure = {
	canResend: boolean;
	message: string;
	state: VerificationFailureState;
};

type UnifiedVerificationFormProps = {
	verificationKind: VerificationKind;
};

const EMAIL_SUCCESS_REDIRECT = "/login";
const MAGIC_LINK_ROUTE_FAMILY = "/magic-link";
const EMAIL_ROUTE_FAMILY = "/verify-email";
// Verification sets the browser cookies before a same-turn session read is
// guaranteed to observe them. Retry only the read; never reuse the one-time link.
const MAGIC_LINK_SESSION_CONFIRMATION_DELAYS_MS = [0, 250, 750, 1500, 2500];
const verificationRequestsInFlight = new Map<string, Promise<void>>();

async function waitForMagicLinkSession(
	readSession: () => Promise<{ data?: { session?: unknown } | null }>
): Promise<boolean> {
	for (const delayMs of MAGIC_LINK_SESSION_CONFIRMATION_DELAYS_MS) {
		if (delayMs > 0) {
			await new Promise<void>((resolve) => {
				window.setTimeout(resolve, delayMs);
			});
		}

		const latestSession = await readSession();
		if (latestSession.data?.session) {
			return true;
		}
	}

	return false;
}

function runDedupedVerificationRequest(
	key: string,
	request: () => Promise<void>
): Promise<void> {
	const existingRequest = verificationRequestsInFlight.get(key);
	if (existingRequest) {
		return existingRequest;
	}

	const pendingRequest = request().finally(() => {
		verificationRequestsInFlight.delete(key);
	});
	verificationRequestsInFlight.set(key, pendingRequest);
	return pendingRequest;
}

function resolveTokenFromSearch(): string {
	if (typeof window === "undefined") {
		return "";
	}

	return new URLSearchParams(window.location.search).get("token") ?? "";
}

function resolveErrorFromSearch(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	return new URLSearchParams(window.location.search).get("error");
}

function clearErrorFromSearchParams() {
	if (typeof window === "undefined") {
		return;
	}

	const currentUrl = new URL(window.location.href);
	currentUrl.searchParams.delete("error");
	window.history.replaceState({}, "", currentUrl.toString());
}

function getSuccessMessage(kind: VerificationKind): string {
	if (kind === "magic-link") {
		return "You're signed in.";
	}

	return "Email verified successfully!";
}

function getCheckingMessage(kind: VerificationKind): string {
	if (kind === "magic-link") {
		return "Signing you in with your magic link...";
	}

	return "Verifying your email address...";
}

function mapVerificationError(
	errorText: string,
	kind: VerificationKind
): VerificationFailure {
	const normalized = errorText.trim().toLowerCase();

	if (normalized.includes("expired") || normalized.includes("token_expired")) {
		return {
			state: "tokenExpired",
			message:
				kind === "magic-link"
					? "Magic link has expired. Please request a new one."
					: "Verification link has expired. Please request a new one.",
			canResend: true,
		};
	}

	if (normalized.includes("invalid") || normalized.includes("invalid_token")) {
		return {
			state: "invalidToken",
			message:
				kind === "magic-link"
					? "Invalid magic link. Please request a new one."
					: "Invalid verification link. Please request a new one.",
			canResend: true,
		};
	}

	if (
		kind === "magic-link" &&
		(normalized.includes("session_not_established") ||
			normalized.includes("signed-in session") ||
			normalized.includes("session was not established"))
	) {
		return {
			state: "sessionNotEstablished",
			message:
				"We couldn't confirm your sign-in session. Please request a new magic link.",
			canResend: true,
		};
	}

	if (normalized.includes("unauthorized")) {
		return {
			state: "unauthorized",
			message: "Unauthorized access. Please sign in and try again.",
			canResend: false,
		};
	}

	if (normalized.includes("network") || normalized.includes("fetch")) {
		return {
			state: "networkError",
			message: "Network error occurred. Please try again.",
			canResend: false,
		};
	}

	return {
		state: "unknownError",
		message: errorText || "Verification failed.",
		canResend: false,
	};
}

function resolveFailureTitle(state: VerificationFailureState): string {
	switch (state) {
		case "tokenExpired":
			return "Link Expired";
		case "invalidToken":
			return "Invalid Link";
		case "sessionNotEstablished":
			return "Sign-in Not Completed";
		case "unauthorized":
			return "Sign In Required";
		case "networkError":
			return "Connection Error";
		default:
			return "Verification Failed";
	}
}

function resolveFailureIcon(state: VerificationFailureState) {
	switch (state) {
		case "tokenExpired":
			return (
				<WarningCircleIcon
					className={cn(
						"size-8",
						resolveStatusToneVerificationIconClassName("warning")
					)}
				/>
			);
		case "networkError":
			return (
				<ArrowsClockwiseIcon
					className={cn(
						"size-8",
						resolveStatusToneVerificationIconClassName("warning")
					)}
				/>
			);
		default:
			return <XCircleIcon className="size-8 text-destructive" />;
	}
}

function resolveResendButtonLabel(
	kind: VerificationKind,
	state: VerificationFailureState,
	isPending: boolean
): string {
	if (isPending) {
		return "Sending...";
	}

	if (kind === "email") {
		if (state === "tokenExpired") {
			return "Send New Verification Email";
		}
		return "Request New Verification";
	}

	return "Request New Magic Link";
}

function VerificationChecking({ kind }: { kind: VerificationKind }) {
	return (
		<>
			<div className="mx-auto flex size-10 items-center justify-center">
				<Bars className="h-8 w-12 text-muted-foreground" />
			</div>
			<div className="space-y-1">
				<h3 className="font-semibold text-lg">{getCheckingMessage(kind)}</h3>
				<p className="text-muted-foreground text-sm">
					Please wait while we process your request.
				</p>
			</div>
		</>
	);
}

function resolveEmailContinueLabel(target: string): string {
	if (target === EMAIL_SUCCESS_REDIRECT) {
		return "Sign in to OpenMeld";
	}
	if (isInvitationRedirectTarget(target)) {
		return "Continue to accept the invitation";
	}
	return "Continue to OpenMeld";
}

function VerificationSuccess({
	appEntryPath,
	emailEntryPath,
	kind,
	message,
	shouldAutoRedirectToDevice,
}: {
	appEntryPath: string | null;
	emailEntryPath: string;
	kind: VerificationKind;
	message: string;
	shouldAutoRedirectToDevice: boolean;
}) {
	return (
		<>
			<div className="mx-auto flex size-10 items-center justify-center">
				<CheckCircleIcon
					className={cn(
						"size-8",
						resolveStatusToneVerificationIconClassName("ready")
					)}
				/>
			</div>
			<div className="space-y-1">
				<h3
					className={cn(
						"font-semibold text-lg",
						resolveStatusToneVerificationIconClassName("ready")
					)}
				>
					{message}
				</h3>
				<p className="text-muted-foreground text-sm">
					{kind === "email"
						? "Your email address is verified."
						: "Continue to your OpenMeld workspace."}
				</p>
			</div>

			{kind === "email" ? (
				<div className="grid gap-2">
					<Link
						className="inline-flex h-9 items-center justify-center border border-border px-3 text-sm"
						to={emailEntryPath}
					>
						{resolveEmailContinueLabel(emailEntryPath)}
					</Link>
				</div>
			) : null}

			{kind === "magic-link" && !shouldAutoRedirectToDevice && appEntryPath ? (
				<div className="grid gap-2">
					<Link
						className="inline-flex h-9 items-center justify-center border border-border px-3 text-sm"
						to={appEntryPath}
					>
						Continue to OpenMeld
					</Link>
				</div>
			) : null}
		</>
	);
}

function VerificationFailure({
	canResend,
	failureState,
	kind,
	message,
	onResend,
	onRetry,
	resendPending,
}: {
	canResend: boolean;
	failureState: VerificationFailureState;
	kind: VerificationKind;
	message: string;
	onResend: () => void;
	onRetry: () => void;
	resendPending: boolean;
}) {
	const showBackToLogin = !canResend && failureState !== "unauthorized";

	return (
		<div className="grid gap-4">
			<div className="mx-auto flex size-10 items-center justify-center">
				{resolveFailureIcon(failureState)}
			</div>
			<div className="space-y-1">
				<h3 className="font-semibold text-lg">
					{resolveFailureTitle(failureState)}
				</h3>
				<p className="text-muted-foreground text-sm">
					{message || "Verification failed. Please try again."}
				</p>
			</div>

			{canResend ? (
				<div className="grid gap-2 text-left">
					<Button
						className="w-full"
						disabled={resendPending}
						onClick={onResend}
						type="button"
					>
						<ArrowsClockwiseIcon className="size-4" />
						{resolveResendButtonLabel(kind, failureState, resendPending)}
					</Button>
				</div>
			) : null}

			{failureState === "unauthorized" ? (
				<Link
					className="inline-flex h-9 items-center justify-center border border-border px-3 text-sm"
					to="/login"
				>
					Sign In
				</Link>
			) : null}

			{failureState === "networkError" ? (
				<Button
					className="w-full"
					onClick={onRetry}
					type="button"
					variant="outline"
				>
					Try Again
				</Button>
			) : null}

			{showBackToLogin ? (
				<Link
					className="inline-flex h-9 items-center justify-center border border-border px-3 text-sm"
					to="/login"
				>
					Back to Login
				</Link>
			) : null}
		</div>
	);
}

export function UnifiedVerificationForm({
	verificationKind,
}: UnifiedVerificationFormProps) {
	const { data: session, refetch: refetchSession } = useAuthSession();
	const verifyEmail = useVerifyEmailToken();
	const verifyMagicLink = useVerifyMagicLinkToken();
	const resendVerification = useResendVerificationEmail();

	const token = useMemo(() => resolveTokenFromSearch(), []);
	const errorCode = useMemo(() => resolveErrorFromSearch(), []);
	const redirectTarget = useMemo(
		() => getCurrentRedirectTarget() ?? resolvePostAuthRedirect(),
		[]
	);
	const shouldAutoRedirectToDevice = redirectTarget.startsWith("/device");
	// Return to the page that asked for sign-in (a signed-out deep link, an
	// invitation, Desktop authorization), as the anonymous-route guard does.
	// Only the default "/login" target means "pick the account's entry page".
	const preserveRequestedEntry =
		isInvitationRedirectTarget(redirectTarget) ||
		redirectTarget.split("?")[0]?.split("#")[0] === "/desktop-sign-in" ||
		redirectTarget !== DEFAULT_AUTHENTICATED_ENTRY_PATH;

	const [state, setState] = useState<VerificationState>("checking");
	const [message, setMessage] = useState("");
	const [canResend, setCanResend] = useState(false);
	const [magicLinkEntryPath, setMagicLinkEntryPath] = useState<string | null>(
		null
	);
	const [emailSuccessTarget, setEmailSuccessTarget] = useState(
		EMAIL_SUCCESS_REDIRECT
	);

	const verificationStartedRef = useRef(false);

	const applyFailure = useCallback((failure: VerificationFailure) => {
		setState(failure.state);
		setMessage(failure.message);
		setCanResend(failure.canResend);
	}, []);

	const applyMagicLinkSuccess = useCallback(
		(entryPath: string) => {
			setMagicLinkEntryPath(entryPath);
			setState("success");
			setCanResend(false);
			setMessage(
				shouldAutoRedirectToDevice
					? "Magic link verified. Redirecting to Device Authorization."
					: getSuccessMessage("magic-link")
			);
			toast.success(getSuccessMessage("magic-link"));
		},
		[shouldAutoRedirectToDevice]
	);

	const confirmMagicLinkSession = useCallback(async (): Promise<
		| {
				entryPath: string;
				ok: true;
		  }
		| { ok: false }
	> => {
		const sessionEstablished = await waitForMagicLinkSession(refetchSession);
		if (!sessionEstablished) {
			return { ok: false };
		}

		if (shouldAutoRedirectToDevice) {
			return {
				entryPath: redirectTarget,
				ok: true,
			};
		}

		// Preserve the requested page, invitation or Desktop authorization.
		if (preserveRequestedEntry) {
			return {
				entryPath: redirectTarget,
				ok: true,
			};
		}

		const entryPath = await resolveActiveOrganizationEntryPath({
			data: { routeFamily: MAGIC_LINK_ROUTE_FAMILY },
		});
		return {
			entryPath,
			ok: true,
		};
	}, [
		preserveRequestedEntry,
		redirectTarget,
		refetchSession,
		shouldAutoRedirectToDevice,
	]);

	const applyMissingMagicLinkSessionFailure = useCallback(() => {
		applyFailure({
			state: "sessionNotEstablished",
			message:
				"We couldn't confirm your sign-in session. Please request a new magic link.",
			canResend: true,
		});
	}, [applyFailure]);

	const resolveEmailSuccessTarget = useCallback(async (): Promise<string> => {
		if (preserveRequestedEntry) {
			return redirectTarget;
		}

		// autoSignInAfterVerification signs the user in on success, so land them in
		// the app instead of bouncing to /login; fall back to /login only if the
		// session did not actually establish.
		const latestSession = await refetchSession();
		if (!latestSession.data?.session) {
			return EMAIL_SUCCESS_REDIRECT;
		}
		if (shouldAutoRedirectToDevice) {
			return redirectTarget;
		}
		return resolveActiveOrganizationEntryPath({
			data: { routeFamily: EMAIL_ROUTE_FAMILY },
		});
	}, [
		preserveRequestedEntry,
		redirectTarget,
		refetchSession,
		shouldAutoRedirectToDevice,
	]);

	const startVerification = useCallback(async () => {
		if (errorCode) {
			applyFailure(mapVerificationError(errorCode, verificationKind));
			clearErrorFromSearchParams();
			return;
		}

		if (!token) {
			applyFailure({
				state: "invalidToken",
				message: "No verification token found in URL.",
				canResend: true,
			});
			return;
		}

		setState("checking");
		setMessage("");
		setCanResend(false);

		try {
			const requestKey = `${verificationKind}:${token}:${redirectTarget}`;
			if (verificationKind === "magic-link") {
				await runDedupedVerificationRequest(requestKey, async () => {
					await verifyMagicLink.mutateAsync({
						token,
						callbackURL: getFrontendCallbackURLWithRedirect(
							"/magic-link",
							redirectTarget
						),
					});
				});
				const confirmedSession = await confirmMagicLinkSession();
				if (!confirmedSession.ok) {
					applyMissingMagicLinkSessionFailure();
					return;
				}
				applyMagicLinkSuccess(confirmedSession.entryPath);
				return;
			}
			await runDedupedVerificationRequest(requestKey, async () => {
				await verifyEmail.mutateAsync({
					token,
					callbackURL: getFrontendCallbackURLWithRedirect(
						"/verify-email",
						redirectTarget
					),
				});
			});

			setEmailSuccessTarget(await resolveEmailSuccessTarget());
			setState("success");
			setMessage(getSuccessMessage(verificationKind));
			toast.success(getSuccessMessage(verificationKind));
		} catch (error) {
			if (verificationKind === "magic-link") {
				const confirmedSession = await confirmMagicLinkSession();
				if (confirmedSession.ok) {
					applyMagicLinkSuccess(confirmedSession.entryPath);
					return;
				}
			}

			applyFailure(
				mapVerificationError(
					getAuthErrorMessage(error, "Verification failed."),
					verificationKind
				)
			);
		}
	}, [
		applyFailure,
		errorCode,
		redirectTarget,
		token,
		verificationKind,
		verifyEmail,
		verifyMagicLink,
		confirmMagicLinkSession,
		applyMagicLinkSuccess,
		applyMissingMagicLinkSessionFailure,
		resolveEmailSuccessTarget,
	]);

	useEffect(() => {
		if (verificationStartedRef.current) {
			return;
		}

		verificationStartedRef.current = true;
		startVerification().catch(() => {
			applyFailure({
				state: "unknownError",
				message: "Verification failed.",
				canResend: false,
			});
		});
	}, [applyFailure, startVerification]);

	useEffect(() => {
		const shouldRedirect =
			verificationKind === "magic-link" &&
			shouldAutoRedirectToDevice &&
			state === "success";

		if (!shouldRedirect) {
			return;
		}

		const timer = window.setTimeout(() => {
			window.location.assign(redirectTarget);
		}, 800);

		return () => {
			window.clearTimeout(timer);
		};
	}, [redirectTarget, shouldAutoRedirectToDevice, state, verificationKind]);

	useEffect(() => {
		const shouldRedirect =
			verificationKind === "magic-link" &&
			!shouldAutoRedirectToDevice &&
			state === "success" &&
			Boolean(magicLinkEntryPath);

		if (!(shouldRedirect && magicLinkEntryPath)) {
			return;
		}

		const timer = window.setTimeout(() => {
			window.location.assign(magicLinkEntryPath);
		}, 1200);

		return () => {
			window.clearTimeout(timer);
		};
	}, [magicLinkEntryPath, shouldAutoRedirectToDevice, state, verificationKind]);

	useEffect(() => {
		const shouldRedirect = verificationKind === "email" && state === "success";
		if (!shouldRedirect) {
			return;
		}

		// An invitation-origin verification returns to the accept page, whose
		// optimistic-accept flow takes over once the freshly verified session is
		// live; every other email verification keeps the existing sign-in landing.
		const timer = window.setTimeout(() => {
			window.location.assign(emailSuccessTarget);
		}, 4000);

		return () => {
			window.clearTimeout(timer);
		};
	}, [emailSuccessTarget, state, verificationKind]);

	const handleResend = async () => {
		if (verificationKind !== "email") {
			window.location.assign("/magic-link");
			return;
		}

		const normalizedEmail =
			typeof session?.user?.email === "string"
				? session.user.email.trim().toLowerCase()
				: "";
		if (!normalizedEmail) {
			const noEmailMessage = "No email address found. Please sign in again.";
			setMessage(noEmailMessage);
			toast.error(noEmailMessage);
			return;
		}

		try {
			await resendVerification.mutateAsync({ email: normalizedEmail });
			setMessage("Verification email sent! Please check your inbox.");
			toast.success("Verification email sent! Please check your inbox.");
		} catch (error) {
			setMessage(
				getAuthErrorMessage(error, "Failed to resend verification email.")
			);
		}
	};

	const handleRetry = () => {
		verificationStartedRef.current = false;
		startVerification().catch(() => {
			applyFailure({
				state: "unknownError",
				message: "Verification failed.",
				canResend: false,
			});
		});
	};

	if (state === "checking") {
		return (
			<div className="grid gap-4 text-center">
				<VerificationChecking kind={verificationKind} />
			</div>
		);
	}

	if (state === "success") {
		return (
			<div className="grid gap-4 text-center">
				<VerificationSuccess
					appEntryPath={magicLinkEntryPath}
					emailEntryPath={emailSuccessTarget}
					kind={verificationKind}
					message={message}
					shouldAutoRedirectToDevice={shouldAutoRedirectToDevice}
				/>
			</div>
		);
	}

	return (
		<div className="grid gap-4 text-center">
			<VerificationFailure
				canResend={canResend}
				failureState={state}
				kind={verificationKind}
				message={message}
				onResend={handleResend}
				onRetry={handleRetry}
				resendPending={resendVerification.isPending}
			/>
		</div>
	);
}
