"use client";

import { Select } from "@base-ui/react/select";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";

// Use the same floating tree as the enclosing Agent configuration popover and
// dialog, so choosing an option does not dismiss the editor.
export function WorkingFolderSelect(input: {
	id: string;
	disabled: boolean;
	value: string;
	placeholder?: string;
	items: readonly { label: string; value: string }[];
	onChange: (value: string) => void;
}) {
	return (
		<Select.Root
			disabled={input.disabled}
			items={input.items}
			onValueChange={(value) => {
				if (value !== null) {
					input.onChange(value);
				}
			}}
			value={input.value || null}
		>
			<Select.Trigger
				className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
				id={input.id}
			>
				<Select.Value className="truncate" placeholder={input.placeholder}>
					{input.items.find((item) => item.value === input.value)?.label ??
						input.placeholder}
				</Select.Value>
				<Select.Icon>
					<CaretDownIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner
					alignItemWithTrigger={false}
					className="z-50"
					sideOffset={4}
				>
					<Select.Popup className="max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none">
						<Select.List>
							{input.items.map((item) => (
								<Select.Item
									className="flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
									key={item.value}
									value={item.value}
								>
									<Select.ItemText className="truncate">
										{item.label}
									</Select.ItemText>
									<Select.ItemIndicator>
										<CheckIcon aria-hidden="true" className="size-4" />
									</Select.ItemIndicator>
								</Select.Item>
							))}
						</Select.List>
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}
