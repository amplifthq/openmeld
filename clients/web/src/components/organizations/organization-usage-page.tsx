import type {
	AiUsageQueryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { BrandChartDot } from "@openmeld/ui/components/brand-chart-dot";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
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
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { TabItem, TabPanel, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { ArrowClockwiseIcon, CalendarBlankIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { lazy, Suspense, useMemo, useState } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { LocalAgentTokenUsageCard } from "#/components/computers/computer-token-usage";
import { ModelBrandIcon } from "#/components/models/model-brand-icon";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { usageScopeParser } from "#/lib/page-tab-search";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import {
	organizationAiBillingQueryOptions,
	organizationUsageCalendarPeriod,
} from "#/query/organizations/organization-usage";
import { OrganizationUsageStatus } from "./organization-usage-status";
import {
	type UsageModelSeries,
	type UsageUnit,
	usageModelSeries,
	usageNumber,
	usageValue,
} from "./usage-models";
import { useAgentUsage } from "./use-agent-usage";

const CostChart = lazy(() => import("./usage-cost-chart"));
const EMPTY_MODELS: AiUsageQueryResponse["models"] = [];
const unitPresentation = {
	usd: {
		label: "USD",
		suffix: "",
		history:
			"Amounts show recorded model costs, not your OpenRouter account balance.",
	},
	credits: {
		label: "Credits",
		suffix: " credits",
		history:
			"BYOK usage is shown as equivalent credits and does not reduce your included balance.",
	},
};

export function OrganizationUsagePage() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	return (
		<UsagePage
			key={`${currentOrganization.id}/${currentUserId}`}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
			userId={currentUserId}
		/>
	);
}
function UsagePage(input: {
	organizationId: string;
	organizationName: string;
	userId: string;
}) {
	const [view, setView] = useQueryState("usageScope", usageScopeParser);
	return (
		<section className="space-y-5">
			<AppPageHeader description={input.organizationName} title="AI usage" />
			<Tabs
				className="space-y-5"
				onValueChange={(value) =>
					setView(value === "my" ? "my" : "organization")
				}
				value={view}
			>
				<TabsList aria-label="Usage scope" className="w-fit">
					<TabItem label="Organization usage" value="organization" />
					<TabItem label="My agents" value="my" />
				</TabsList>
				{/* Scope changes update the mounted charts instead of disposing and
				    rebuilding their SVG renderers on every tab switch. */}
				<TabPanel className="space-y-5" value={view}>
					{view === "organization" ? (
						<OrganizationUsageStatus organizationId={input.organizationId} />
					) : null}
					<RemoteUsageCard {...input} personal={view === "my"} />
					<LocalAgentTokenUsageCard
						organizationId={input.organizationId}
						userId={view === "my" ? input.userId : undefined}
					/>
				</TabPanel>
			</Tabs>
		</section>
	);
}

export function RemoteUsageCard(input: {
	organizationId: string;
	userId: string;
	personal: boolean;
	showRefresh?: boolean;
}) {
	const [days, setDays] = useState(7);
	const billing = useQuery(organizationAiBillingQueryOptions(input));
	const unit: UsageUnit = billing.data?.source === "byok" ? "usd" : "credits";
	const presentation = unitPresentation[unit];
	const {
		owned,
		catalog,
		query,
		pending: usagePending,
		failed: usageFailed,
		refreshing,
		refresh: refreshUsage,
	} = useRemoteUsage(input, days);
	const pending = usagePending || billing.isPending;
	const failed = usageFailed || billing.isError;
	const refresh = async () => {
		await Promise.all([refreshUsage(), billing.refetch()]);
	};
	const models = query.data?.models ?? EMPTY_MODELS;
	const series = useMemo(
		() => usageModelSeries(models, catalog.data),
		[models, catalog.data]
	);
	const total = models.reduce(
		(sum, model) => sum + model.reportedCostNanoUsd,
		0
	);
	const estimated = models.reduce(
		(sum, model) => sum + model.estimatedCostNanoUsd,
		0
	);
	const missing = models.reduce(
		(sum, model) => sum + model.missingCostRequests,
		0
	);
	const requests = models.reduce((sum, model) => sum + model.requests, 0);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{input.personal ? "Remote Agent usage" : "AI usage"}
				</CardTitle>
				<CardDescription>
					Last {days} days · {presentation.label}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<UsageTotal
					failed={failed}
					missing={missing}
					pending={pending}
					requests={requests}
					total={total}
					unit={unit}
				/>
				{failed ? (
					<p
						className="py-8 text-center text-muted-foreground text-xs"
						role="alert"
					>
						Couldn’t load usage. Try refreshing in Details.
					</p>
				) : (
					<div
						aria-label={`Daily usage in ${presentation.label}. Model totals are in Details.`}
						role="img"
					>
						<Suspense fallback={<Skeleton className="h-44 w-full" />}>
							<CostChart
								buckets={query.data?.timeSeries}
								loading={pending}
								series={series}
								unit={unit}
							/>
						</Suspense>
					</div>
				)}
				{series.length > 0 ? (
					<ul
						aria-label="Models"
						className="flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground text-xs"
					>
						{series.map((model) => (
							<li className="inline-flex items-center gap-2" key={model.key}>
								<BrandChartDot colors={model.colors} />
								<ModelBrandIcon brand={model.brand} />
								{model.name}
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
											aria-label="Usage period"
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
											disabled={refreshing}
											onClick={() => {
												refresh().catch(console.error);
											}}
											variant="outline"
										>
											<ArrowClockwiseIcon
												aria-hidden="true"
												className={
													refreshing ? "motion-safe:animate-spin" : undefined
												}
											/>
											Refresh
										</Button>
									)}
								</div>
								<p className="text-muted-foreground text-xs">
									{input.personal
										? "Included in organization usage."
										: "Shared by Center Agent and Remote Agents."}{" "}
									Dates use your local time.
								</p>
								<p className="text-muted-foreground text-xs">
									All recorded usage, including previous funding sources.{" "}
									{presentation.history}
								</p>
								{missing > 0 ? (
									<p className="text-muted-foreground text-xs">
										Some usage amounts are not yet available.
									</p>
								) : null}
								{estimated > 0 ? (
									<p className="text-muted-foreground text-xs">
										{usageValue(estimated, unit)}
										{presentation.suffix} in estimated usage is excluded from
										the total.
									</p>
								) : null}
								{models.length > 0 ? (
									<UsageModelTable
										models={models}
										series={series}
										unit={unit}
									/>
								) : null}
								{input.personal && query.data?.breakdown?.groups.length ? (
									<UsageAgentTable
										breakdown={query.data.breakdown}
										owned={owned ?? []}
										unit={unit}
									/>
								) : null}
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</CardContent>
		</Card>
	);
}

function UsageTotal(input: {
	pending: boolean;
	failed: boolean;
	requests: number;
	missing: number;
	total: number;
	unit: UsageUnit;
}) {
	if (input.pending && !input.failed) {
		return <Skeleton className="h-8 w-24" />;
	}
	const unavailable =
		input.failed || (input.requests > 0 && input.missing === input.requests);
	return (
		<p className="font-medium text-2xl tabular-nums">
			{unavailable
				? "—"
				: `${usageValue(input.total, input.unit)}${unitPresentation[input.unit].suffix}`}
		</p>
	);
}

function UsageModelTable({
	models,
	series,
	unit,
}: {
	models: AiUsageQueryResponse["models"];
	series: UsageModelSeries[];
	unit: UsageUnit;
}) {
	return (
		<ScrollArea
			className="max-h-56"
			contentClassName="pr-3"
			viewportProps={{
				"aria-label": "Usage by model",
				role: "region",
			}}
		>
			<table className="w-full text-xs tabular-nums">
				<thead className="text-muted-foreground">
					<tr>
						<th className="py-2 text-left font-normal">Model</th>
						<th className="text-right font-normal">Tokens</th>
						<th className="text-right font-normal">
							{unit === "usd" ? "Cost (USD)" : "Credits"}
						</th>
					</tr>
				</thead>
				<tbody>
					{models.map((model, index) => (
						<tr
							className="border-border/50 border-t"
							key={`${model.provider}/${model.model}`}
						>
							<th className="py-2 text-left font-normal">
								<span className="inline-flex items-center gap-2">
									<ModelBrandIcon brand={series[index]?.brand ?? null} />
									{series[index]?.name}
								</span>
							</th>
							<td className="text-right">
								{model.requests === model.missingTokenRequests
									? "—"
									: usageNumber.format(model.totalTokens)}
							</td>
							<td className="text-right">
								{model.requests === model.missingCostRequests
									? "—"
									: usageValue(model.reportedCostNanoUsd, unit)}
								{model.estimatedCostNanoUsd > 0 ? (
									<span className="block text-muted-foreground">
										{usageValue(model.estimatedCostNanoUsd, unit)} estimated
									</span>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</ScrollArea>
	);
}

function UsageAgentTable({
	breakdown,
	owned,
	unit,
}: {
	breakdown: NonNullable<AiUsageQueryResponse["breakdown"]>;
	owned: OrganizationProfileDirectoryResponse["agentProfiles"];
	unit: UsageUnit;
}) {
	return (
		<ScrollArea
			className="max-h-56"
			contentClassName="pr-3"
			viewportProps={{
				"aria-label": "Usage by Agent",
				role: "region",
			}}
		>
			<table className="w-full text-xs tabular-nums">
				<thead className="text-muted-foreground">
					<tr>
						<th className="py-2 text-left font-normal">Agent</th>
						<th className="text-right font-normal">Tokens</th>
						<th className="text-right font-normal">
							{unit === "usd" ? "Cost (USD)" : "Credits"}
						</th>
					</tr>
				</thead>
				<tbody>
					{breakdown.groups.map((agent) => (
						<tr
							className="border-border/50 border-t"
							key={agent.agentProfileId}
						>
							<th className="py-2 text-left font-normal">
								{owned?.find(
									(profile) => profile.profileId === agent.agentProfileId
								)?.profileName ?? "Unavailable Agent"}
							</th>
							<td className="text-right">
								{agent.requests === agent.missingTokenRequests
									? "—"
									: usageNumber.format(agent.totalTokens)}
							</td>
							<td className="text-right">
								{agent.requests === agent.missingCostRequests
									? "—"
									: usageValue(agent.reportedCostNanoUsd, unit)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{breakdown.hasMore ? (
				<p className="text-muted-foreground text-xs">
					Showing the 50 Agents with the highest recorded usage.
				</p>
			) : null}
		</ScrollArea>
	);
}

function useRemoteUsage(
	input: { organizationId: string; userId: string; personal: boolean },
	days: number
) {
	const catalog = useQuery(modelCatalogQueryOptions());
	const usage = useAgentUsage({
		organizationId: input.organizationId,
		userId: input.personal ? input.userId : undefined,
		query: {
			...organizationUsageCalendarPeriod(days),
			runtime: "remote",
			groupTimeSeriesBy: "model",
			...(input.personal
				? {
						groupBy: "agent",
						limit: 50,
					}
				: {}),
		},
	});
	return { ...usage, catalog };
}
