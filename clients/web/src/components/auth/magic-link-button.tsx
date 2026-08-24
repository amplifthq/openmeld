import { buttonVariants } from "@openmeld/ui/components/button";
import { EnvelopeSimpleIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useRedirectQueryPath } from "#/hooks/auth-redirect.hooks";
import { openMeldAuthClient } from "#/lib/auth-client";
import type { AuthView } from "./auth-views";
import { LastUsedBadge } from "./last-userd-badge";

type MagicLinkButtonProps = {
	isSubmitting?: boolean;
	view: AuthView;
};

export function MagicLinkButton({
	isSubmitting = false,
	view,
}: MagicLinkButtonProps) {
	const clientWithLastUsed = openMeldAuthClient as unknown as {
		getLastUsedLoginMethod?: () => string | undefined;
	};
	const lastUsed = clientWithLastUsed.getLastUsedLoginMethod?.();
	const isEmailLastUsed = lastUsed === "email";
	const isMagicLinkLastUsed = lastUsed === "magic-link";

	const to = useRedirectQueryPath(
		view === "magicLink" ? "/login" : "/magic-link"
	);
	const label =
		view === "magicLink" ? "Login with Password" : "Login with Magic Link";

	return (
		<Link
			className={`${buttonVariants({ variant: "authButton" })} group relative h-11 w-full lg:h-8 ${isSubmitting ? "pointer-events-none opacity-50" : ""}`}
			to={to}
		>
			<div className="flex items-center gap-2">
				{view === "magicLink" ? (
					<LockSimpleIcon className="size-4" />
				) : (
					<EnvelopeSimpleIcon className="size-4" />
				)}
				{label}
			</div>
			{isMagicLinkLastUsed && view === "login" ? <LastUsedBadge /> : null}
			{isEmailLastUsed && view === "magicLink" ? <LastUsedBadge /> : null}
		</Link>
	);
}
