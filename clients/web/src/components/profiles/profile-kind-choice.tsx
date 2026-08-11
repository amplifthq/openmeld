"use client";

import { cn } from "@openmeld/ui/lib/utils";
import {
	ChoiceCardSurface,
	SelectedStatusChip,
	selectedChoiceSurfaceClassName,
} from "./choice-card-surface";

export function StaticChoiceCardButton(input: {
	title: string;
	description: string;
	onClick: () => void;
	isSelected: boolean;
	className?: string;
}) {
	return (
		<button
			aria-pressed={input.isSelected}
			className="w-full text-left focus-visible:ring-1 focus-visible:ring-ring/50"
			onClick={input.onClick}
			type="button"
		>
			<ChoiceCardSurface
				action={input.isSelected ? <SelectedStatusChip /> : null}
				className={cn(
					input.className,
					input.isSelected
						? `${selectedChoiceSurfaceClassName} hover:bg-muted/10`
						: undefined
				)}
				description={input.description}
				title={input.title}
			/>
		</button>
	);
}
