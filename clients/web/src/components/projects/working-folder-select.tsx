"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";

export function WorkingFolderSelect(input: {
	id: string;
	disabled: boolean;
	value: string;
	placeholder?: string;
	items: readonly { label: string; value: string }[];
	onChange: (value: string) => void;
}) {
	return (
		<Select
			disabled={input.disabled}
			onValueChange={input.onChange}
			value={input.value}
		>
			<SelectTrigger
				className="h-10 w-full px-3 text-sm"
				displayValue={
					input.items.find((item) => item.value === input.value)?.label
				}
				id={input.id}
				placeholder={input.placeholder}
			/>
			<SelectContent>
				{input.items.map((item, index) => (
					<SelectItem index={index} key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
