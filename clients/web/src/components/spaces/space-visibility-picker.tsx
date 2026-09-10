import type { SpaceOrganizationVisibility } from "@openmeld/schemas/types";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { LockKeyIcon, UsersIcon } from "@phosphor-icons/react";
import { useId } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

export function SpaceVisibilityPicker(input: {
	value?: SpaceOrganizationVisibility;
	disabled: boolean;
	onChange: (value: SpaceOrganizationVisibility) => void;
	id?: string;
}) {
	const fallbackId = useId();
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const everyone = organization
		? `Everyone at ${organization.name}`
		: "Everyone in the organization";
	const label = input.value === "private" ? "Only invited people" : everyone;
	return (
		<Select
			disabled={input.disabled}
			onValueChange={(value) => {
				if (value === "private" || value === "public") {
					input.onChange(value);
				}
			}}
			value={input.value ?? ""}
		>
			<SelectTrigger
				aria-label={input.id ? undefined : "Who can join this Space"}
				className="w-full"
				displayValue={input.value ? label : "Access unavailable"}
				icon={input.value === "public" ? UsersIcon : LockKeyIcon}
				id={input.id ?? fallbackId}
			/>
			<SelectContent matchTriggerWidth>
				<SelectItem icon={LockKeyIcon} index={0} value="private">
					Only invited people
				</SelectItem>
				{organization?.isPersonal ? null : (
					<SelectItem icon={UsersIcon} index={1} value="public">
						{everyone}
					</SelectItem>
				)}
			</SelectContent>
		</Select>
	);
}
