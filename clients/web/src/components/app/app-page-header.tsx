import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

type AppPageHeaderProps = {
	action?: ReactNode;
	description: ReactNode;
	descriptionWidth?: "constrained" | "full";
	eyebrow: ReactNode;
	id?: string;
	title: string;
};

export function AppPageHeader(input: AppPageHeaderProps) {
	return (
		<header
			className="flex flex-wrap items-start justify-between gap-4"
			data-slot="app-page-header"
		>
			<div className="flex min-w-0 flex-col gap-1">
				<p className="font-medium text-muted-foreground text-xs">
					{input.eyebrow}
				</p>
				<h1 className="font-medium text-2xl text-foreground" id={input.id}>
					{input.title}
				</h1>
				<p
					className={cn(
						"text-muted-foreground text-sm leading-6",
						input.descriptionWidth === "full" ? "max-w-none" : "max-w-2xl"
					)}
					data-slot="app-page-header-description"
				>
					{input.description}
				</p>
			</div>
			{input.action ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2 pt-5">
					{input.action}
				</div>
			) : null}
		</header>
	);
}
