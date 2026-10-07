import { TextShimmer } from "@openmeld/ui/components/text-shimmer";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useSpaceMemberAdditions } from "#/query/spaces/member-additions";

export function SpaceMemberAdditions(input: {
	profileId: string;
	spaceId: string;
}) {
	const organization = useOptionalAppOrganization();
	const additions = useSpaceMemberAdditions({
		...input,
		organizationId: organization?.currentOrganization.id ?? "",
	});
	const pending = new Map<string, string>();
	for (const addition of additions) {
		for (const member of addition.input?.members ?? []) {
			if (addition.status === "pending") {
				pending.set(member.profileId, member.profileName);
			} else {
				pending.delete(member.profileId);
			}
		}
	}
	if (!pending.size) {
		return null;
	}
	return (
		<div aria-live="polite" className="space-y-2 px-2 py-2">
			{[...pending].map(([id, name]) => (
				<div
					className="flex items-center justify-between gap-3 text-sm"
					key={id}
				>
					<span className="truncate">{name}</span>
					<TextShimmer as="span" className="shrink-0 text-xs">
						Adding…
					</TextShimmer>
				</div>
			))}
		</div>
	);
}
