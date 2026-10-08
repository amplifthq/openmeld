import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import { SPACE_ATTACHMENT_FILE_CLASS } from "./space-attachment-strip";

/** Files and task references share one quiet, keyboard-accessible card. */
export function SpaceMessageResourceCard(input: {
	label: string;
	title?: string;
	onOpen?: () => void;
	className?: string;
	children: ReactNode;
}) {
	const className = cn(SPACE_ATTACHMENT_FILE_CLASS, input.className);
	return input.onOpen ? (
		<Button
			aria-label={input.label}
			className={cn(
				"justify-start font-normal transition-colors motion-reduce:transition-none",
				className
			)}
			onClick={input.onOpen}
			title={input.title}
			type="button"
			variant="outline"
		>
			{input.children}
		</Button>
	) : (
		<div
			aria-label={input.label}
			className={className}
			role="img"
			title={input.title}
		>
			{input.children}
		</div>
	);
}
