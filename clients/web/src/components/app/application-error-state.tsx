"use client";

import { Button } from "@openmeld/ui/components/button";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";

export function ApplicationErrorState(input: {
	actionLabel?: string;
	children?: ReactNode;
	className?: string;
	description?: string;
	message: string;
	onAction?: () => Promise<void> | void;
}) {
	return (
		<section className={cn("w-full max-w-xl space-y-4", input.className)}>
			<div className="flex flex-col items-center gap-4 text-center">
				<OpenMeldLogo colors={OPENMELD_LOGO_THEME_COLORS} scale={0.62} />
				<div className="space-y-1">
					<h1 className="font-medium text-base">Application Error</h1>
					<p className="text-muted-foreground text-xs">
						{input.description ?? "Unhandled application error."}
					</p>
				</div>
			</div>

			<pre className="overflow-x-auto rounded-md border border-border bg-card p-3 text-center text-foreground text-xs">
				{input.message}
			</pre>
			{input.onAction ? (
				<div className="flex justify-center">
					<Button
						onClick={async () => {
							await input.onAction?.();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						{input.actionLabel ?? "Refresh"}
					</Button>
				</div>
			) : null}
			{input.children}
		</section>
	);
}
