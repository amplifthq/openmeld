import type {
	AgentActivityInventoryCoverage,
	LocalAgentSessionProvider,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { AgentActivityEmptySetup } from "./agent-activity-empty-setup";

const ALL_VALUE = "all";

export function CoverageNotice(input: {
	coverage: AgentActivityInventoryCoverage[];
}) {
	const nonCurrent = input.coverage.filter((item) => item.state !== "current");
	if (nonCurrent.length === 0) {
		return null;
	}
	const counts = new Map<string, number>();
	for (const item of nonCurrent) {
		const key = `${formatProvider(item.provider)} · ${formatCoverageState(item.state)}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return (
		<output className="rounded-md border border-border/70 bg-card/35 px-4 py-3">
			<p className="font-medium text-sm">Session coverage needs attention</p>
			<p className="mt-1 text-muted-foreground text-sm leading-6">
				{Array.from(counts.entries())
					.map(
						([label, count]) =>
							`${label}${count > 1 ? ` (${String(count)})` : ""}`
					)
					.join(" · ")}
				. Existing Sessions remain visible only when the latest complete
				inventory is still safe to show.
			</p>
		</output>
	);
}

export function SessionsEmptyMessage(input: {
	clearFilters: () => void;
	coverage: AgentActivityInventoryCoverage[];
	hasFilters: boolean;
	isError: boolean;
	isPending: boolean;
	projectCount: number;
}) {
	if (input.isPending) {
		return "Loading Sessions…";
	}
	if (input.isError) {
		return "Session Inventory is unavailable. OpenMeld kept the error visible instead of guessing from Activity events.";
	}
	if (input.projectCount === 0) {
		return <AgentActivityEmptySetup setupState="no_projects" />;
	}
	if (input.coverage.length === 0 && !input.hasFilters) {
		return <AgentActivityEmptySetup setupState="awaiting_first_session" />;
	}
	if (input.hasFilters) {
		return (
			<span className="inline-flex flex-col items-center gap-3 py-2">
				<span>No Sessions match these filters.</span>
				<Button onClick={input.clearFilters} size="sm" variant="outline">
					Clear filters
				</Button>
			</span>
		);
	}
	if (input.coverage.some((item) => item.state === "error")) {
		return "OpenMeld couldn't establish the current Session Inventory. No Sessions are shown until the connected computer reports a complete inventory.";
	}
	if (input.coverage.some((item) => item.state === "stale")) {
		return "Session Inventory is stale, so OpenMeld isn't claiming there are no Sessions. Wait for a fresh sync from the connected computer.";
	}
	if (input.coverage.some((item) => item.state === "unsupported")) {
		return "Session discovery is not supported for the connected Local Agent yet.";
	}
	if (input.coverage.some((item) => item.state === "disconnected")) {
		return "The connected Project is no longer available. Its Sessions are not selectable.";
	}
	if (
		input.coverage.some(
			(item) => item.state === "waiting" || item.state === "syncing"
		)
	) {
		return "Waiting for the first complete Session sync from the connected computer.";
	}
	return "No Sessions are currently available from connected Projects.";
}

export function SessionFilterSelect(input: {
	label: string;
	onChange: (value: string | null) => void;
	options: { label: string; value: string }[];
	placeholder: string;
	value: string | null;
}) {
	return (
		<div className="grid min-w-40 gap-1 text-muted-foreground text-xs">
			<span>{input.label}</span>
			<Select
				onValueChange={(value) =>
					input.onChange(value === ALL_VALUE ? null : value)
				}
				value={input.value ?? ALL_VALUE}
			>
				<SelectTrigger
					aria-label={`Filter by ${input.label}`}
					className="h-8 rounded-md"
					displayValue={
						input.value
							? input.options.find((option) => option.value === input.value)
									?.label
							: input.placeholder
					}
				/>
				<SelectContent>
					<SelectItem index={0} value={ALL_VALUE}>
						{input.placeholder}
					</SelectItem>
					{input.options.map((option, index) => (
						<SelectItem
							index={index + 1}
							key={option.value}
							value={option.value}
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function formatProvider(provider: LocalAgentSessionProvider) {
	return {
		"claude-code": "Claude Code",
		codex: "Codex",
		cursor: "Cursor",
		"grok-build": "Grok Build",
		opencode: "OpenCode",
	}[provider];
}

function formatCoverageState(state: AgentActivityInventoryCoverage["state"]) {
	return {
		current: "Current",
		disconnected: "Project disconnected",
		error: "Sync error",
		stale: "Data stale",
		syncing: "Syncing",
		unsupported: "Discovery unsupported",
		waiting: "Waiting for first sync",
	}[state];
}
