import {
	type ChartConfig,
	EChartsAreaChart,
} from "@openmeld/ui/components/evilcharts/charts/echarts-area-chart";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { RobotIcon } from "@phosphor-icons/react";
import { memo, useMemo } from "react";
import type { LocalAgentTokenSeries } from "./local-agent-token-series";

// Audience Growth block composition, adapted to recorded daily token consumption.
// Keep the baseline at zero and use linear segments: these are daily totals, not a forecast.
const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const options = {
	grid: { left: 44, right: 16, top: 12, bottom: 28 },
};

function ComputerTokenAreaChart(input: {
	data: Record<string, string | number | null>[];
	agents: LocalAgentTokenSeries[];
	loading: boolean;
}) {
	const config = useMemo(
		() =>
			Object.fromEntries(
				input.agents.map((agent) => [
					agent.key,
					{
						label: agent.label,
						colors: agent.colors,
						icon: () =>
							agent.controller ? (
								<LocalAgentLogo agentId={agent.controller} />
							) : (
								<RobotIcon className="size-4" />
							),
					},
				])
			) satisfies ChartConfig,
		[input.agents]
	);
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
			{input.agents.map((agent) => (
				<EChartsAreaChart.Area
					dataKey={agent.key}
					key={agent.key}
					strokeVariant="solid"
					strokeWidth={1.5}
					variant="gradient"
				>
					<EChartsAreaChart.ActiveDot variant="colored-border" />
				</EChartsAreaChart.Area>
			))}
		</EChartsAreaChart>
	);
}

export default memo(ComputerTokenAreaChart);
