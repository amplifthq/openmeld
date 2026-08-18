import { agentActivityProviderSchema } from "@openmeld/schemas";
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
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { InfoIcon, XIcon } from "@phosphor-icons/react";
import type { ActivityViewFilters } from "./agent-activity-derive";
import { AgentActivityEmptySetup } from "./agent-activity-empty-setup";
import {
	useAgentActivityData,
	useAgentActivityView,
} from "./agent-activity-page";
import { AgentActivitySessionTable } from "./agent-activity-session-table";

const ALL_VALUE = "all";
const FOUR_HOURS_MS = 4 * 60 * 60_000;

export type AgentActivitySessionsFilters = Omit<
	ActivityViewFilters,
	"projectId"
> & {
	memberUserId: string | null;
};

export function AgentActivitySessions(input: {
	filters: AgentActivitySessionsFilters;
	onFiltersChange: (filters: AgentActivitySessionsFilters) => void;
}) {
	const data = useAgentActivityData();
	const view = useAgentActivityView(input.filters, FOUR_HOURS_MS);
	const memberName = input.filters.memberUserId
		? (data.membersByUserId.get(input.filters.memberUserId)?.name ?? "Member")
		: null;
	const isTruncated =
		data.snapshotQuery.data?.sessionsTruncated === true ||
		data.snapshotQuery.data?.digestsTruncated === true;
	const hasFilters =
		input.filters.memberUserId !== null ||
		input.filters.provider !== null ||
		input.filters.status !== null;
	const emptyMessage = resolveSessionsEmptyMessage({
		clearFilters: () =>
			input.onFiltersChange({
				memberUserId: null,
				provider: null,
				status: null,
			}),
		hasFilters,
		isError: data.snapshotQuery.isError,
		isPending: data.snapshotQuery.isPending,
		setupState: view?.setupState ?? null,
	});
	return (
		<section
			aria-labelledby="agent-activity-sessions-heading"
			className="grid gap-3"
		>
			<div>
				<h2
					className="font-medium text-xl"
					id="agent-activity-sessions-heading"
				>
					Sessions
				</h2>
				<p className="text-muted-foreground text-sm">
					Review public session metadata across this Organization.
				</p>
			</div>
			<Card className="rounded-md py-0">
				<CardHeader className="border-b py-3">
					<CardTitle>Session history</CardTitle>
					<CardDescription>
						{String(view?.sessions.length ?? 0)} matching sessions
					</CardDescription>
					{isTruncated ? (
						<CardAction>
							<Tooltip>
								<TooltipTrigger
									aria-label="About the Session history limit"
									className="text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
								>
									<InfoIcon aria-hidden="true" className="size-3.5" />
								</TooltipTrigger>
								<TooltipContent className="max-w-72 text-left leading-5">
									This view contains the newest 500 matching records. Use the
									filters below to narrow the activity shown.
								</TooltipContent>
							</Tooltip>
						</CardAction>
					) : null}
				</CardHeader>
				<CardContent className="px-0">
					<div className="flex flex-wrap items-end gap-2 border-b px-3 py-3">
						<SessionFilterSelect
							label="Provider"
							onChange={(provider) =>
								input.onFiltersChange({
									...input.filters,
									provider:
										provider === null
											? null
											: agentActivityProviderSchema.parse(provider),
								})
							}
							options={
								view?.facets.providers.map((facet) => ({
									label: `${facet.label} · ${String(facet.count)}`,
									value: facet.id,
								})) ?? []
							}
							placeholder="All Providers"
							value={input.filters.provider}
						/>
						<SessionFilterSelect
							label="Status"
							onChange={(status) =>
								input.onFiltersChange({ ...input.filters, status })
							}
							options={
								view?.facets.statuses.map((facet) => ({
									label: `${facet.label} · ${String(facet.count)}`,
									value: facet.id,
								})) ?? []
							}
							placeholder="All Statuses"
							value={input.filters.status}
						/>
						{memberName ? (
							<Button
								onClick={() =>
									input.onFiltersChange({
										...input.filters,
										memberUserId: null,
									})
								}
								size="sm"
								variant="secondary"
							>
								Member: {memberName} <XIcon aria-hidden="true" />
							</Button>
						) : null}
					</div>
					<AgentActivitySessionTable
						emptyMessage={emptyMessage}
						membersByUserId={data.membersByUserId}
						mode="all"
						nowMs={data.currentTimeMs}
						projects={data.projects}
						sessions={view?.sessions ?? []}
					/>
				</CardContent>
			</Card>
		</section>
	);
}

function resolveSessionsEmptyMessage(input: {
	clearFilters: () => void;
	hasFilters: boolean;
	isError: boolean;
	isPending: boolean;
	setupState: "active" | "awaiting_first_session" | "no_projects" | null;
}) {
	if (input.isPending) {
		return "Loading sessions…";
	}
	if (input.isError) {
		return "Sessions are unavailable.";
	}
	if (
		input.setupState === "no_projects" ||
		input.setupState === "awaiting_first_session"
	) {
		return <AgentActivityEmptySetup setupState={input.setupState} />;
	}
	return (
		<span className="inline-flex flex-col items-center gap-3 py-2">
			<span>No sessions match these filters.</span>
			{input.hasFilters ? (
				<Button onClick={input.clearFilters} size="sm" variant="outline">
					Clear filters
				</Button>
			) : null}
		</span>
	);
}

function SessionFilterSelect(input: {
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
