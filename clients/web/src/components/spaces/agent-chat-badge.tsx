import { CloudIcon, DesktopTowerIcon } from "@phosphor-icons/react";

export function AgentChatBadge({ kind }: { kind: "center" | "local" }) {
	const Icon = kind === "center" ? CloudIcon : DesktopTowerIcon;
	return (
		<span className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-normal text-[10px] text-muted-foreground leading-none">
			<Icon aria-hidden="true" className="size-3" />
			{kind === "center" ? "Center Agent" : "Local Agent"}
		</span>
	);
}
