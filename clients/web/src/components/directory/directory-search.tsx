import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";

export function DirectorySearch(input: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const focus = useCallback(
		(node: HTMLInputElement | null) => node?.focus(),
		[]
	);
	const close = () => {
		input.onChange("");
		setOpen(false);
	};
	return open ? (
		<>
			<Input
				aria-label={input.label}
				className="h-8 w-52 min-w-0 max-w-full"
				onChange={(event) => input.onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						close();
					}
				}}
				placeholder={`${input.label}…`}
				ref={focus}
				type="search"
				value={input.value}
			/>
			<Button
				aria-label="Close search"
				onClick={close}
				size="icon-sm"
				variant="ghost"
			>
				<XIcon />
			</Button>
		</>
	) : (
		<Button
			aria-label={input.label}
			onClick={() => setOpen(true)}
			size="icon-sm"
			variant="ghost"
		>
			<MagnifyingGlassIcon />
		</Button>
	);
}
