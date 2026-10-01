import {
	type ChartConfig,
	EChartsAreaChart,
} from "@openmeld/ui/components/evilcharts/charts/echarts-area-chart";

// Audience Growth block composition, adapted to recorded daily token consumption.
// Keep the baseline at zero and use linear segments: these are daily totals, not a forecast.
const config = {
	tokens: {
		label: "Tokens",
		colors: { light: ["#059669"], dark: ["#34d399"] },
	},
} satisfies ChartConfig;
const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const options = {
	grid: { left: 44, right: 16, top: 12, bottom: 28 },
};

export default function ComputerTokenAreaChart(input: {
	data: { date: string; tokens: number | null }[];
	loading: boolean;
}) {
	return (
		<EChartsAreaChart
			animation={false}
			chartOptions={options}
			className="h-44 w-full"
			config={config}
			curveType="linear"
			data={input.data}
			isLoading={input.loading}
			loadingPoints={7}
			renderer="svg"
		>
			<EChartsAreaChart.Grid />
			<EChartsAreaChart.XAxis dataKey="date" hideDots />
			<EChartsAreaChart.YAxis
				hideDots
				tickFormatter={(value) => compact.format(Number(value))}
			/>
			<EChartsAreaChart.Tooltip roundness="md" variant="default" />
			<EChartsAreaChart.Area
				dataKey="tokens"
				strokeVariant="solid"
				strokeWidth={1.5}
				variant="gradient"
			>
				<EChartsAreaChart.ActiveDot variant="colored-border" />
			</EChartsAreaChart.Area>
		</EChartsAreaChart>
	);
}
