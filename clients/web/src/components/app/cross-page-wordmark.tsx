import { cn } from "@openmeld/ui/lib/utils";

type CrossPageWordmarkProps = {
	className?: string;
};

export function CrossPageWordmark({ className }: CrossPageWordmarkProps) {
	return (
		<span
			aria-label="OpenMeld"
			className={cn(
				"inline-flex items-center whitespace-nowrap font-geist-pixel-square text-foreground text-xs uppercase leading-none",
				className
			)}
			role="img"
		>
			OPENMELD
		</span>
	);
}
