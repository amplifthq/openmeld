import {
	FluidAvatar,
	type FluidAvatarProps,
} from "@openmeld/ui/components/fluid-avatar";
import { RobotIcon } from "@phosphor-icons/react";

export function RemoteAgentAvatar({
	profileName,
	working = false,
	animated = working,
	shape = "rounded-square",
	animateOnHover = true,
	...props
}: Omit<FluidAvatarProps, "seed" | "fallback"> & {
	profileName: string;
	working?: boolean;
}) {
	return (
		<FluidAvatar
			{...props}
			animated={animated}
			animateOnHover={animateOnHover}
			aria-hidden="true"
			fallback={<RobotIcon className="h-1/2 w-1/2 text-white/80" />}
			seed={profileName}
			shape={shape}
		/>
	);
}
