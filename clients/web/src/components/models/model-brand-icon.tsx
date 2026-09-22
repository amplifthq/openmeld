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

export function ModelBrandIcon({ brand }: { brand: string | null }) {
	const Icon =
		brand && brand in ICONS ? ICONS[brand as keyof typeof ICONS] : CpuIcon;
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 items-center justify-center"
		>
			<Icon className="size-4" />
		</span>
	);
}
