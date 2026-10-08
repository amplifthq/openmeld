import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { localAgentTokenSeries } from "../computers/local-agent-token-series";
import { usageModelSeries } from "./usage-models";

function modelRow(
	model: string | null
): AiUsageQueryResponse["models"][number] {
	return {
		model,
		provider: "openrouter",
		runtime: "remote",
		requests: 1,
		inputTokens: 100,
		outputTokens: 20,
		totalTokens: 120,
		reportedCostNanoUsd: 1000,
		estimatedCostNanoUsd: 0,
		missingTokenRequests: 0,
		missingCostRequests: 0,
	};
}

describe("Usage brand colors", () => {
	it("keeps Claude orange and GPT blue-purple in both model and controller views", () => {
		const models = usageModelSeries([
			modelRow("anthropic/claude-opus-5.5"),
			modelRow("openai/gpt-6.1-sol"),
		]);
		const agents = localAgentTokenSeries([
			{
				fromMs: 0,
				toMs: 1,
				requests: 2,
				inputTokens: 200,
				outputTokens: 40,
				totalTokens: 240,
				missingTokenRequests: 0,
				controllers: ["builtin:claude-code", "builtin:codex"].map(
					(controller) => ({
						controller,
						requests: 1,
						inputTokens: 100,
						outputTokens: 20,
						totalTokens: 120,
						missingTokenRequests: 0,
					})
				),
			},
		]);
		for (const [index, controller, color] of [
			[0, "builtin:claude-code", "#d97757"],
			[1, "builtin:codex", "#869fff"],
		] as const) {
			expect(models[index]?.colors.dark).toEqual([color]);
			expect(models[index]?.colors).toEqual(
				agents.find((agent) => agent.controller === controller)?.colors
			);
			expect(models[index]?.colors.light).not.toEqual(
				models[index]?.colors.dark
			);
		}
	});

	it("keeps model shades stable across providers, subsets and ordering without colliding in the reported chart", () => {
		const ids = [
			"anthropic/claude-opus-5.5",
			"openai/gpt-6.1-sol",
			"openai/gpt-6.1-sol-pro",
			"openai/gpt-6-luna",
			"z-ai/glm-5.3-flash",
		];
		const series = usageModelSeries(ids.map(modelRow));
		for (const theme of ["light", "dark"] as const) {
			expect(new Set(series.map((item) => item.colors[theme][0])).size).toBe(
				ids.length
			);
		}
		for (const item of series) {
			expect(usageModelSeries([modelRow(item.model)])[0]?.colors).toEqual(
				item.colors
			);
			expect(
				usageModelSeries(ids.toReversed().map(modelRow)).find(
					(entry) => entry.model === item.model
				)?.colors
			).toEqual(item.colors);
			expect(
				usageModelSeries([
					{
						...modelRow(item.model?.split("/").at(-1) ?? null),
						provider: "direct",
					},
				])[0]?.colors
			).toEqual(item.colors);
		}
		for (const item of series.filter((entry) => entry.brand === "OpenAI")) {
			for (const color of [...item.colors.light, ...item.colors.dark]) {
				const r = Number.parseInt(color.slice(1, 3), 16);
				const g = Number.parseInt(color.slice(3, 5), 16);
				const b = Number.parseInt(color.slice(5, 7), 16);
				expect(b).toBeGreaterThan(g);
				expect(g).toBeGreaterThan(r);
			}
		}
	});

	it("does not assign an unknown model another brand's color", () => {
		const series = usageModelSeries([
			modelRow(null),
			modelRow("unknown-model"),
		]);
		expect(series[0]?.colors).toEqual(series[1]?.colors);
		expect(series[0]?.colors.dark).toEqual(["#929aa8"]);
	});
});
