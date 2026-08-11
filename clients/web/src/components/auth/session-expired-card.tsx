import { buttonVariants } from "@openmeld/ui/components/button";
import type { SessionExpiredState } from "#/lib/session-expired";

export function SessionExpiredCard(input: {
	className?: string;
	requestId?: string | null;
	state: SessionExpiredState;
}) {
	return (
		<div
			className={[
				"grid gap-4 border border-destructive/20 bg-destructive/5 px-4 py-4",
				input.className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div className="grid gap-1">
				<p className="font-medium text-foreground text-sm">
					{input.state.message}
				</p>
				{input.requestId ? (
					<p className="text-muted-foreground text-xs">
						Request ID: {input.requestId}
					</p>
				) : null}
			</div>
			<div className="flex justify-end">
				<a
					className={buttonVariants({ size: "sm", variant: "default" })}
					href={input.state.href}
				>
					{input.state.ctaLabel}
				</a>
			</div>
		</div>
	);
}
