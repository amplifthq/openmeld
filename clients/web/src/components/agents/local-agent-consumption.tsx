import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { organizationAiUsageQueryOptions } from "#/query/organizations/organization-usage";

export type LocalAgentConsumptionScope = {
	organizationId: string;
	computerId: string;
};
type Props = LocalAgentConsumptionScope & { controller: string };
export function localAgentConsumptionScope(
	organizationId?: string,
	computerId?: string
): LocalAgentConsumptionScope | undefined {
	return organizationId && computerId
		? { organizationId, computerId }
		: undefined;
}
const compactTokens = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const exactTokens = new Intl.NumberFormat("en-US");

function consumptionQuery(input: Props, days: number, tasks = false) {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const from = new Date(today);
	from.setDate(from.getDate() - days + 1);
	const to = new Date(today);
	to.setDate(to.getDate() + 1);
	return organizationAiUsageQueryOptions({
		organizationId: input.organizationId,
		query: {
			computerId: input.computerId,
			controller: input.controller,
			runtime: "local",
			fromMs: from.getTime(),
			toMs: to.getTime(),
			...(tasks
				? ({ groupBy: "task", sortBy: "tokens", limit: 5 } as const)
				: {}),
		},
	});
}

function totalTokens(data?: AiUsageQueryResponse) {
	return data?.models.reduce((sum, model) => sum + model.totalTokens, 0) ?? 0;
}

export function LocalAgentConsumptionPreview(input: Props) {
	const query = useQuery(consumptionQuery(input, 1));
	const total = totalTokens(query.data);
	if (total === 0) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs tabular-nums">
			{compactTokens.format(total)} tokens today
		</p>
	);
}

export function LocalAgentConsumptionDetails(input: Props) {
	const [selectedDays, setSelectedDays] = useState<number | null>(null);
	const today = useQuery(consumptionQuery(input, 1));
	const week = useQuery(consumptionQuery(input, 7));
	const days = selectedDays === 7 || totalTokens(today.data) === 0 ? 7 : 1;
	const query = days === 1 ? today : week;
	const models =
		query.data?.models.filter((model) => model.totalTokens > 0) ?? [];
	const total = totalTokens(query.data);
	if (totalTokens(today.data) === 0 && totalTokens(week.data) === 0) {
		return null;
	}
	const inputTokens = models.reduce((sum, model) => sum + model.inputTokens, 0);
	const outputTokens = models.reduce(
		(sum, model) => sum + model.outputTokens,
		0
	);
	return (
		<section
			aria-label="OpenMeld usage"
			className="space-y-3 border-border/70 border-t py-4"
		>
			<div className="flex items-center justify-between gap-3">
				<h4 className="font-medium text-sm">OpenMeld usage</h4>
				<Select
					onValueChange={(value) => setSelectedDays(Number(value))}
					value={String(days)}
				>
					<SelectTrigger
						aria-label="Usage period"
						className="w-auto text-xs"
						displayValue={days === 1 ? "Today" : "Last 7 days"}
						variant="borderless"
					/>
					<SelectContent align="end">
						<SelectItem
							disabled={totalTokens(today.data) === 0}
							index={0}
							value="1"
						>
							Today
						</SelectItem>
						<SelectItem index={1} value="7">
							Last 7 days
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{total > 0 ? (
				<>
					<div>
						<p className="font-medium text-xl tabular-nums">
							{exactTokens.format(total)}{" "}
							<span className="font-normal text-muted-foreground text-sm">
								tokens
							</span>
						</p>
						<p className="mt-1 text-muted-foreground text-xs tabular-nums">
							{exactTokens.format(inputTokens)} input ·{" "}
							{exactTokens.format(outputTokens)} output
						</p>
					</div>
					<div className="divide-y divide-border/50">
						{models.map((model) => (
							<div
								className="flex items-center justify-between gap-4 py-2 text-xs"
								key={`${model.provider}/${model.model}`}
							>
								<span className="min-w-0 break-words">
									{model.model ?? model.provider}
								</span>
								<span className="shrink-0 text-muted-foreground tabular-nums">
									{exactTokens.format(model.totalTokens)}
								</span>
							</div>
						))}
					</div>
					<LocalAgentConsumptionTasks {...input} days={days} key={days} />
				</>
			) : null}
			<p className="text-muted-foreground text-xs leading-5">
				Usage through OpenMeld on this computer in this workspace.
			</p>
			{query.data?.coverage?.missingTokenRequests ? (
				<p className="text-muted-foreground text-xs">
					Some requests have not reported tokens yet.
				</p>
			) : null}
			{query.isError ? (
				<p className="text-muted-foreground text-xs">
					Couldn’t refresh usage. Showing the last recorded totals.
				</p>
			) : null}
		</section>
	);
}

function LocalAgentConsumptionTasks(input: Props & { days: number }) {
	const [open, setOpen] = useState(false);
	const query = useQuery({
		...consumptionQuery(input, input.days, true),
		enabled: open,
	});
	const tasks =
		query.data?.breakdown?.groups.filter((task) => task.totalTokens > 0) ?? [];
	return (
		<Accordion onValueChange={(value) => setOpen(value.length > 0)}>
			<AccordionItem value="tasks">
				<AccordionTrigger className="py-2 text-xs">Top tasks</AccordionTrigger>
				<AccordionContent>
					{tasks.map((task) => (
						<div
							className="flex items-center justify-between gap-4 py-2 text-xs"
							key={`${task.agentProfileId}/${task.spaceId}/${task.taskId}`}
						>
							<div className="min-w-0">
								<p className="font-mono">{task.taskId?.slice(0, 8)}</p>
								<p className="truncate text-muted-foreground">
									{task.models.filter(Boolean).join(", ")}
								</p>
							</div>
							<span className="shrink-0 tabular-nums">
								{exactTokens.format(task.totalTokens)} tokens
							</span>
						</div>
					))}
					{query.isPending ? (
						<p className="text-muted-foreground text-xs">Loading tasks…</p>
					) : null}
					{query.isError ? (
						<Button onClick={() => query.refetch()} size="sm" variant="ghost">
							Retry loading tasks
						</Button>
					) : null}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
