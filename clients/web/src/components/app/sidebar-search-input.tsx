import { Input } from "@openmeld/ui/components/input";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

export function SidebarSearchInput(input: {
	label: string;
	value: string;
	onValueChange: (value: string) => void;
}) {
	return (
		<div className="relative min-w-0 flex-1">
			<MagnifyingGlassIcon
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				aria-label={input.label}
				autoComplete="off"
				className="pl-7"
				onChange={(event) => input.onValueChange(event.target.value)}
				placeholder={input.label}
				spellCheck={false}
				type="search"
				value={input.value}
			/>
		</div>
	);
}
