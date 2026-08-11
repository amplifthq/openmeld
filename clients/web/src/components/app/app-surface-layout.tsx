import type { ReactNode } from "react";

export function AppSurfaceLayout(input: {
	ariaBusy?: boolean;
	children: ReactNode;
	frameSlotName?: string;
	globalControls: ReactNode;
	outerRail: ReactNode;
	sidebar?: ReactNode;
	testId?: string;
}) {
	return (
		<div
			aria-busy={input.ariaBusy || undefined}
			className="relative flex h-dvh w-full overflow-hidden bg-[var(--app-canvas)] text-foreground"
			data-slot={input.frameSlotName ?? "app-surface-layout"}
			data-testid={input.testId}
		>
			{input.outerRail}
			<div
				className="relative mt-2 mr-2 mb-9 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border-[0.5px] border-border bg-background"
				data-slot="app-surface"
			>
				{input.sidebar}
				{input.children}
			</div>
			{input.globalControls}
		</div>
	);
}
