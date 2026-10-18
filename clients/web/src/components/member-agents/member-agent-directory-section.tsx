import type { HarnessKind } from "@openmeld/schemas";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AgentCard } from "#/components/agents/agent-card";
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

export function formatMemberAgentWorkload(input: {
	runningCount: number | null;
	queuedCount: number | null;
}): string {
	if (input.runningCount === null || input.queuedCount === null) {
		return "Work not reported";
	}
	return `${input.runningCount} running · ${input.queuedCount} queued`;
}

function describeRow(row: MemberAgentDirectoryRow): string {
	const profiles = `${row.profiles.length} ${row.profiles.length === 1 ? "Profile" : "Profiles"}`;
	const latest = row.latestSession
		? `Latest: ${row.latestSession.title}`
		: "No chats yet";
	return `${profiles} · ${formatMemberAgentWorkload(row.presence)} · ${latest}`;
}

/**
 * The signed-in member's Agents: one row per MemberAgent, then the Profiles
 * that belong to no MemberAgent. Unassigned Profiles keep their ordinary
 * Profile card; opening one reaches the controller switcher that assigns it.
 */
export function MemberAgentDirectorySection(input: {
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
		);
	}
	return (
		<div className="space-y-6">
			{rows.length > 0 ? (
				<FluidCardGroup>
					<FluidNavMenu
						activeValue={null}
						aria-label={input.label}
						className="[&_[data-sidebar=menu]]:grid [&_[data-sidebar=menu]]:gap-3 [&_[data-sidebar=menu]]:md:grid-cols-2 [&_[data-sidebar=menu]]:xl:grid-cols-3"
					>
						{rows.map((row, index) => (
							<FluidNavMenuItem
								index={index}
								key={row.memberAgentId}
								value={row.memberAgentId}
							>
								<AgentCard
									badge={<MemberAgentStateBadge state={row.presence.state} />}
									description={describeRow(row)}
									name={row.displayName}
									onClick={() => input.onOpenMemberAgent(row.memberAgentId)}
									profileId={row.memberAgentId}
									renderAvatar={(size) => (
										<HarnessLogo harnessKind={row.harnessKind} size={size} />
									)}
								/>
							</FluidNavMenuItem>
						))}
					</FluidNavMenu>
				</FluidCardGroup>
			) : null}
			{unassigned.length > 0 ? (
				<section aria-label="Unassigned Profiles" className="space-y-3">
					<div>
						<h3 className="font-medium text-sm">Unassigned</h3>
						<p className="text-muted-foreground text-xs">
							These Profiles don’t belong to an Agent yet. Open one and choose
							its controller to assign it.
						</p>
					</div>
					<FluidCardGroup>
						<FluidNavMenu
							activeValue={null}
							aria-label="Unassigned Profiles"
							className="[&_[data-sidebar=menu]]:grid [&_[data-sidebar=menu]]:gap-3 [&_[data-sidebar=menu]]:md:grid-cols-2 [&_[data-sidebar=menu]]:xl:grid-cols-3"
						>
							{unassigned.map(input.renderUnassignedCard)}
						</FluidNavMenu>
					</FluidCardGroup>
				</section>
			) : null}
		</div>
	);
}
