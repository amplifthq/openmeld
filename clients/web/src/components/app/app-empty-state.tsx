import type { ReactNode } from "react";

export function AppEmptyState(input: {
	icon: ReactNode;
	title: string;
	description: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<section className="flex min-h-64 flex-col items-center justify-center rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-10 text-center">
			<span className="grid size-10 place-items-center rounded-md border border-border/70 bg-background/45 text-muted-foreground">
				{input.icon}
			</span>
			<h2 className="mt-4 font-medium text-foreground text-lg">
				{input.title}
			</h2>
			<p className="mt-2 max-w-md text-muted-foreground text-sm leading-6">
				{input.description}
			</p>
			{input.actions ? (
				<div className="mt-5 flex flex-wrap justify-center gap-2">
					{input.actions}
				</div>
			) : null}
		</section>
	);
}
