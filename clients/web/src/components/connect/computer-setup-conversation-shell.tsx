import type { ReactNode } from "react";

export function ComputerSetupConversationShell(input: {
	children: ReactNode;
	description: string;
	title: string;
}) {
	return (
		<section
			aria-label="Computer setup"
			className="my-2 flex w-full max-w-2xl flex-col gap-5 border border-border bg-background p-4 text-left shadow-sm"
			data-slot="computer-setup-flow"
		>
			<header className="flex min-w-0 flex-col gap-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Computer setup
					</span>
					<span aria-hidden="true" className="text-muted-foreground text-xs">
						·
					</span>
					<span className="min-w-0 truncate text-muted-foreground text-xs">
						Center Agent
					</span>
				</div>
				<h3 className="font-semibold text-base text-foreground leading-6">
					{input.title}
				</h3>
				<p className="text-muted-foreground text-sm leading-6">
					{input.description}
				</p>
			</header>
			{input.children}
		</section>
	);
}
