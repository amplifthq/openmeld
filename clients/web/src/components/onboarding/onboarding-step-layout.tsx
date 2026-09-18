"use client";

import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

export function OnboardingStepLayout(input: {
	body: ReactNode;
	bodyClassName?: string;
	footer?: ReactNode;
	footerClassName?: string;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<ScrollArea
				className="min-h-0 min-w-0 flex-1"
				contentClassName={cn("min-w-0 pr-3 pb-5", input.bodyClassName)}
				data-slot="onboarding-step-scroll-area"
				orientation="vertical"
				scrollFade
			>
				{input.body}
			</ScrollArea>
			{input.footer ? (
				<footer
					className={cn(
						"shrink-0 border-border/70 border-t pt-4",
						input.footerClassName
					)}
					data-slot="onboarding-step-footer"
				>
					{input.footer}
				</footer>
			) : null}
		</div>
	);
}
