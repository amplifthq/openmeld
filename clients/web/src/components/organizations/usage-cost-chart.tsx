import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import {
	type ChartConfig,
	EChartsAreaChart,
} from "@openmeld/ui/components/evilcharts/charts/echarts-area-chart";
import { ModelBrandIcon } from "#/components/models/model-brand-icon";
import { type UsageModelSeries, usageMoney } from "./usage-models";

const day = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});
export default function UsageCostChart(input: {
	series: UsageModelSeries[];
	buckets: AiUsageQueryResponse["timeSeries"];
	loading: boolean;
}) {
	const config: ChartConfig = Object.fromEntries(
		input.series.map((series) => [
			series.key,
			{
				label: series.name,
				colors: series.colors,
				icon: () => <ModelBrandIcon brand={series.brand} />,
			},
		])
	);
	const data = (input.buckets ?? []).map((bucket) => ({
		date: day.format(bucket.fromMs),
		...Object.fromEntries(
			input.series.map((series) => {
				const row = bucket.models?.find(
					(model) =>
						model.provider === series.provider && model.model === series.model
				);
				return [
					series.key,
					row && row.requests === row.missingCostRequests
						? null
						: (row?.reportedCostNanoUsd ?? 0),
				];
			})
		),
	}));
	return (
		<EChartsAreaChart
			animation={false}
			chartOptions={{ grid: { left: 52, right: 16, top: 12, bottom: 28 } }}
			className="h-44 w-full"
			config={config}
			curveType="linear"
			data={data}
			isLoading={input.loading}
			loadingPoints={7}
			renderer="svg"
		>
			<EChartsAreaChart.Grid />
			<EChartsAreaChart.XAxis dataKey="date" hideDots />
			<EChartsAreaChart.YAxis
				hideDots
				tickFormatter={(value) => usageMoney(Number(value))}
			/>
			<EChartsAreaChart.Tooltip
				roundness="md"
				valueFormatter={(value) => usageMoney(Number(value))}
				variant="default"
			/>
			{input.series.map((series) => (
				<EChartsAreaChart.Area
					dataKey={series.key}
					key={series.key}
					strokeWidth={1.5}
					variant="gradient"
				>
					<EChartsAreaChart.ActiveDot variant="colored-border" />
				</EChartsAreaChart.Area>
			))}
		</EChartsAreaChart>
	);
}
