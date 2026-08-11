import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { cn } from "@openmeld/ui/lib/utils";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { type ComponentProps, useState } from "react";

const PasswordInput = ({ className, ...props }: ComponentProps<"input">) => {
	const [showPassword, setShowPassword] = useState(false);
	const disabled =
		props.value === "" || props.value === undefined || props.disabled;

	return (
		<div className="relative">
			<Input
				{...props}
				className={cn("hide-password-toggle pr-10", className)}
				type={showPassword ? "text" : "password"}
			/>
			<Button
				className="absolute top-0 right-0 h-full px-3 py-2 hover:bg-transparent"
				disabled={disabled}
				onClick={() => setShowPassword((previous) => !previous)}
				size="sm"
				type="button"
				variant="ghost"
			>
				{showPassword && !disabled ? (
					<EyeIcon aria-hidden="true" className="size-4" />
				) : (
					<EyeSlashIcon aria-hidden="true" className="size-4" />
				)}
				<span className="sr-only">
					{showPassword ? "Hide password" : "Show password"}
				</span>
			</Button>
			<style>{`
				.hide-password-toggle::-ms-reveal,
				.hide-password-toggle::-ms-clear {
					visibility: hidden;
					pointer-events: none;
					display: none;
				}
			`}</style>
		</div>
	);
};

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
