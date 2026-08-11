import type { OrganizationBindingAuthorizationsFailure } from "#/lib/profiles/organization-binding-authorizations";

export function formatOrganizationWakeAccessError(error: unknown): string {
	const failure = error as Partial<OrganizationBindingAuthorizationsFailure>;
	const message =
		typeof failure.message === "string" && failure.message.trim().length > 0
			? failure.message.trim()
			: "Wake access authorization failed.";
	const details = [
		typeof failure.status === "number" ? `Status ${failure.status}` : null,
		typeof failure.code === "string" ? `Code ${failure.code}` : null,
		typeof failure.upstreamCode === "string"
			? `Upstream ${failure.upstreamCode}`
			: null,
		typeof failure.requestId === "string"
			? `Request ${failure.requestId}`
			: null,
	].filter(Boolean);

	return details.length > 0 ? `${message} ${details.join("; ")}` : message;
}
