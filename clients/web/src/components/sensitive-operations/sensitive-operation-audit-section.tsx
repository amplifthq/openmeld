import type {
	SensitiveOperation,
	SensitiveOperationAuditEvent,
	SensitiveOperationOutcome,
	SensitiveOperationSourceKind,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArchiveIcon,
	BrainIcon,
	FolderIcon,
	FolderOpenIcon,
	GearSixIcon,
	HandIcon,
	KeyIcon,
	LinkBreakIcon,
	LinkIcon,
	ListChecksIcon,
	LockSimpleIcon,
	ShieldCheckIcon,
	SlidersHorizontalIcon,
	TrashIcon,
	UserCheckIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { type ComponentType, useState } from "react";
import { formatRelativeTime } from "#/components/organizations/agent-activity-derive";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useMemberAgentSensitiveOperationAudit } from "#/query/sensitive-operations";

const COLLAPSED_ENTRY_COUNT = 5;
const DAY_MS = 86_400_000;

type IconComponent = ComponentType<{
	className?: string;
	"aria-hidden"?: "true";
}>;

/** What changed, as a log entry: one icon and a one-line title. */
const OPERATION_PRESENTATION: Record<
	SensitiveOperation,
	{ icon: IconComponent; title: string }
> = {
	agent_access_decision: {
		icon: UserCheckIcon,
		title: "Access request answered",
	},
	agent_access_grant_revoke: { icon: KeyIcon, title: "Access revoked" },
	agent_interaction_answer: {
		icon: ShieldCheckIcon,
		title: "Approval answered",
	},
	binding_collaboration_mode: {
		icon: HandIcon,
		title: "Collaboration mode changed",
	},
	binding_disable: { icon: LinkBreakIcon, title: "Agent disconnected" },
	binding_ensure: { icon: LinkIcon, title: "Agent connected" },
	binding_model_selection: { icon: BrainIcon, title: "Model changed" },
	binding_opencode_permission: {
		icon: LockSimpleIcon,
		title: "OpenCode permission changed",
	},
	binding_permission_mode: {
		icon: LockSimpleIcon,
		title: "Permission mode changed",
	},
	creation_defaults_write: {
		icon: SlidersHorizontalIcon,
		title: "New Agent defaults changed",
	},
	default_project_write: {
		icon: FolderOpenIcon,
		title: "Default Project changed",
	},
	execution_mode_write: {
		icon: SlidersHorizontalIcon,
		title: "Concurrent tasks changed",
	},
	profile_delete: { icon: TrashIcon, title: "Profile deleted" },
	session_archive: { icon: ArchiveIcon, title: "Chat archived" },
	session_delete: { icon: TrashIcon, title: "Chat deleted" },
	runtime_settings_write: { icon: GearSixIcon, title: "Settings changed" },
	space_delete: { icon: TrashIcon, title: "Space deleted" },
	space_members_add_agent: { icon: UsersThreeIcon, title: "Added to a Space" },
	work_recovery: { icon: ListChecksIcon, title: "Queued work reviewed" },
	working_folder_write: { icon: FolderIcon, title: "Working folder changed" },
};

const SOURCE_LABELS: Record<SensitiveOperationSourceKind, string> = {
	center_agent: "Center Agent",
	cli_credential: "Your computer's sign-in",
	task_credential: "An Agent task",
	web_session: "Web or app",
};

/** Shown only when a change did not simply go through. */
const OUTCOME_STATUS: Partial<
	Record<SensitiveOperationOutcome, { label: string; className: string }>
> = {
	confirmation_required: {
		label: "Waiting for you",
		className: "text-amber-600 dark:text-amber-400",
	},
	declined: { label: "Declined", className: "text-muted-foreground" },
	failed: { label: "Failed", className: "text-destructive" },
	rejected: { label: "Blocked", className: "text-destructive" },
};

const absoluteTimeFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});
const dayFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

/** Owner-only: a compact log of sensitive changes to this Agent. */
export function SensitiveOperationAuditSection(input: {
	memberAgentId: string;
	/** Profile names to tell entries apart; empty for a one-Profile Agent. */
	profileNames: ReadonlyMap<string, string>;
}) {
	if (!isMemberAgentsEnabled()) {
		return null;
	}
	return <SensitiveOperationAuditList {...input} />;
}

function SensitiveOperationAuditList(input: {
	memberAgentId: string;
	profileNames: ReadonlyMap<string, string>;
}) {
	const audit = useMemberAgentSensitiveOperationAudit(input.memberAgentId);
	const [showAll, setShowAll] = useState(false);
	const events = audit.data ?? [];
	const visible = showAll ? events : events.slice(0, COLLAPSED_ENTRY_COUNT);
	const nowMs = Date.now();
	return (
		<section
			aria-labelledby="sensitive-operation-audit-heading"
			className="grid gap-1"
		>
			<h2
				className="px-2 font-medium text-muted-foreground text-xs"
				id="sensitive-operation-audit-heading"
			>
				Recent changes
			</h2>
			{audit.isPending ? (
				<SkeletonRows label="Loading changes" rows={2} />
			) : null}
			{audit.isError ? (
				<p className="px-2 text-destructive text-sm" role="alert">
					Couldn't load recent changes.
				</p>
			) : null}
			{audit.data?.length === 0 ? (
				<p className="px-2 text-muted-foreground text-sm">No changes yet.</p>
			) : null}
			{groupAuditEventsByDay(visible, nowMs).map((group) => (
				<div className="grid" key={group.key}>
					<h3 className="px-2 pt-2 pb-1 text-[11px] text-muted-foreground uppercase tracking-wide">
						{group.label}
					</h3>
					<ul className="grid">
						{group.events.map((event) => (
							<AuditRow
								event={event}
								key={event.id}
								nowMs={nowMs}
								profileName={
									event.agentProfileId
										? (input.profileNames.get(event.agentProfileId) ?? null)
										: null
								}
							/>
						))}
					</ul>
				</div>
			))}
			{events.length > COLLAPSED_ENTRY_COUNT ? (
				<Button
					className="justify-self-start px-2 text-muted-foreground"
					onClick={() => setShowAll((current) => !current)}
					size="sm"
					type="button"
					variant="link"
				>
					{showAll ? "Show less" : `Show all ${String(events.length)}`}
				</Button>
			) : null}
		</section>
	);
}

function AuditRow(input: {
	event: SensitiveOperationAuditEvent;
	profileName: string | null;
	nowMs: number;
}) {
	const { event } = input;
	const presentation = OPERATION_PRESENTATION[event.operation];
	const Icon = presentation.icon;
	const status = OUTCOME_STATUS[event.outcome];
	return (
		<li className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
			<span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted/30 text-muted-foreground">
				<Icon aria-hidden="true" className="size-3.5" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm">{presentation.title}</span>
				<span className="block truncate text-muted-foreground text-xs">
					{[input.profileName, SOURCE_LABELS[event.sourceKind]]
						.filter(Boolean)
						.join(" · ")}
					{" · "}
					<Tooltip>
						<TooltipTrigger
							render={
								<time dateTime={new Date(event.createdAtMs).toISOString()} />
							}
						>
							{formatRelativeTime(event.createdAtMs, input.nowMs)}
						</TooltipTrigger>
						<TooltipContent side="top">
							{absoluteTimeFormatter.format(event.createdAtMs)}
						</TooltipContent>
					</Tooltip>
				</span>
			</span>
			{status ? (
				<span className={cn("shrink-0 text-xs", status.className)}>
					{status.label}
				</span>
			) : null}
		</li>
	);
}

/** Newest first, one group per local day: Today, Yesterday, then dates. */
export function groupAuditEventsByDay(
	events: readonly SensitiveOperationAuditEvent[],
	nowMs: number
): { key: string; label: string; events: SensitiveOperationAuditEvent[] }[] {
	const today = startOfLocalDay(nowMs);
	const groups: {
		key: string;
		label: string;
		events: SensitiveOperationAuditEvent[];
	}[] = [];
	for (const event of events) {
		const day = startOfLocalDay(event.createdAtMs);
		const key = String(day);
		const last = groups.at(-1);
		if (last?.key === key) {
			last.events.push(event);
			continue;
		}
		groups.push({ key, label: formatDayLabel(day, today), events: [event] });
	}
	return groups;
}

function startOfLocalDay(timestampMs: number): number {
	const date = new Date(timestampMs);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function formatDayLabel(dayMs: number, todayMs: number): string {
	if (dayMs === todayMs) {
		return "Today";
	}
	// Daylight-saving days are 23 or 25 hours long.
	if (Math.round((todayMs - dayMs) / DAY_MS) === 1) {
		return "Yesterday";
	}
	return dayFormatter.format(dayMs);
}
