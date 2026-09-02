"use client";

import { SettingsAddComputerCardContent } from "@openmeld/ui/components/settings-computers";
import { ADD_CARD_PICKER_CLASS_NAME } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";

export function ComputerSetupChoiceCard(input: {
	actionHref?: string;
	actionLabel: string;
	centerAgentHref?: string | null;
	className?: string;
	descriptionLead?: string;
	iconContainerClassName?: string;
	onAction?: () => void;
	titleClassName?: string;
}) {
	const actionClassName =
		"absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

	return (
		<div
			className={cn(ADD_CARD_PICKER_CLASS_NAME, "relative", input.className)}
		>
			<ComputerSetupPrimaryAction
				actionHref={input.actionHref}
				actionLabel={input.actionLabel}
				className={actionClassName}
				onAction={input.onAction}
			/>
			<div className="pointer-events-none relative z-[1] flex flex-col items-center justify-center gap-3">
				<SettingsAddComputerCardContent
					description={
						<>
							{input.descriptionLead ? `${input.descriptionLead} ` : null}
							{input.centerAgentHref ? (
								<>
									Or ask a{" "}
									<a
										className="pointer-events-auto underline decoration-muted-foreground/70 underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										href={input.centerAgentHref}
									>
										Center Agent
									</a>{" "}
									to walk you through.
								</>
							) : null}
						</>
					}
					descriptionClassName="max-w-sm"
					iconContainerClassName={input.iconContainerClassName}
					title={input.actionLabel}
					titleAriaHidden
					titleClassName={input.titleClassName}
				/>
			</div>
		</div>
	);
}

function ComputerSetupPrimaryAction(input: {
	actionHref?: string;
	actionLabel: string;
	className: string;
	onAction?: () => void;
}) {
	if (input.actionHref) {
		return (
			<a className={input.className} href={input.actionHref}>
				<span className="sr-only">{input.actionLabel}</span>
			</a>
		);
	}
	if (input.onAction) {
		return (
			<button
				className={input.className}
				onClick={input.onAction}
				type="button"
			>
				<span className="sr-only">{input.actionLabel}</span>
			</button>
		);
	}
	return null;
}
