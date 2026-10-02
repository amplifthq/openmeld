import Anthropic from "@lobehub/icons/es/Anthropic/components/Mono.js";
import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Color.js";
import Google from "@lobehub/icons/es/Google/components/Color.js";
import Meta from "@lobehub/icons/es/Meta/components/Color.js";
import MiniMax from "@lobehub/icons/es/Minimax/components/Color.js";
import Mistral from "@lobehub/icons/es/Mistral/components/Color.js";
import Moonshot from "@lobehub/icons/es/Moonshot/components/Mono.js";
import OpenAI from "@lobehub/icons/es/OpenAI/components/Mono.js";
import Qwen from "@lobehub/icons/es/Qwen/components/Color.js";
import XAI from "@lobehub/icons/es/XAI/components/Mono.js";
import Xiaomi from "@lobehub/icons/es/XiaomiMiMo/components/Mono.js";
import Zhipu from "@lobehub/icons/es/Zhipu/components/Color.js";
import { cn } from "@openmeld/ui/lib/utils";
import { CpuIcon } from "@phosphor-icons/react";

const ICONS = {
	OpenAI,
	Anthropic,
	Google,
	DeepSeek,
	"Z.ai": Zhipu,
	"Moonshot AI": Moonshot,
	MiniMax,
	Alibaba: Qwen,
	xAI: XAI,
	Xiaomi,
	Meta,
	Mistral,
};

export function hasModelBrandIcon(brand: string | null): boolean {
	return brand !== null && Object.hasOwn(ICONS, brand);
}

export function ModelBrandIcon({
	brand,
	className,
}: {
	brand: string | null;
	className?: string;
}) {
	const recognized = hasModelBrandIcon(brand);
	const Icon = recognized ? ICONS[brand as keyof typeof ICONS] : CpuIcon;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-4 shrink-0 items-center justify-center",
				className
			)}
			data-model-brand={recognized ? brand : undefined}
		>
			<Icon className="size-full" />
		</span>
	);
}
