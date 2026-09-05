import { Badge } from "@openmeld/ui/components/badge";

export function ModelBadge({ label }: { label: string }) {
	return (
		<Badge
			className="h-4 shrink-0 px-1.5 py-0 text-[10px] leading-none"
			variant="secondary"
		>
			{label}
		</Badge>
	);
}
