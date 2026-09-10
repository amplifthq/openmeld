import type { SpaceOrganizationVisibility } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

export function SpaceVisibilityPicker(input: {
	value: SpaceOrganizationVisibility;
	disabled: boolean;
	onChange: (value: SpaceOrganizationVisibility) => void;
}) {
	return (
		<RadioGroup
			aria-disabled={input.disabled || undefined}
			aria-label="Organization directory listing"
			className={cn(
				"w-full gap-1",
				input.disabled && "pointer-events-none opacity-70"
			)}
			selectedIndex={input.value === "private" ? 0 : 1}
		>
			<RadioItem
				className="py-2.5"
				description="Hidden from the organization directory. Invite people to add them."
				index={0}
				label="Private"
				onSelect={() => {
					if (!input.disabled) {
						input.onChange("private");
					}
				}}
				selected={input.value === "private"}
			/>
			<RadioItem
				className="py-2.5"
				description="Everyone in your organization can find and join this Space."
				index={1}
				label="Public in organization"
				onSelect={() => {
					if (!input.disabled) {
						input.onChange("public");
					}
				}}
				selected={input.value === "public"}
			/>
		</RadioGroup>
	);
}

export function SpaceVisibilityEditor(input: {
	value?: SpaceOrganizationVisibility;
	canManage: boolean;
	onSave?: (value: SpaceOrganizationVisibility) => Promise<void>;
}) {
	const [draft, setDraft] = useState<SpaceOrganizationVisibility | null>(null);
	const save = useMutation({
		mutationFn: async (value: SpaceOrganizationVisibility) => {
			if (!input.onSave) {
				throw new Error("This setting is unavailable.");
			}
			await input.onSave(value);
		},
		onSuccess: () => setDraft(null),
	});
	return (
		<section className="space-y-3">
			<div className="space-y-1">
				<h3 className="font-medium text-sm">Organization directory listing</h3>
				<p className="text-muted-foreground text-xs">
					Choose who can discover this Space in your organization. Link access
					is managed separately below.
				</p>
			</div>
			{input.value && input.canManage && input.onSave ? (
				<>
					<SpaceVisibilityPicker
						disabled={save.isPending}
						onChange={setDraft}
						value={draft ?? input.value}
					/>
					<div className="flex justify-end">
						<Button
							disabled={save.isPending || !draft || draft === input.value}
							onClick={() => {
								if (draft) {
									save.mutate(draft);
								}
							}}
							size="sm"
						>
							{save.isPending ? "Saving…" : "Save visibility"}
						</Button>
					</div>
				</>
			) : (
				<p className="text-muted-foreground text-xs">
					{input.value
						? `${input.value === "private" ? "Private" : "Public in organization"}. Only the Space owner can change this.`
						: "Visibility is unavailable. Close settings and try again."}
				</p>
			)}
			{save.error && (
				<p className="text-destructive text-xs" role="alert">
					{save.error.message}
				</p>
			)}
		</section>
	);
}
