import { TextMorph } from "@openmeld/ui/components/text-morph";
import { cn } from "@openmeld/ui/lib/utils";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";

export function AgentNameEditor(input: {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	maxLength?: number;
}) {
	const hintId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [editing, setEditing] = useState(false);
	const [beforeEdit, setBeforeEdit] = useState(input.value);
	return (
		<div className="grid w-full min-w-0 max-w-xl gap-1">
			<div className="flex h-12 w-fit min-w-0 max-w-full items-center gap-2">
				<div className="relative h-full min-w-0">
					<span
						aria-hidden="true"
						className="invisible block overflow-hidden whitespace-pre pr-0.5 font-medium text-[clamp(1.5rem,2.2vw,2.25rem)] leading-12"
					>
						{input.value || "Name your Agent"}
					</span>
					<div
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute inset-0 flex items-center overflow-hidden",
							editing && "invisible"
						)}
					>
						<TextMorph
							as="span"
							className="whitespace-nowrap font-medium text-[clamp(1.5rem,2.2vw,2.25rem)] leading-12"
							transition={{ duration: 0.2, ease: "easeOut" }}
						>
							{(editing ? beforeEdit : input.value) || "Name your Agent"}
						</TextMorph>
					</div>
					<input
						aria-describedby={hintId}
						aria-label="Agent name"
						autoComplete="off"
						className={cn(
							"absolute inset-0 h-full w-full min-w-0 border-0 bg-transparent p-0 font-medium text-[clamp(1.5rem,2.2vw,2.25rem)] leading-12 outline-none placeholder:text-muted-foreground",
							!editing && "opacity-0"
						)}
						disabled={input.disabled}
						maxLength={input.maxLength}
						onBlur={() => setEditing(false)}
						onChange={(event) => input.onChange(event.target.value)}
						onFocus={() => {
							setBeforeEdit(input.value);
							setEditing(true);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) {
								event.preventDefault();
								event.currentTarget.blur();
							}
						}}
						placeholder="Name your Agent"
						ref={inputRef}
						value={input.value}
					/>
				</div>
				<button
					aria-label="Edit Agent name"
					className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:text-foreground"
					disabled={input.disabled}
					onClick={() => inputRef.current?.focus()}
					type="button"
				>
					<PencilSimpleIcon aria-hidden="true" className="size-4" />
				</button>
			</div>
			<p className="text-muted-foreground text-xs leading-5" id={hintId}>
				Click the name to edit. Press Enter when you’re done.
			</p>
		</div>
	);
}
