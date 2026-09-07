const INVITATION_ROUTES = [
	"/accept-invitation",
	"/accept-space-invitation",
	"/join-organization",
	"/invitations",
	"/invitation-requests",
] as const;

export function shouldPreferMagicLink(redirectTarget: string | null): boolean {
	return Boolean(
		redirectTarget &&
			(isInvitationRedirectTarget(redirectTarget) ||
				redirectTarget.startsWith("/link-slack"))
	);
}

export function isInvitationRedirectTarget(target: string): boolean {
	const pathname = target.split("?")[0]?.split("#")[0];
	return INVITATION_ROUTES.some((route) => pathname === route);
}
