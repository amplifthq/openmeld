import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Link } from "@tanstack/react-router";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";

/**
 * Terminal error state for an org-scoped page whose data query could not load.
 *
 * When the failure is an active-organization mismatch that could not be
 * repaired automatically, the current org may still be a valid auth
 * membership. In that split-brain state, linking to the current org only loops
 * back to the same failing page, so the caller keeps Retry as the recovery
 * action and only shows a "Go to" link when it points somewhere else.
 */
export function OrganizationScopedErrorState(input: {
	activeOrganization: OrganizationSummary | null;
	currentOrganizationSlug: string;
	description: string;
	isRetrying?: boolean;
	onRetry?: () => void;
	title: string;
}) {
	const activeOrganizationLinkTarget =
		input.activeOrganization &&
		input.activeOrganization.slug !== input.currentOrganizationSlug
			? input.activeOrganization
			: null;

	return (
		<section className="max-w-md space-y-4">
			<div className="space-y-2">
				<p className="font-medium text-foreground text-sm">{input.title}</p>
				<p className="text-muted-foreground text-sm">{input.description}</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row">
				{input.onRetry ? (
					<Button
						disabled={input.isRetrying}
						onClick={input.onRetry}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				) : null}
				{activeOrganizationLinkTarget ? (
					<Link
						className={buttonVariants({ size: "sm" })}
						to={buildOrganizationDefaultPath(activeOrganizationLinkTarget.slug)}
					>
						Go to {activeOrganizationLinkTarget.name}
					</Link>
				) : null}
				{input.activeOrganization ? null : (
					<Link className={buttonVariants({ size: "sm" })} to="/login">
						Go to OpenMeld
					</Link>
				)}
			</div>
		</section>
	);
}
