import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Skeleton } from "@openmeld/ui/components/skeleton";
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
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
	organizationAiUsageQueryOptions,
	organizationUsageCalendarPeriod,
} from "#/query/organizations/organization-usage";

const AreaChart = lazy(() => import("./computer-token-area-chart"));
const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});
type Series = NonNullable<AiUsageQueryResponse["timeSeries"]>;

export function ComputerTokenUsage(input: {
	organizationId?: string;
	computerId?: string;
}) {
	if (!(input.organizationId && input.computerId)) {
		return null;
	}
	return (
		<ComputerTokenUsageCard
			computerId={input.computerId}
			key={`${input.organizationId}/${input.computerId}`}
			organizationId={input.organizationId}
		/>
	);
}

function ComputerTokenUsageCard(input: {
	organizationId: string;
	computerId: string;
}) {
	const [days, setDays] = useState(7);
	const period = organizationUsageCalendarPeriod(days);
	const query = useQuery(
		organizationAiUsageQueryOptions({
			organizationId: input.organizationId,
			query: {
				...period,
				computerId: input.computerId,
				runtime: "local",
			},
		})
	);
	const total =
		query.data?.models.reduce((sum, model) => sum + model.totalTokens, 0) ?? 0;
	const series = query.data?.timeSeries;
	if (!(query.isPending || query.isError) && total === 0) {
		return null;
	}
	const data =
		series?.map((bucket) => ({
			date: date.format(bucket.fromMs),
			tokens:
				bucket.requests > 0 && bucket.missingTokenRequests === bucket.requests
					? null
					: bucket.totalTokens,
		})) ?? [];
	const unavailable = query.isError || (query.isSuccess && !series);
	return (
		<Card aria-label="Computer token usage">
			<CardHeader>
				<CardTitle>Token usage</CardTitle>
				<CardDescription>Last {days} days</CardDescription>
				<CardAction>
					{query.isPending ? (
						<Skeleton className="h-6 w-20" />
					) : (
						<p className="text-right font-medium text-xl tabular-nums">
							{unavailable && !query.data ? "—" : number.format(total)}{" "}
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
							<AreaChart data={data} loading={query.isPending} />
						</Suspense>
					</div>
				)}
				<Accordion>
					<AccordionItem value="details">
						<AccordionTrigger className="py-2 text-muted-foreground text-xs">
							Details
						</AccordionTrigger>
						<AccordionContent>
							<div className="space-y-3 pt-2">
								<div className="flex items-center justify-between gap-3">
									<Select
										onValueChange={(value) => setDays(Number(value))}
										value={String(days)}
									>
										<SelectTrigger
											aria-label="Token usage period"
											className="w-auto text-xs"
											displayValue={`Last ${days} days`}
											variant="borderless"
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
									<Button
										disabled={query.isFetching}
										onClick={() => query.refetch()}
										size="sm"
										variant="ghost"
									>
										<ArrowClockwiseIcon aria-hidden="true" />
										Refresh
									</Button>
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
								{series ? <DailyTokenTable series={series} /> : null}
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</CardContent>
		</Card>
	);
}

function DailyTokenTable({ series }: { series: Series }) {
	return (
		<div className="max-h-56 overflow-auto">
			<table className="w-full text-xs tabular-nums">
				<caption className="sr-only">Daily recorded token usage</caption>
				<thead className="text-muted-foreground">
					<tr>
						<th className="py-2 text-left font-normal" scope="col">
							Date
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
					{series.toReversed().map((bucket) => {
						const unknown =
							bucket.requests > 0 &&
							bucket.missingTokenRequests === bucket.requests;
						return (
							<tr className="border-border/50 border-t" key={bucket.fromMs}>
								<th className="py-2 text-left font-normal" scope="row">
									{date.format(bucket.fromMs)}
								</th>
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
					})}
				</tbody>
			</table>
		</div>
	);
}
