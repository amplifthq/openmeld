import { cn } from "@openmeld/ui/lib/utils";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";

const WHITESPACE_PATTERN = /\s+/;

export type OrganizationIdentity = Pick<OrganizationSummary, "logo" | "name">;

export function OrganizationIdentityMark(input: {
	className?: string;
	organization: OrganizationIdentity;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"grid shrink-0 place-items-center overflow-hidden rounded-md font-medium uppercase",
				input.className
			)}
		>
			{input.organization.logo ? (
				<img
					alt=""
					className="size-full object-cover"
					height={80}
					src={input.organization.logo}
					width={80}
				/>
			) : (
				resolveOrganizationInitials(input.organization.name)
			)}
		</span>
	);
}

export function resolveOrganizationInitials(name: string): string {
	const words = name.trim().split(WHITESPACE_PATTERN).filter(Boolean);
	return (
		words
			.slice(0, 2)
			.map((word) => word[0]?.toUpperCase() ?? "")
			.join("") || "O"
	);
}
