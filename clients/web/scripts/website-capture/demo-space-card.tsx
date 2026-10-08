import { Surface } from "@openmeld/ui/fluid/surface";
import { ArrowRightIcon, ChatCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { SpaceProfileIcon } from "../../src/components/spaces/space-profile-icon";
import { useDemoCenterAvatar } from "./demo-center-identity";
import { buildDemoSpaceMembers } from "./demo-members";

export function DemoSpaceCard() {
	const [avatar] = useDemoCenterAvatar();
	const { agents } = buildDemoSpaceMembers("agent-work", avatar);
	return (
		<Surface className="mt-2 w-full max-w-sm text-sm">
			<Link
				aria-label="Open Release handoff Space"
				className="group flex flex-col gap-3 rounded-md p-4 text-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
				params={{ orgSlug: "test", spaceId: "agent-work" }}
				to="/o/$orgSlug/spaces/$spaceId"
			>
				<span className="flex items-center gap-2 text-muted-foreground text-xs">
					<ChatCircleIcon aria-hidden="true" className="size-4" />
					Space · Invite only
				</span>
				<span className="flex items-center justify-between gap-3">
					<span className="font-medium">Release handoff</span>
					<ArrowRightIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground group-hover:text-foreground"
					/>
				</span>
				<span className="text-muted-foreground text-xs">
					Patch summary, test results, and rollback plan.
				</span>
				<span className="flex items-center gap-2 border-border/50 border-t pt-3">
					{agents.map((agent) => (
						<SpaceProfileIcon
							agentControllerRef={agent.agentControllerRef ?? null}
							avatarStyle={agent.avatarStyle}
							key={agent.profileId}
							profileId={agent.profileId}
							profileKind="agent"
							profileName={agent.profileName}
							size="inline"
						/>
					))}
					<span className="text-muted-foreground text-xs">3 agents</span>
				</span>
				<span className="text-muted-foreground text-xs">
					Center Agent · Codex · Claude Code
				</span>
			</Link>
		</Surface>
	);
}
