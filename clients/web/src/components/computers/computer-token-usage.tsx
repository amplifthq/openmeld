import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import { BrandChartDot } from "@openmeld/ui/components/brand-chart-dot";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { ArrowClockwiseIcon, CalendarBlankIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useAgentUsage } from "#/components/organizations/use-agent-usage";
import { organizationUsageCalendarPeriod } from "#/query/organizations/organization-usage";
import {
	type LocalAgentTokenSeries,
	localAgentTokenSeries,
	recordedTokenValue,
} from "./local-agent-token-series";

const AreaChart = lazy(() => import("./computer-token-area-chart"));
const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});
type Series = NonNullable<AiUsageQueryResponse["timeSeries"]>;
const EMPTY_SERIES: Series = [];

export function ComputerTokenUsage(input: {
	organizationId?: string;
	computerId?: string;
}) {
	if (!(input.organizationId && input.computerId)) {
		return null;
	}
	return (
		<LocalAgentTokenUsageCard
			computerId={input.computerId}
			key={`${input.organizationId}/${input.computerId}`}
			organizationId={input.organizationId}
		/>
	);
}

export function LocalAgentTokenUsageCard(input: {
	organizationId: string;
	computerId?: string;
	userId?: string;
	showRefresh?: boolean;
}) {
	const [days, setDays] = useState(7);
	const period = organizationUsageCalendarPeriod(days);
	const { query, pending, failed, refreshing, refresh } = useAgentUsage({
		organizationId: input.organizationId,
		userId: input.userId,
		query: {
			...period,
			computerId: input.computerId,
			runtime: "local",
			groupTimeSeriesBy: "controller",
		},
	});
	const total =
		query.data?.models.reduce((sum, model) => sum + model.totalTokens, 0) ?? 0;
	const series = query.data?.timeSeries;
	const agents = useMemo(
		() => localAgentTokenSeries(series ?? EMPTY_SERIES),
		[series]
	);
	const data = useMemo(
		() =>
			(series ?? EMPTY_SERIES).map((bucket) => ({
				date: date.format(bucket.fromMs),
				...Object.fromEntries(
					agents.map((agent) => [
						agent.key,
						recordedTokenValue(
							bucket.controllers?.find(
								(row) => row.controller === agent.controller
							)
						),
					])
				),
			})),
		[agents, series]
	);
	if (!(pending || failed) && total === 0) {
		return null;
	}
	const unavailable =
		failed ||
		(query.isSuccess &&
			(!series || series.some((bucket) => !bucket.controllers)));
	return (
		<Card aria-label="Local Agent token usage">
			<CardHeader>
				<CardTitle>Local Agent token usage</CardTitle>
				<CardDescription>Last {days} days</CardDescription>
				<CardAction>
					{pending && !failed ? (
						<Skeleton className="h-6 w-20" />
					) : (
						<p className="text-right font-medium text-xl tabular-nums">
							{unavailable ? "—" : number.format(total)}{" "}
							<span className="font-normal text-muted-foreground text-xs">
								tokens
							</span>
						</p>
					)}
				</CardAction>
			</CardHeader>
			<CardContent className="space-y-2">
				{unavailable ? (
					<p className="py-8 text-center text-muted-foreground text-xs">
						Couldn’t load usage. Try refreshing in Details.
					</p>
				) : (
					<div
						aria-label={`Recorded tokens over the last ${days} days. Daily values are in Details.`}
						role="img"
					>
						<Suspense fallback={<Skeleton className="h-44 w-full" />}>
							<AreaChart agents={agents} data={data} loading={pending} />
						</Suspense>
					</div>
				)}
				{!unavailable && agents.length > 0 ? (
					<ul
						aria-label="Local Agents"
						className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-xs"
					>
						{agents.map((agent) => (
							<li key={agent.key}>
								<TokenAgentLabel agent={agent} />
							</li>
						))}
					</ul>
				) : null}
				<Accordion>
					<AccordionItem value="details">
						<AccordionTrigger
							chevronClassName="text-current motion-reduce:transition-none"
							className="cursor-pointer py-2 text-muted-foreground text-xs hover:text-foreground focus-visible:text-foreground motion-reduce:transition-none"
							trailing={
								<span aria-hidden="true">
									<span className="group-data-[open]/accordion-item:hidden">
										More
									</span>
									<span className="hidden group-data-[open]/accordion-item:inline">
										Less
									</span>
								</span>
							}
						>
							Details
						</AccordionTrigger>
						<AccordionContent className="motion-reduce:transition-none">
							<div className="space-y-3 pt-2">
								<div className="flex items-center justify-end gap-2">
									<Select
										onValueChange={(value) => setDays(Number(value))}
										value={String(days)}
									>
										<SelectTrigger
											aria-label="Token usage period"
											className="w-auto min-w-36 text-xs"
											displayValue={`Last ${days} days`}
											icon={CalendarBlankIcon}
											variant="bordered"
										/>
										<SelectContent>
											<SelectItem index={0} value="7">
												Last 7 days
											</SelectItem>
											<SelectItem index={1} value="30">
												Last 30 days
											</SelectItem>
										</SelectContent>
									</Select>
									{input.showRefresh !== false && (
										<Button
											aria-busy={refreshing}
											className="max-lg:h-11"
											disabled={refreshing}
											onClick={refresh}
											size="default"
											variant="outline"
										>
											<ArrowClockwiseIcon
												aria-hidden="true"
												className="data-[refreshing=true]:motion-safe:animate-spin"
												data-refreshing={refreshing}
											/>
											Refresh
										</Button>
									)}
								</div>
								<p className="text-muted-foreground text-xs">
									Recorded through OpenMeld in this workspace. Dates use your
									local time.
								</p>
								{query.data?.coverage?.missingTokenRequests ? (
									<p className="text-muted-foreground text-xs">
										Some requests have no token count. Totals include reported
										tokens only.
									</p>
								) : null}
								{series && !unavailable ? (
									<DailyTokenTable agents={agents} series={series} />
								) : null}
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</CardContent>
		</Card>
	);
}

function TokenAgentLabel({ agent }: { agent: LocalAgentTokenSeries }) {
	return (
		<span className="inline-flex items-center gap-2 whitespace-nowrap">
			<BrandChartDot colors={agent.colors} />
			{agent.controller ? (
				<LocalAgentLogo agentId={agent.controller} size="xs" />
			) : null}
			{agent.label}
		</span>
	);
}

function DailyTokenTable({
	series,
	agents,
}: {
	series: Series;
	agents: LocalAgentTokenSeries[];
}) {
	return (
		<ScrollArea
			className="max-h-56"
			contentClassName="pr-3"
			viewportClassName="overscroll-contain"
			viewportProps={{ "aria-label": "Daily token usage", role: "region" }}
		>
			<table className="w-full text-xs tabular-nums">
				<caption className="sr-only">Daily recorded token usage</caption>
				<thead className="text-muted-foreground">
					<tr>
						<th className="py-2 text-left font-normal" scope="col">
							Date
						</th>
						<th className="text-left font-normal" scope="col">
							Local Agent
						</th>
						<th className="text-right font-normal" scope="col">
							Input
						</th>
						<th className="text-right font-normal" scope="col">
							Output
						</th>
						<th className="text-right font-normal" scope="col">
							Tokens
						</th>
					</tr>
				</thead>
				<tbody>
					{series.toReversed().flatMap((day) =>
						(day.controllers?.length
							? day.controllers
							: [{ ...day, controller: null }]
						).map((bucket) => {
							const unknown =
								bucket.requests > 0 &&
								bucket.missingTokenRequests === bucket.requests;
							return (
								<tr
									className="border-border/50 border-t"
									key={`${day.fromMs}/${bucket.controller}`}
								>
									<th className="py-2 text-left font-normal" scope="row">
										{date.format(day.fromMs)}
									</th>
									<td className="text-muted-foreground">
										{bucket.requests > 0
											? agents
													.filter(
														(agent) => agent.controller === bucket.controller
													)
													.map((agent) => (
														<TokenAgentLabel agent={agent} key={agent.key} />
													))
											: "—"}
									</td>
									<td className="text-right text-muted-foreground">
										{unknown ? "—" : number.format(bucket.inputTokens)}
									</td>
									<td className="text-right text-muted-foreground">
										{unknown ? "—" : number.format(bucket.outputTokens)}
									</td>
									<td className="text-right">
										{unknown ? "—" : number.format(bucket.totalTokens)}
										{bucket.missingTokenRequests > 0 ? (
											<span className="sr-only"> (incomplete)</span>
										) : null}
									</td>
								</tr>
							);
						})
					)}
				</tbody>
			</table>
		</ScrollArea>
	);
}
