import type {
	AgentAccessDecision,
	AgentAccessRequestView,
} from "@openmeld/schemas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import { formatRelativeTime } from "#/components/organizations/agent-activity-derive";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import type { AgentAccessEntry } from "./agent-access-entries";
import { agentAccessDecisionLabel } from "./agent-access-request-card";

const ROW_AVATAR_SIZE = 28;
const HIGHLIGHT_MS = 2400;

/** The rule, worded for the person reading the row. */
export function agentAccessRuleLabel(entry: AgentAccessEntry): string {
	switch (entry.rule) {
		case "always":
			return "Always allowed";
		case "once":
			return "This chat only";
		case "waiting":
			return entry.viewerRole === "owner"
				? "Waiting for you"
				: `Waiting for ${entry.agent.ownerName ?? "the owner"}`;
		case "declined":
			return "Declined";
		case "removed":
			return "Access removed";
		case "in_space":
			return entry.agent.ownerName
				? `In this Space · ${entry.agent.ownerName}'s Agent`
				: "In this Space";
		default:
			throw new Error("Unknown Agent access rule");
	}
}

const RULE_CHANGE_VERBS: Partial<Record<AgentAccessEntry["rule"], string>> = {
	always: "Allowed",
	once: "Allowed",
	declined: "Declined",
	removed: "Removed",
};

/**
 * The secondary line: the rule, then when it took effect. When the row's
 * menu already names the rule, the line says only when it changed.
 */
export function agentAccessRowDetail(
	entry: AgentAccessEntry,
	nowMs: number,
	options: { ruleShownInControl?: boolean } = {}
): string {
	const rule = agentAccessRuleLabel(entry);
	if (!entry.decidedAt) {
		return rule;
	}
	const when = formatRelativeTime(Date.parse(entry.decidedAt), nowMs);
	const verb = RULE_CHANGE_VERBS[entry.rule];
	if (options.ruleShownInControl && verb) {
		return `${verb} ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
	}
	return `${rule} · ${when}`;
}

/** The pending-row buttons are short: the row already names the person. */
export function agentAccessRowDecisionLabel(
	decision: AgentAccessDecision,
	request: Pick<AgentAccessRequestView, "requesterName">
): string {
	return decision === "always_allow"
		? "Always allow"
		: agentAccessDecisionLabel(decision, request);
}

/**
 * What the owner can change on a decided row. The only change of rule is
 * upgrading a member's one-chat access to always; going back is removing
 * access and letting them ask again. External people are never always
 * allowed.
 */
export function resolveAgentAccessOwnerOptions(entry: AgentAccessEntry): {
	alwaysAllow: boolean;
	remove: boolean;
} {
	const always = entry.grants.some((grant) => grant.scope === "always");
	const once = entry.grants.some((grant) => grant.scope === "once");
	return {
		alwaysAllow:
			once &&
			!always &&
			entry.person?.kind === "member" &&
			Boolean(entry.person.userId),
		remove: entry.grants.length > 0,
	};
}

/** The control each viewer gets on a row; the surface never widens it. */
export type AgentAccessRowControl =
	| { kind: "owner_decide"; request: AgentAccessRequestView }
	| { kind: "owner_manage" }
	| { kind: "requester_withdraw"; request: AgentAccessRequestView }
	| { kind: "requester_ask_again" }
	| { kind: "none" };

export function resolveAgentAccessRowControl(input: {
	entry: AgentAccessEntry;
	readOnly: boolean;
	canAskAgain: boolean;
}): AgentAccessRowControl {
	const { entry } = input;
	if (input.readOnly) {
		return { kind: "none" };
	}
	if (entry.viewerRole === "owner") {
		if (
			entry.pendingRequest &&
			entry.pendingRequest.availableDecisions.length > 0
		) {
			return { kind: "owner_decide", request: entry.pendingRequest };
		}
		const options = resolveAgentAccessOwnerOptions(entry);
		return options.alwaysAllow || options.remove
			? { kind: "owner_manage" }
			: { kind: "none" };
	}
	if (entry.viewerRole === "requester") {
		if (entry.rule === "waiting" && entry.pendingRequest) {
			return { kind: "requester_withdraw", request: entry.pendingRequest };
		}
		if (
			(entry.rule === "declined" || entry.rule === "removed") &&
			input.canAskAgain
		) {
			return { kind: "requester_ask_again" };
		}
	}
	return { kind: "none" };
}

export type AgentAccessListActions = {
	busy: boolean;
	decide?: (
		request: AgentAccessRequestView,
		decision: AgentAccessDecision
	) => void;
	withdraw?: (request: AgentAccessRequestView) => void;
	alwaysAllow?: (entry: AgentAccessEntry) => void;
	/** Drops the `always` grant; the chat's own `once` grant stays. */
	/** Drops every grant the person has for the Agent. */
	removeAccess?: (entry: AgentAccessEntry) => void;
	askAgain?: (entry: AgentAccessEntry) => void;
};

export function agentAccessEntryElementId(entryId: string): string {
	return `agent-access-entry-${entryId}`;
}

/**
 * Who can use an Agent, one row per access entry. Every surface draws the
 * same rows; what a row lets the viewer change comes from the entry's
 * viewer role, and `readOnly` only takes controls away.
 */
export function AgentAccessList(input: {
	entries: readonly AgentAccessEntry[];
	actions?: AgentAccessListActions;
	readOnly?: boolean;
	/** Adds the Agent's name to each row when the list covers several Agents. */
	mixesAgents?: boolean;
	/** The row a deep link names; it scrolls into view and briefly highlights. */
	highlightId?: string | null;
	nowMs?: number;
	"aria-label"?: string;
	avatars?: ReadonlyMap<string, string | null>;
	/** Extra content under a row, such as the Spaces where it applies. */
	renderFooter?: (entry: AgentAccessEntry) => ReactNode;
	/** Shown under the list: one action's failure. */
	error?: string | null;
}) {
	const [nowMs] = useState(() => input.nowMs ?? Date.now());
	const [confirming, setConfirming] = useState<AgentAccessEntry | null>(null);
	const actions = input.actions ?? { busy: false };
	return (
		<div className="grid gap-1">
			<ul aria-label={input["aria-label"]} className="grid">
				{input.entries.map((entry) => (
					<AgentAccessRow
						actions={actions}
						avatarImageUrl={
							entry.person?.profileId
								? (input.avatars?.get(entry.person.profileId) ?? null)
								: null
						}
						control={resolveAgentAccessRowControl({
							entry,
							readOnly: input.readOnly === true,
							canAskAgain: Boolean(actions.askAgain),
						})}
						entry={entry}
						footer={input.renderFooter?.(entry)}
						highlighted={input.highlightId === entry.id}
						key={entry.id}
						mixesAgents={input.mixesAgents === true}
						nowMs={nowMs}
						onRemove={() => {
							// Removing an `always` grant reaches every chat, so it asks once.
							if (entry.grants.some((grant) => grant.scope === "always")) {
								setConfirming(entry);
							} else {
								actions.removeAccess?.(entry);
							}
						}}
					/>
				))}
			</ul>
			{input.error ? (
				<p className="px-2 text-destructive text-xs" role="alert">
					{input.error}
				</p>
			) : null}
			<RemoveAccessDialog
				entry={confirming}
				onClose={() => setConfirming(null)}
				onRemove={(entry) => actions.removeAccess?.(entry)}
			/>
		</div>
	);
}

export function AgentAccessRow(input: {
	entry: AgentAccessEntry;
	control: AgentAccessRowControl;
	actions: AgentAccessListActions;
	mixesAgents: boolean;
	highlighted: boolean;
	nowMs: number;
	avatarImageUrl: string | null;
	footer?: ReactNode;
	onRemove: () => void;
}) {
	const { entry } = input;
	const ref = useRef<HTMLLIElement>(null);
	const reduceMotion = useReducedMotion();
	const [flash, setFlash] = useState(false);
	useEffect(() => {
		if (!input.highlighted) {
			return;
		}
		ref.current?.scrollIntoView({
			behavior: reduceMotion ? "auto" : "smooth",
			block: "center",
		});
		setFlash(true);
		const timer = window.setTimeout(() => setFlash(false), HIGHLIGHT_MS);
		return () => window.clearTimeout(timer);
	}, [input.highlighted, reduceMotion]);
	const isSelf = entry.viewerRole === "requester";
	const name = entry.person
		? `${entry.person.name}${isSelf ? " (you)" : ""}`
		: entry.agent.name;
	const decides = input.control.kind === "owner_decide";
	return (
		<li
			className={cn(
				"group grid gap-2 rounded-md px-2 py-2 transition-colors duration-700 motion-reduce:transition-none",
				flash ? "bg-accent" : "hover:bg-muted/40"
			)}
			data-agent-access-entry-id={entry.id}
			data-highlighted={flash ? "true" : undefined}
			data-rule={entry.rule}
			id={agentAccessEntryElementId(entry.id)}
			ref={ref}
		>
			<div className="flex min-w-0 items-center gap-3">
				<AgentAccessRowAvatar
					avatarImageUrl={input.avatarImageUrl}
					entry={entry}
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm leading-5">
						{name}
						{input.mixesAgents && entry.person ? (
							<span className="text-muted-foreground">
								{" "}
								· {entry.agent.name}
							</span>
						) : null}
					</p>
					<p className="truncate text-muted-foreground text-xs leading-4">
						{agentAccessRowDetail(entry, input.nowMs, {
							ruleShownInControl: input.control.kind === "owner_manage",
						})}
					</p>
				</div>
				{decides ? null : (
					<AgentAccessRowControlView
						actions={input.actions}
						control={input.control}
						entry={entry}
						onRemove={input.onRemove}
					/>
				)}
			</div>
			{decides ? (
				<div className="flex flex-wrap gap-1.5 ps-10">
					<AgentAccessRowControlView
						actions={input.actions}
						control={input.control}
						entry={entry}
						onRemove={input.onRemove}
					/>
				</div>
			) : null}
			{input.footer ? <div className="ps-10">{input.footer}</div> : null}
		</li>
	);
}

function AgentAccessRowAvatar(input: {
	entry: AgentAccessEntry;
	avatarImageUrl: string | null;
}) {
	const { entry } = input;
	if (!entry.person) {
		return (
			<RemoteAgentAvatar
				profileId={entry.agent.profileId}
				profileName={entry.agent.name}
				size={ROW_AVATAR_SIZE}
			/>
		);
	}
	return (
		<DitherProfileAvatar
			avatarImageUrl={input.avatarImageUrl}
			profileId={entry.person.profileId ?? entry.person.userId ?? entry.id}
			profileKind="human"
			profileName={entry.person.name}
			size={ROW_AVATAR_SIZE}
		/>
	);
}

function AgentAccessRowControlView(input: {
	entry: AgentAccessEntry;
	control: AgentAccessRowControl;
	actions: AgentAccessListActions;
	onRemove: () => void;
}) {
	const { actions, control, entry } = input;
	switch (control.kind) {
		case "owner_decide":
			return control.request.availableDecisions.map((decision, index) => (
				<Button
					className="px-2 text-xs"
					disabled={actions.busy || !actions.decide}
					key={decision}
					onClick={() => actions.decide?.(control.request, decision)}
					size="sm"
					variant={index === 0 ? "default" : "outline"}
				>
					{agentAccessRowDecisionLabel(decision, control.request)}
				</Button>
			));
		case "owner_manage":
			return (
				<OwnerManageMenu
					actions={actions}
					entry={entry}
					onRemove={input.onRemove}
				/>
			);
		case "requester_withdraw":
			return (
				<Button
					className="shrink-0"
					disabled={actions.busy || !actions.withdraw}
					onClick={() => actions.withdraw?.(control.request)}
					size="sm"
					variant="ghost"
				>
					Withdraw
				</Button>
			);
		case "requester_ask_again":
			return (
				<Button
					className="shrink-0"
					disabled={actions.busy}
					onClick={() => actions.askAgain?.(entry)}
					size="sm"
					variant="ghost"
				>
					Ask again
				</Button>
			);
		default:
			return null;
	}
}

/**
 * The owner's menu on a decided row: upgrade a member's one-chat access to
 * always, or remove access.
 */
function OwnerManageMenu(input: {
	entry: AgentAccessEntry;
	actions: AgentAccessListActions;
	onRemove: () => void;
}) {
	const { actions, entry } = input;
	const options = resolveAgentAccessOwnerOptions(entry);
	const name = entry.person?.name ?? entry.agent.name;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`${agentAccessRuleLabel(entry)}, change access for ${name}`}
						className="shrink-0 gap-1 text-muted-foreground"
						disabled={actions.busy}
						size="sm"
						variant="ghost"
					>
						{agentAccessRuleLabel(entry)}
						<CaretDownIcon aria-hidden="true" className="size-3" />
					</Button>
				}
			/>
			<FluidDropdownMenuContent align="end" className="min-w-44">
				{options.alwaysAllow ? (
					<>
						<FluidDropdownMenuGroup>
							<FluidDropdownMenuItem
								index={0}
								onClick={() => actions.alwaysAllow?.(entry)}
							>
								Always allow {name}
							</FluidDropdownMenuItem>
						</FluidDropdownMenuGroup>
						<DropdownMenuSeparator />
					</>
				) : null}
				<FluidDropdownMenuGroup>
					<FluidDropdownMenuItem
						index={options.alwaysAllow ? 1 : 0}
						onClick={input.onRemove}
						variant="destructive"
					>
						Remove access
					</FluidDropdownMenuItem>
				</FluidDropdownMenuGroup>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}

function RemoveAccessDialog(input: {
	entry: AgentAccessEntry | null;
	onClose: () => void;
	onRemove: (entry: AgentAccessEntry) => void;
}) {
	const { entry } = input;
	const person = entry?.person?.name ?? "this person";
	const agent = entry?.agent.name ?? "this Agent";
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open={entry !== null}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove {person}'s access?</AlertDialogTitle>
					<AlertDialogDescription>
						This applies to every chat with {agent}. {person} will ask you again
						before new work. Anything already running finishes.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							if (entry) {
								input.onRemove(entry);
							}
							input.onClose();
						}}
						variant="destructive"
					>
						Remove access
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
