// Presentation only: recognize model families, never infer execution routing.
const MODEL_PROVIDER_BRANDS: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	google: "Google",
	deepseek: "DeepSeek",
	"z-ai": "Z.ai",
	moonshotai: "Moonshot AI",
	minimax: "MiniMax",
	qwen: "Alibaba",
	"x-ai": "xAI",
	xiaomi: "Xiaomi",
	"meta-llama": "Meta",
	meta: "Meta",
	mistralai: "Mistral",
};

// OpenRouter model IDs carry the model author's exact namespace. Display names
// and routing-provider labels are not an authority for default avatar branding.
export function modelProviderBrandName(modelId: string | null): string | null {
	const [providerId, modelSlug] = modelId?.split("/") ?? [];
	return providerId &&
		modelSlug &&
		Object.hasOwn(MODEL_PROVIDER_BRANDS, providerId)
		? MODEL_PROVIDER_BRANDS[providerId]
		: null;
}

const MODEL_BRANDS = [
	{ pattern: /\b(gpt|openai|o[134])\b/i, name: "OpenAI" },
	{ pattern: /\b(claude|anthropic)\b/i, name: "Anthropic" },
	{ pattern: /\b(gemini|google)\b/i, name: "Google" },
	{ pattern: /\b(deepseek)\b/i, name: "DeepSeek" },
	{ pattern: /\b(glm|zhipu|z-ai)\b/i, name: "Z.ai" },
	{ pattern: /\b(kimi|moonshot)\b/i, name: "Moonshot AI" },
	{ pattern: /\b(minimax)\b/i, name: "MiniMax" },
	{ pattern: /\b(qwen|alibaba)\b/i, name: "Alibaba" },
	{ pattern: /\b(grok|xai|x-ai)\b/i, name: "xAI" },
	{ pattern: /\b(mimo|xiaomi)\b/i, name: "Xiaomi" },
	{ pattern: /\b(llama|meta)\b/i, name: "Meta" },
	{ pattern: /\b(mistral|devstral|codestral)\b/i, name: "Mistral" },
] as const;

export function modelBrandName(
	modelId: string | null,
	displayName = ""
): string | null {
	return (
		MODEL_BRANDS.find(({ pattern }) =>
			pattern.test(`${modelId ?? ""} ${displayName}`)
		)?.name ?? null
	);
}
