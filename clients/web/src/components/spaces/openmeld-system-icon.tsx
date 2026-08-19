import { cn } from "@openmeld/ui/lib/utils";

export function OpenMeldSystemIcon(input: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={cn("block size-4 shrink-0", input.className)}
			data-testid="openmeld-system-icon"
			focusable="false"
			height={16}
			viewBox="0 0 16 16"
			width={16}
		>
			<path
				clipRule="evenodd"
				d="M5 1h6v1h2v2h1v8h-1v2h-2v1H5v-1H3v-2H2V4h1V2h2V1Zm0 4v6h6V5H5Z"
				fill="currentColor"
				fillRule="evenodd"
			/>
		</svg>
	);
}
