import { Button } from "@openmeld/ui/components/button";
import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";

export function ProjectCheckAgainButton(input: {
	className?: string;
	initialChecking: boolean;
	isRefreshing: boolean;
	onCheck: () => void;
	size?: "default" | "sm";
}) {
	const checking = input.initialChecking || input.isRefreshing;
	let label = "Check again";
	if (input.isRefreshing) {
		label = "Checking again";
	} else if (input.initialChecking) {
		label = "Checking";
	}
	return (
		<Button
			className={input.className}
			disabled={checking}
			onClick={input.onCheck}
			size={input.size}
			variant="outline"
		>
			<ArrowClockwiseIcon
				aria-hidden="true"
				className={cn(checking && "animate-spin")}
			/>{" "}
			{label}
		</Button>
	);
}

export function ProjectRefreshStatus(input: { message: string | null }) {
	if (!input.message) {
		return null;
	}
	return (
		<output
			aria-live="polite"
			className={resolveStatusToneStrongTextClassName("warning")}
		>
			{input.message}
		</output>
	);
}
