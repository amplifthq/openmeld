import { AI_CREDITS_PER_USD } from "@openmeld/schemas";
import type {
	AiUsageQueryResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import {
	type BrandChartColors,
	modelBrandChartColors,
} from "@openmeld/ui/lib/brand-chart-colors";
import { modelBrandName } from "#/components/models/model-brand";

export const usageNumber = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
});
export type UsageUnit = "usd" | "credits";
const credits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function usageValue(nanoUsd: number, unit: UsageUnit) {
	const usd = nanoUsd / 1_000_000_000;
	if (unit === "credits") {
		const amount = usd * AI_CREDITS_PER_USD;
		return amount > 0 && amount < 0.01 ? "<0.01" : credits.format(amount);
	}
	return usd > 0 && usd < 0.0001 ? "<$0.0001" : money.format(usd);
}
export function usageModel(model: string | null, catalog?: ModelCatalog) {
	const name =
		Object.values(catalog?.agentControllers ?? {})
			.flatMap((controller) => controller.models)
			.find((item) => item.id === model)?.displayName ??
		model ??
		"Unattributed";
	return { name, brand: modelBrandName(model, name) };
}
export type UsageModelSeries = {
	key: string;
	provider: string;
	model: string | null;
	name: string;
	brand: string | null;
	colors: BrandChartColors;
};

const LIGHTER_MODEL_VARIANT = /\b(pro|astra|thinking|reasoner)\b/i;
const DARKER_MODEL_VARIANT = /\b(luna|mini|nano|haiku|sonnet|flash|terra)\b/i;

function modelVariant(model: string | null) {
	// Identity, never array position, cost ranking, or the selected time window.
	if (LIGHTER_MODEL_VARIANT.test(model ?? "")) {
		return "lighter";
	}
	if (DARKER_MODEL_VARIANT.test(model ?? "")) {
		return "darker";
	}
	return "base";
}
export function usageModelSeries(
	models: AiUsageQueryResponse["models"],
	catalog?: ModelCatalog
): UsageModelSeries[] {
	return models.map((model, index) => {
		const presentation = usageModel(model.model, catalog);
		return {
			key: `model_${index}`,
			provider: model.provider,
			model: model.model,
			...presentation,
			colors: modelBrandChartColors(
				presentation.brand,
				modelVariant(model.model)
			),
		};
	});
}
