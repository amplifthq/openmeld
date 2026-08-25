import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import type * as React from "react";
import { useMemo } from "react";

type ButtonState = "idle" | "loading" | "success" | "error";

type SpinnerButtonProps = React.ComponentProps<typeof Button> & {
	buttonState?: ButtonState;
	errorElement?: React.ReactNode;
	isLoading?: boolean;
	loadingElement?: React.ReactNode;
	loadingLabel?: React.ReactNode;
	motionClassName?: string;
	successElement?: React.ReactNode;
};

export function SpinnerButton({
	buttonState,
	children,
	className,
	errorElement,
	isLoading = false,
	loadingElement,
	loadingLabel,
	motionClassName,
	successElement,
	disabled,
	...props
}: SpinnerButtonProps) {
	const currentState: ButtonState =
		buttonState ?? (isLoading ? "loading" : "idle");

	const content = useMemo(() => {
		switch (currentState) {
			case "loading":
				return (
					loadingElement ?? (
						<>
							<Bars
								aria-hidden={loadingLabel ? true : undefined}
								className="h-4 w-5"
							/>
							{loadingLabel ? <span>{loadingLabel}</span> : null}
						</>
					)
				);
			case "success":
				return successElement ?? children;
			case "error":
				return errorElement ?? children;
			default:
				return children;
		}
	}, [
		children,
		currentState,
		errorElement,
		loadingElement,
		loadingLabel,
		successElement,
	]);

	return (
		<Button
			{...props}
			aria-busy={currentState === "loading" ? true : undefined}
			aria-live={currentState === "loading" ? "polite" : undefined}
			className={cn(
				"relative select-none overflow-hidden",
				currentState === "loading" ? "cursor-wait" : "",
				className
			)}
			disabled={disabled || currentState === "loading"}
		>
			<span
				className={cn(
					"flex w-full items-center justify-center gap-2 text-nowrap",
					motionClassName
				)}
			>
				{content}
			</span>
		</Button>
	);
}
