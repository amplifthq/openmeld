import type { AgentActivitySnapshotResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@openmeld/ui/components/toggle-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	resolveStatusToneIndicatorClassName,
	resolveStatusToneStrongTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { useState } from "react";
import {
	type ActivityMemberLane,
	type ActivitySubLane,
	type ActivityView,
	formatDuration,
	formatProviderName,
	formatRelativeTime,
} from "./agent-activity-derive";
import {
	AgentActivityFoldedAvatarGroup,
	AgentActivityMemberAvatar,
} from "./agent-activity-member-avatar";
import type { AgentActivityWindowPreset } from "./agent-activity-window";

const WINDOW_OPTIONS = [
	{ label: "1h", value: "1h" },
	{ label: "4h", value: "4h" },
	{ label: "Today", value: "today" },
] as const satisfies readonly {
	label: string;
	value: AgentActivityWindowPreset;
}[];
const HOUR_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

export function AgentActivityRhythm(input: {
	onMemberClick: (memberUserId: string) => void;
	onWindowChange: (preset: AgentActivityWindowPreset) => void;
	snapshot: AgentActivitySnapshotResponse;
	view: ActivityView;
	windowPreset: AgentActivityWindowPreset;
}) {
	const [showFoldedMembers, setShowFoldedMembers] = useState(false);
	const longestRun = input.view.timeline.longestRun;
	return (
		<Card className="agent-activity-rhythm h-full rounded-md bg-card py-0">
			<CardHeader className="border-b py-3">
				<CardTitle className="text-base">Activity timeline</CardTitle>
				<CardDescription>
					as of{" "}
					{formatRelativeTime(
						input.snapshot.asOfMs,
						input.view.timeline.windowEndMs
					)}
					{longestRun
						? ` · longest ${formatDuration(longestRun.durationMs)} · ${longestRun.member.name} / ${formatProviderName(longestRun.provider)}`
						: ""}
				</CardDescription>
				<CardAction>
					<ToggleGroup
						aria-label="Activity timeline time window"
						className="hidden sm:flex"
						onValueChange={(values) => {
							const next = values.at(-1) as
								| AgentActivityWindowPreset
								| undefined;
							if (next) {
								input.onWindowChange(next);
							}
						}}
						spacing={0}
						value={[input.windowPreset]}
						variant="outline"
					>
						{WINDOW_OPTIONS.map((option) => (
							<ToggleGroupItem
								aria-label={`Show ${option.label}`}
								key={option.value}
								value={option.value}
							>
								{option.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<div className="sm:hidden">
						<Select
							onValueChange={(value) =>
								input.onWindowChange(value as AgentActivityWindowPreset)
							}
							value={input.windowPreset}
						>
							<SelectTrigger
								aria-label="Activity timeline time window"
								className="h-8 min-w-24 rounded-md"
								displayValue={
									WINDOW_OPTIONS.find(
										(option) => option.value === input.windowPreset
									)?.label
								}
							/>
							<SelectContent align="end">
								{WINDOW_OPTIONS.map((option, index) => (
									<SelectItem
										index={index}
										key={option.value}
										value={option.value}
									>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col px-0">
				<div className="overflow-x-auto">
					<div className="min-w-[610px]">
						<TimelineHeader view={input.view} />
						{input.view.memberLanes.length > 0 ? (
							<div>
								{input.view.memberLanes.flatMap((memberLane) =>
									memberLane.subLanes.map((subLane, subLaneIndex) => (
										<ActivityLaneRow
											isFirstForMember={subLaneIndex === 0}
											key={`${memberLane.memberUserId}:${subLane.provider}:${subLane.projectId}`}
											memberLane={memberLane}
											onClick={() =>
												input.onMemberClick(memberLane.memberUserId)
											}
											subLane={subLane}
										/>
									))
								)}
							</div>
						) : (
							<div className="border-t px-4 py-5">
								<p className="text-muted-foreground text-sm">
									No activity in this window.
								</p>
							</div>
						)}
					</div>
				</div>
				{input.view.foldedMembers.length > 0 ? (
					<div className="mt-auto border-t border-dashed px-4 py-3">
						<div className="flex flex-wrap items-center gap-3">
							<AgentActivityFoldedAvatarGroup
								members={input.view.foldedMembers}
							/>
							<p className="min-w-0 flex-1 text-muted-foreground text-xs">
								{String(input.view.foldedMembers.length)}{" "}
								{input.view.foldedMembers.length === 1 ? "member" : "members"}{" "}
								with no activity in this window
							</p>
							<Button
								onClick={() => setShowFoldedMembers((visible) => !visible)}
								size="sm"
								variant="ghost"
							>
								{showFoldedMembers ? "Hide" : "Show"}
							</Button>
						</div>
						{showFoldedMembers ? (
							<ul className="mt-2 grid gap-1 border-t border-dashed pt-2 text-xs">
								{input.view.foldedMembers.map((member) => (
									<li
										className="flex items-center justify-between gap-3"
										key={member.memberUserId}
									>
										<span>{member.member.name}</span>
										<span className="font-mono text-muted-foreground">
											{member.relativeTimeLabel}
										</span>
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function TimelineHeader(input: { view: ActivityView }) {
	return (
		<div className="grid grid-cols-[200px_minmax(300px,1fr)_110px] items-end border-b px-4 pb-1 text-[10px] text-muted-foreground">
			<span>Member · source</span>
			<div aria-hidden="true" className="relative h-5">
				{input.view.timeline.ticks.map((tick) => (
					<span
						className={cn(
							"absolute bottom-0 -translate-x-1/2 font-mono tabular-nums",
							tick.isNow && resolveStatusToneStrongTextClassName("ready")
						)}
						key={`${String(tick.timestampMs)}:${String(tick.isNow)}`}
						style={{ left: `${String(tick.positionPercent)}%` }}
					>
						{tick.isNow ? "Now" : formatHour(tick.timestampMs)}
					</span>
				))}
			</div>
			<span className="pl-3">Status</span>
		</div>
	);
}

function ActivityLaneRow(input: {
	isFirstForMember: boolean;
	memberLane: ActivityMemberLane;
	onClick: () => void;
	subLane: ActivitySubLane;
}) {
	const statusLabel = formatLaneStatus(input.subLane);
	const ariaLabel = `${input.memberLane.member.name} · ${formatProviderName(
		input.subLane.provider
	)} · ${formatSemanticLaneStatus(input.subLane)}`;
	return (
		<button
			aria-label={ariaLabel}
			className="grid w-full grid-cols-[200px_minmax(300px,1fr)_110px] items-center border-b px-4 py-2 text-left outline-none transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:bg-muted/30"
			onClick={input.onClick}
			type="button"
		>
			<div className="min-w-0 pr-3">
				{input.isFirstForMember ? (
					<div className="flex min-w-0 items-center gap-2">
						<AgentActivityMemberAvatar
							active={input.memberLane.hasActive}
							member={input.memberLane.member}
							size="sm"
						/>
						<div className="min-w-0">
							<p className="truncate font-medium text-xs">
								{input.memberLane.member.name}
							</p>
							<p className="truncate text-[11px] text-muted-foreground">
								{formatProviderName(input.subLane.provider)} ·{" "}
								{input.subLane.projectName}
							</p>
						</div>
					</div>
				) : (
					<p className="truncate pl-8 text-[11px] text-muted-foreground">
						{formatProviderName(input.subLane.provider)} ·{" "}
						{input.subLane.projectName}
					</p>
				)}
			</div>
			<ActivityBand subLane={input.subLane} />
			<p
				className={cn(
					"pl-3 font-mono text-[11px] tabular-nums",
					resolveStatusToneStrongTextClassName(input.subLane.tone)
				)}
			>
				{statusLabel}
			</p>
		</button>
	);
}

function ActivityBand(input: { subLane: ActivitySubLane }) {
	return (
		<div className="relative h-5 overflow-hidden bg-muted/40">
			{[25, 50, 75].map((position) => (
				<span
					aria-hidden="true"
					className="absolute inset-y-0 border-l"
					key={position}
					style={{ left: `${String(position)}%` }}
				/>
			))}
			{input.subLane.segments.map((segment) => (
				<span
					aria-label={`${segment.sessionName} · ${
						segment.isActive ? "working" : segment.session.status
					} · ${segment.durationLabel}`}
					className={cn(
						"absolute inset-y-1 min-w-1.5",
						resolveStatusToneIndicatorClassName(segment.tone, "solid"),
						resolveStatusToneStrongTextClassName(segment.tone),
						segment.isActive && "agent-activity-active-segment"
					)}
					key={segment.session.id}
					role="img"
					style={{
						left: `${String(segment.startPercent)}%`,
						width: segment.isPoint
							? undefined
							: `${String(segment.widthPercent)}%`,
					}}
					title={`${segment.sessionName} · ${segment.durationLabel}`}
				/>
			))}
		</div>
	);
}

function formatLaneStatus(subLane: ActivitySubLane) {
	if (subLane.status === "working") {
		return `● working ${subLane.statusDurationLabel}`;
	}
	if (subLane.status === "idle") {
		return `◐ idle ${subLane.statusDurationLabel}`;
	}
	return `○ ${subLane.statusDurationLabel}`;
}

function formatSemanticLaneStatus(subLane: ActivitySubLane) {
	if (subLane.status === "working") {
		return `working ${subLane.statusDurationLabel}`;
	}
	if (subLane.status === "idle") {
		return `idle ${subLane.statusDurationLabel}`;
	}
	return subLane.statusDurationLabel;
}

function formatHour(timestampMs: number) {
	return HOUR_FORMATTER.format(new Date(timestampMs));
}
