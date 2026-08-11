const MAGIC_LINK_PREFERRED_REDIRECT_PREFIXES = [
	"/accept-invitation",
	"/join-organization",
	"/link-slack",
] as const;

export function shouldPreferMagicLink(redirectTarget: string | null): boolean {
	return MAGIC_LINK_PREFERRED_REDIRECT_PREFIXES.some((routePrefix) =>
		redirectTarget?.startsWith(routePrefix)
	);
}
