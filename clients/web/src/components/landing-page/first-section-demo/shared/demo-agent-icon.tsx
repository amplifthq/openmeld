import { resolveBuiltinAgentControllerBrand } from "@openmeld/schemas";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import type { CSSProperties } from "react";

const DEMO_AGENT_CONTROLLER_REFS = {
	"your-claude-code": "builtin:claude-code",
	"your-codex": "builtin:codex",
} as const;

const ICON_SIZE_CLASS_NAMES = {
	md: "h-4 w-4",
	sm: "h-3.5 w-3.5",
} as const;

export type DemoAgentName = keyof typeof DEMO_AGENT_CONTROLLER_REFS;
export type DemoAgentLabel = DemoAgentName | "You";

export function isDemoAgentName(value: string): value is DemoAgentName {
	return value in DEMO_AGENT_CONTROLLER_REFS;
}

export function getDemoAgentAccentClassName(name: string): string {
	return name === "You"
		? cn(resolveStatusToneStrongTextClassName("ready"), "opacity-[0.92]")
		: "";
}

export function getDemoAgentAccentStyle(
	name: string
): CSSProperties | undefined {
	const agentControllerRef =
		DEMO_AGENT_CONTROLLER_REFS[name as DemoAgentName] ?? null;
	const brand = resolveBuiltinAgentControllerBrand(agentControllerRef);
	return brand ? { color: brand.accentHex } : undefined;
}

export function getDemoAgentSelectionClassName(name: string): string {
	return isDemoAgentName(name) ? "" : "terminal-demo-selection-neutral";
}

export function getDemoAgentSelectionStyle(
	name: string
): CSSProperties | undefined {
	const agentControllerRef =
		DEMO_AGENT_CONTROLLER_REFS[name as DemoAgentName] ?? null;
	const brand = resolveBuiltinAgentControllerBrand(agentControllerRef);
	return brand
		? ({
				"--terminal-demo-selection-color": `color-mix(in oklab, ${brand.accentHex} ${brand.selectionMixPercent}%, transparent)`,
			} as CSSProperties)
		: undefined;
}

export function DemoAgentMention({
	className,
	mention,
}: {
	className?: string;
	mention: string;
}) {
	const agentName = mention.startsWith("@") ? mention.slice(1) : mention;

	return (
		<span
			className={cn(
				isDemoAgentName(agentName)
					? getDemoAgentAccentClassName(agentName)
					: "text-foreground/88",
				className
			)}
			style={
				isDemoAgentName(agentName)
					? getDemoAgentAccentStyle(agentName)
					: undefined
			}
		>
			{mention}
		</span>
	);
}

type DemoAgentIconProps = {
	className?: string;
	name: DemoAgentName;
	size?: keyof typeof ICON_SIZE_CLASS_NAMES;
};

export function DemoAgentIcon({
	className,
	name,
	size = "sm",
}: DemoAgentIconProps) {
	return (
		<LocalAgentLogo
			agentId={DEMO_AGENT_CONTROLLER_REFS[name]}
			className={cn(
				"inline-flex shrink-0 items-center justify-center",
				ICON_SIZE_CLASS_NAMES[size],
				className
			)}
			variant="plain"
		/>
	);
}
