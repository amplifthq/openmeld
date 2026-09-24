import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { buildAgentProfilePath } from "#/lib/profile-routes";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";

export function AgentModelRecoveryAction(input: {
	className?: string;
	orgSlug: string;
	profileId?: string;
}) {
	const editContext = useOptionalSpaceAgentProfileEditContext();
	if (
		!input.profileId ||
		(editContext && !editContext.profilesById.has(input.profileId))
	) {
		return (
			<p className="text-muted-foreground text-xs">
				Ask this agent's owner to change its model.
			</p>
		);
	}
	return (
		<Link
			className={cn(
				buttonVariants({ size: "sm", variant: "outline" }),
				input.className
			)}
			to={buildAgentProfilePath({
				orgSlug: input.orgSlug,
				profileId: input.profileId,
			})}
		>
			Change model
		</Link>
	);
}
