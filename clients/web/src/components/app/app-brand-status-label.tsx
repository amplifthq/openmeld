export const OPENMELD_APP_STATUS_LABEL = "Experimental";

export type AppBrandStatusLabelValue = string | null;

export function AppBrandStatusLabel(input: {
	label: AppBrandStatusLabelValue;
}) {
	if (!input.label) {
		return null;
	}

	return (
		<>
			<span
				aria-hidden="true"
				className="shrink-0 font-geist-pixel-line text-muted-foreground/35 text-xs leading-none"
			>
				·
			</span>
			<span className="min-w-0 truncate font-geist-pixel-line text-muted-foreground/65 text-xs leading-none tracking-normal">
				{input.label}
			</span>
		</>
	);
}
