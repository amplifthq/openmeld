import type {
	AiUsageQueryResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { modelBrandName } from "#/components/models/model-brand";

export const usageNumber = new Intl.NumberFormat("en-US");
export function usageMoney(nanoUsd: number) {
	const usd = nanoUsd / 1_000_000_000;
	return usd > 0 && usd < 0.0001
		? "<$0.0001"
		: new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: "USD",
				minimumFractionDigits: 2,
				maximumFractionDigits: 4,
			}).format(usd);
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
	color: string;
};
const colors = [
	"#869fff",
	"#d97757",
	"#2aafa0",
	"#c49a47",
	"#cb87d0",
	"#569ecb",
];
function modelColor(model: string | null) {
	let hash = 0;
	for (const character of model ?? "unattributed") {
		hash = (hash * 31 + character.charCodeAt(0)) % 4_294_967_296;
	}
	return colors[hash % colors.length] ?? "#869fff";
}
export function usageModelSeries(
	models: AiUsageQueryResponse["models"],
	catalog?: ModelCatalog
): UsageModelSeries[] {
	return models.map((model, index) => ({
		key: `model_${index}`,
		provider: model.provider,
		model: model.model,
		...usageModel(model.model, catalog),
		color: modelColor(model.model),
	}));
}
