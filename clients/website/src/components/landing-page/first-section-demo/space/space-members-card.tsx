import { cn } from "@openmeld/ui/lib/utils";

import type {
	DemoAgentMember,
	DemoHumanMember,
	SpaceMember,
} from "../demo-types";
import {
	DemoAgentIcon,
	DemoAgentMention,
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
	isDemoAgentName,
} from "../shared/demo-agent-icon";
import { TerminalSectionFrame } from "../shared/terminal-section-frame";

type SpaceMembersCardProps = {
	members: readonly SpaceMember[];
	title: string;
};

function SpaceMemberHeadline({ member }: { member: SpaceMember }) {
	if (member.role === "Agent" && isDemoAgentName(member.name)) {
		return (
			<p
				className={cn(
					"flex items-center gap-2",
					getDemoAgentAccentClassName(member.name)
				)}
				style={getDemoAgentAccentStyle(member.name)}
			>
				<DemoAgentIcon name={member.name} size="sm" />
				<span>{member.name}</span>
			</p>
		);
	}

	return (
		<p
			className={cn(
				"flex items-center gap-2",
				getDemoAgentAccentClassName(member.name)
			)}
		>
			<span>{member.name}</span>
		</p>
	);
}

function HumanMember({ member }: { member: DemoHumanMember }) {
	return (
		<div className="space-y-0.5 pl-8">
			<SpaceMemberHeadline member={member} />
		</div>
	);
}

function AgentMember({ member }: { member: DemoAgentMember }) {
	return (
		<div className="pl-8">
			<p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span
					className={cn(
						"inline-flex items-center gap-2",
						getDemoAgentAccentClassName(member.name)
					)}
					style={getDemoAgentAccentStyle(member.name)}
				>
					<DemoAgentIcon name={member.name} size="sm" />
					<span>{member.name}</span>
				</span>
				<span className="text-muted-foreground">·</span>
				<span className="text-muted-foreground">Mention as</span>
				<span className="inline-flex items-baseline gap-0 text-foreground/88">
					<span>`</span>
					<DemoAgentMention mention={member.wakeWith} />
					<span>`</span>
				</span>
			</p>
		</div>
	);
}

export function SpaceMembersCard({ members, title }: SpaceMembersCardProps) {
	const humanMembers = members.filter((member) => member.role === "Human");
	const agentMembers = members.filter((member) => member.role === "Agent");

	return (
		<TerminalSectionFrame icon="👥" title={title}>
			<div className="space-y-4">
				<div className="space-y-2">
					<p className="flex items-center gap-3 font-medium text-foreground/88">
						<span className="w-5 text-center">👤</span>
						<span>People</span>
					</p>
					<div className="space-y-2">
						{humanMembers.map((member) => (
							<HumanMember key={member.id} member={member} />
						))}
					</div>
				</div>

				<div className="space-y-2">
					<p className="flex items-center gap-3 font-medium text-foreground/88">
						<span className="w-5 text-center">🤖</span>
						<span>Agents</span>
					</p>
					<div className="space-y-2">
						{agentMembers.map((member) => (
							<AgentMember key={member.id} member={member} />
						))}
					</div>
				</div>
			</div>
		</TerminalSectionFrame>
	);
}
