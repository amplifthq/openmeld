import type { AgentActivityInventorySession } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { resolveStatusToneBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { formatRelativeTime } from "./agent-activity-derive";

export type AgentActivitySessionAction =
	| "add_to_space"
	| "create_profile"
	| "fork_profile"
	| "resume_profile";

const ORIGIN_LABELS = {
	local: "Created locally",
	openmeld: "Created by OpenMeld",
	unknown: "Origin uncertain",
} satisfies Record<AgentActivityInventorySession["origin"], string>;

const COMPUTER_STATE_DISPLAYS = {
	offline: { label: "Offline", tone: "muted" },
	online: { label: "Online", tone: "ready" },
	unknown: { label: "State unknown", tone: "muted" },
} satisfies Record<
	AgentActivityInventorySession["computer"]["state"],
	{ label: string; tone: StatusTone }
>;

const SESSION_STATUS_DISPLAYS = {
	ended: { label: "Ended", tone: "muted" },
	error: { label: "Error", tone: "danger" },
	idle: { label: "Idle", tone: "warning" },
	unknown: { label: "Unknown", tone: "muted" },
	working: { label: "Working", tone: "ready" },
} satisfies Record<
	AgentActivityInventorySession["status"],
	{ label: string; tone: StatusTone }
>;

export function AgentActivitySessionInventoryTable(input: {
	currentUserId: string;
	emptyMessage: ReactNode;
	nowMs: number;
	onAction: (
		action: AgentActivitySessionAction,
		session: AgentActivityInventorySession
	) => void;
	onOpenProfile: (profileId: string) => void;
	sessions: AgentActivityInventorySession[];
}) {
	return (
		<Table className="min-w-[1120px]">
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					<TableHead>Session</TableHead>
					<TableHead>Owner</TableHead>
					<TableHead>Project</TableHead>
					<TableHead>Computer</TableHead>
					<TableHead>Local Agent</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Last active</TableHead>
					<TableHead>Agent Profile</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{input.sessions.length > 0 ? (
					input.sessions.map((session, index) => (
						<TableRow
							index={index}
							key={`${session.owner.userId}:${session.localAgent.agentControllerRef}:${session.nativeSessionId}`}
						>
							<TableCell className="max-w-72 align-top">
								<div className="grid gap-1.5">
									<span className="truncate font-medium">
										{session.nativeSessionTitle ?? "No native title"}
									</span>
									<div className="flex min-w-0 items-center gap-1.5">
										<code className="min-w-0 truncate text-[11px] text-muted-foreground">
											{session.nativeSessionId}
										</code>
										<CopySessionIdButton
											nativeSessionId={session.nativeSessionId}
										/>
									</div>
									<OriginBadge origin={session.origin} />
								</div>
							</TableCell>
							<TableCell className="align-top font-medium">
								{session.owner.name}
							</TableCell>
							<TableCell className="align-top">
								<div className="grid gap-0.5">
									<span>{session.project.name}</span>
									<span className="text-muted-foreground text-xs">
										{session.project.slug}
									</span>
								</div>
							</TableCell>
							<TableCell className="align-top">
								<div className="grid gap-1">
									<span>{session.computer.name}</span>
									<ComputerStateBadge state={session.computer.state} />
								</div>
							</TableCell>
							<TableCell className="align-top">
								<div className="grid gap-0.5">
									<span>{session.localAgent.name}</span>
									<code className="text-[11px] text-muted-foreground">
										{session.localAgent.agentControllerRef}
									</code>
								</div>
							</TableCell>
							<TableCell className="align-top">
								<SessionStatusBadge
									dataState={session.dataState}
									status={session.status}
								/>
							</TableCell>
							<TableCell className="whitespace-nowrap align-top text-muted-foreground text-sm">
								{formatRelativeTime(session.lastActiveAtMs, input.nowMs)}
							</TableCell>
							<TableCell className="align-top">
								<SessionProfileActions
									canOperate={session.owner.userId === input.currentUserId}
									onAction={(action) => input.onAction(action, session)}
									onOpenProfile={input.onOpenProfile}
									session={session}
								/>
							</TableCell>
						</TableRow>
					))
				) : (
					<TableRow className="hover:bg-transparent">
						<TableCell
							className="h-32 text-center text-muted-foreground"
							colSpan={8}
						>
							{input.emptyMessage}
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

function SessionProfileActions(input: {
	canOperate: boolean;
	onAction: (action: AgentActivitySessionAction) => void;
	onOpenProfile: (profileId: string) => void;
	session: AgentActivityInventorySession;
}) {
	if (input.session.boundAgentProfileId) {
		return (
			<div className="flex min-w-44 flex-wrap gap-1.5">
				<Button
					onClick={() => {
						input.onOpenProfile(input.session.boundAgentProfileId ?? "");
					}}
					size="xs"
					type="button"
					variant="outline"
				>
					Open Agent Profile
				</Button>
				<Button
					onClick={() => input.onAction("add_to_space")}
					size="xs"
					type="button"
					variant="ghost"
				>
					Add to Space
				</Button>
			</div>
		);
	}
	if (!input.canOperate) {
		return (
			<span className="text-muted-foreground text-xs">
				Only the Session owner can connect it.
			</span>
		);
	}

	return (
		<div className="flex min-w-44 flex-wrap gap-1.5">
			{input.session.canResume && input.session.dataState === "current" ? (
				<Button
					onClick={() => input.onAction("resume_profile")}
					size="xs"
					type="button"
					variant="outline"
				>
					Resume as Agent Profile
				</Button>
			) : (
				<Button
					onClick={() => input.onAction("create_profile")}
					size="xs"
					type="button"
					variant="outline"
				>
					Create Agent Profile
				</Button>
			)}
			{input.session.canFork ? (
				<Button
					onClick={() => input.onAction("fork_profile")}
					size="xs"
					type="button"
					variant="ghost"
				>
					Fork as Agent Profile
				</Button>
			) : null}
		</div>
	);
}

function CopySessionIdButton(input: { nativeSessionId: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			aria-label={
				copied ? "Native Session ID copied" : "Copy Native Session ID"
			}
			className="size-6 shrink-0"
			onClick={() => {
				navigator.clipboard
					.writeText(input.nativeSessionId)
					.then(() => {
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1500);
					})
					.catch((error: unknown) => {
						console.error("Failed to copy Native Session ID.", error);
					});
			}}
			size="icon-xs"
			type="button"
			variant="ghost"
		>
			{copied ? (
				<CheckIcon aria-hidden="true" />
			) : (
				<CopyIcon aria-hidden="true" />
			)}
		</Button>
	);
}

function OriginBadge(input: {
	origin: AgentActivityInventorySession["origin"];
}) {
	return (
		<Badge className="w-fit rounded-md font-normal" variant="outline">
			{ORIGIN_LABELS[input.origin]}
		</Badge>
	);
}

function ComputerStateBadge(input: {
	state: AgentActivityInventorySession["computer"]["state"];
}) {
	const display = COMPUTER_STATE_DISPLAYS[input.state];
	return (
		<Badge
			className={cn(
				"w-fit rounded-md font-normal",
				resolveStatusToneBadgeClassName(display.tone)
			)}
		>
			{display.label}
		</Badge>
	);
}

function SessionStatusBadge(input: {
	dataState: AgentActivityInventorySession["dataState"];
	status: AgentActivityInventorySession["status"];
}) {
	const display = SESSION_STATUS_DISPLAYS[input.status];
	return (
		<div className="grid gap-1">
			<Badge
				className={cn(
					"w-fit rounded-md font-mono",
					resolveStatusToneBadgeClassName(display.tone)
				)}
			>
				{display.label}
			</Badge>
			{input.dataState === "stale" ? (
				<span className="text-amber-700 text-xs dark:text-amber-300">
					Data may be stale
				</span>
			) : null}
		</div>
	);
}
