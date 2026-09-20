import { useState } from "react";

/** A drag moves the node; a click enters editing after React Flow's drag threshold. */
export function DeskEditableLabel(input: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
}) {
	const [editing, setEditing] = useState(false);
	if (!editing) {
		return (
			<button
				aria-label={input.label}
				className="desk-title min-w-0 cursor-grab whitespace-pre-wrap break-words rounded px-2 py-1 text-left active:cursor-grabbing"
				onClick={() => setEditing(true)}
				type="button"
			>
				{input.value || "Write a label…"}
			</button>
		);
	}
	if (input.multiline) {
		return (
			<div className="grid min-w-[120px] max-w-[520px]">
				<span
					aria-hidden
					className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words px-2 py-1"
				>
					{input.value || "Write a label…"}
					{"\n"}
				</span>
				<textarea
					aria-label={input.label}
					autoFocus
					className="nodrag nopan nowheel col-start-1 row-start-1 size-full resize-none rounded bg-muted/40 px-2 py-1 outline-none"
					onBlur={() => setEditing(false)}
					onChange={(e) => input.onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setEditing(false);
						}
					}}
					value={input.value}
				/>
			</div>
		);
	}
	return (
		<input
			aria-label={input.label}
			autoFocus
			className="nodrag nopan min-w-0 flex-1 rounded bg-muted px-2 py-1 outline-none"
			onBlur={() => setEditing(false)}
			onChange={(e) => input.onChange(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === "Escape") {
					setEditing(false);
				}
			}}
			value={input.value}
		/>
	);
}
