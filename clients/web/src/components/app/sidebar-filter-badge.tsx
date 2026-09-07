import { XIcon } from "@phosphor-icons/react";

export function SidebarFilterBadge(input: {
	label: string;
	onRemove: () => void;
}) {
	return (
		<span className="inline-flex max-w-full items-center gap-1 rounded-full bg-sidebar-accent py-0.5 pr-0.5 pl-2 text-sidebar-accent-foreground text-xs">
			<span className="min-w-0 truncate">{input.label}</span>
			<button
				aria-label={`Remove ${input.label} filter`}
				className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				onClick={input.onRemove}
				type="button"
			>
				<XIcon aria-hidden="true" className="size-3" />
			</button>
		</span>
	);
}
