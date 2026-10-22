import { formatHarnessDisplayName, type HarnessKind } from "@openmeld/schemas";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AgentCard } from "#/components/agents/agent-card";
import { AgentCardNavMenu } from "#/components/agents/agent-card-nav-menu";
import type {
	MemberAgentDirectory,
	MemberAgentDirectoryRow,
} from "./member-agent-directory-model";
import {
	MEMBER_AGENT_STATE_LABELS,
	type MemberAgentState,
} from "./member-agent-presence";

const STATE_BADGE_VARIANT: Readonly<
	Record<MemberAgentState, "default" | "secondary" | "destructive" | "outline">
> = {
	available: "secondary",
	checking: "outline",
	unavailable: "outline",
	offline: "outline",
	missing: "destructive",
};

export function HarnessLogo(input: { harnessKind: HarnessKind; size: number }) {
	if (input.harnessKind === "hosted") {
		return (
			<span
				className="grid shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
				style={{ height: input.size, width: input.size }}
			>
				<RobotIcon aria-hidden="true" className="size-1/2" />
			</span>
		);
	}
	return (
		<span
			className="grid shrink-0 place-items-center"
			style={{ height: input.size, width: input.size }}
		>
			<LocalAgentLogo
				agentId={input.harnessKind}
				className="size-full rounded-md"
				variant="tile"
			/>
		</span>
	);
}

export function MemberAgentStateBadge(input: { state: MemberAgentState }) {
	return (
		<Badge variant={STATE_BADGE_VARIANT[input.state]}>
			{MEMBER_AGENT_STATE_LABELS[input.state]}
		</Badge>
	);
}

const AVAILABILITY_BADGE = {
	available: { label: "Available", variant: "secondary" },
	checking: { label: "Checking", variant: "outline" },
	offline: { label: "Offline", variant: "outline" },
	unavailable: { label: "Unavailable", variant: "outline" },
} as const;

/**
 * The same status pill as a MemberAgent row, for a single Agent Profile.
 * Without a category it shows `label` as a neutral pill, e.g. a failed check.
 */
export function AgentAvailabilityBadge(input: {
	category: keyof typeof AVAILABILITY_BADGE | null;
	label?: string;
	id?: string;
	tooltip?: string;
}) {
	const badge = input.category
		? AVAILABILITY_BADGE[input.category]
		: { label: input.label ?? "", variant: "outline" as const };
	return (
		<TooltipHint content={input.tooltip}>
			<Badge className="shrink-0" id={input.id} variant={badge.variant}>
				{badge.label}
			</Badge>
		</TooltipHint>
	);
}

/** Running and queued work, each only when non-zero and reported. */
export function formatAgentWorkloadParts(input: {
	runningCount: number | null;
	queuedCount: number | null;
}): string[] {
	return [
		input.runningCount ? `${input.runningCount} running` : null,
		input.queuedCount ? `${input.queuedCount} queued` : null,
	].filter((part): part is string => part !== null);
}

function describeRow(row: MemberAgentDirectoryRow): string {
	if (row.setup === "creating") {
		return "Setting up this Agent…";
	}
	return [
		row.profiles.length > 1 ? `${row.profiles.length} Profiles` : null,
		...formatAgentWorkloadParts(row.presence),
		row.latestSession ? `Latest: ${row.latestSession.title}` : "No chats yet",
	]
		.filter(Boolean)
		.join(" · ");
}

/**
 * The signed-in member's Agents: one row per MemberAgent, then the Profiles
 * that belong to no MemberAgent. Unassigned Profiles keep their ordinary
 * Profile card; opening one reaches the controller switcher that assigns it.
 */
export function MemberAgentDirectorySection(input: {
	/** Installed, turned-off Harnesses the member can add, under their Agents. */
	addable?: ReactNode;
	directory: MemberAgentDirectory;
	label: string;
	/** No Agents yet: connecting a computer detects them; creating is secondary. */
	emptyActions: {
		connectComputerPath: string;
		onCreateAgent?: () => void;
	};
	onOpenMemberAgent: (memberAgentId: string) => void;
	renderUnassignedCard: (
		profile: MemberAgentDirectory["unassigned"][number],
		index: number
	) => ReactNode;
}) {
	const { rows, unassigned } = input.directory;
	if (rows.length === 0 && unassigned.length === 0) {
		return (
			<div className="space-y-6">
				<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
					<p>No Agents yet. Connect a computer to detect your harnesses.</p>
					<Link
						className={buttonVariants({ size: "sm" })}
						to={input.emptyActions.connectComputerPath}
					>
						Connect computer
					</Link>
					{input.emptyActions.onCreateAgent ? (
						<Button
							onClick={input.emptyActions.onCreateAgent}
							size="sm"
							variant="secondary"
						>
							Create Agent
						</Button>
					) : null}
				</div>
				{input.addable}
			</div>
		);
	}
	return (
		<div className="space-y-6">
			{rows.length > 0 ? (
				<AgentCardNavMenu activeValue={null} aria-label={input.label}>
					{rows.map((row, index) => (
						<FluidNavMenuItem
							index={index}
							key={row.memberAgentId}
							value={row.memberAgentId}
						>
							<AgentCard
								badge={
									row.setup === "creating" ? (
										<Badge variant="outline">Setting up</Badge>
									) : (
										<MemberAgentStateBadge state={row.presence.state} />
									)
								}
								description={describeRow(row)}
								// The owner group's header names the owner.
								name={formatHarnessDisplayName(row.harnessKind)}
								onClick={() => input.onOpenMemberAgent(row.memberAgentId)}
								profileId={row.memberAgentId}
								renderAvatar={(size) => (
									<HarnessLogo harnessKind={row.harnessKind} size={size} />
								)}
							/>
						</FluidNavMenuItem>
					))}
				</AgentCardNavMenu>
			) : null}
			{input.addable}
			{unassigned.length > 0 ? (
				<section aria-label="Unassigned Profiles" className="space-y-3">
					<div>
						<h3 className="font-medium text-sm">Unassigned</h3>
						<p className="text-muted-foreground text-xs">
							These Profiles don’t belong to an Agent yet. Open one and choose
							its controller to assign it.
						</p>
					</div>
					<AgentCardNavMenu activeValue={null} aria-label="Unassigned Profiles">
						{unassigned.map(input.renderUnassignedCard)}
					</AgentCardNavMenu>
				</section>
			) : null}
		</div>
	);
}
