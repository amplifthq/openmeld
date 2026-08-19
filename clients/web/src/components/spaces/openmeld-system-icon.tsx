import { cn } from "@openmeld/ui/lib/utils";

export function OpenMeldSystemIcon(input: { className?: string }) {
	return (
		<img
			alt=""
			aria-hidden="true"
			className={cn("block size-4 shrink-0 object-contain", input.className)}
			data-testid="openmeld-system-icon"
			draggable={false}
			height={16}
			src="/favicon-32x32.png"
			width={16}
		/>
	);
}
