import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { ChatCircleTextIcon, StarIcon } from "@phosphor-icons/react";
import { ObjectMenuItems } from "./object-menu-items";

export function ProfileMenuItems(input: {
	href: string;
	onOpen: () => void;
	onChat?: () => void;
	onToggleStar?: () => void;
	starred?: boolean;
	disabled?: boolean;
}) {
	return (
		<>
			<ObjectMenuItems href={input.href} onOpen={input.onOpen} />
			{input.onChat && (
				<FluidDropdownMenuItem
					disabled={input.disabled}
					index={0}
					onClick={input.onChat}
				>
					<ChatCircleTextIcon aria-hidden="true" />
					Message
				</FluidDropdownMenuItem>
			)}
			{input.onToggleStar && (
				<FluidDropdownMenuItem
					disabled={input.disabled}
					index={1}
					onClick={input.onToggleStar}
				>
					<StarIcon
						aria-hidden="true"
						weight={input.starred ? "fill" : "regular"}
					/>
					{input.starred ? "Unstar" : "Star"}
				</FluidDropdownMenuItem>
			)}
		</>
	);
}
