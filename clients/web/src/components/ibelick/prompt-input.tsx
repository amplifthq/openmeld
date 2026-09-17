"use client";

import { Textarea } from "@openmeld/ui/components/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { SurfaceProvider } from "@openmeld/ui/lib/surface-context";
import { cn } from "@openmeld/ui/lib/utils";
import type React from "react";
import { createContext, use, useEffect, useRef, useState } from "react";

type PromptInputContextType = {
	value: string;
	setValue: (value: string) => void;
	maxHeight: number | string;
	onSubmit?: () => void;
	disabled?: boolean;
};

const PromptInputContext = createContext<PromptInputContextType | null>(null);

function usePromptInput() {
	const context = use(PromptInputContext);
	if (!context) {
		throw new Error("usePromptInput must be used within a PromptInput");
	}
	return context;
}

type PromptInputProps = {
	disabled?: boolean;
	value?: string;
	onValueChange?: (value: string) => void;
	maxHeight?: number | string;
	onSubmit?: () => void;
	children: React.ReactNode;
	className?: string;
};

const PROMPT_EDITOR_SELECTOR =
	'textarea:not(:disabled), [contenteditable="true"]:not([aria-disabled="true"])';
const PROMPT_INTERACTIVE_SELECTOR =
	'a, button, input, select, textarea, [contenteditable], [role="button"], [role="link"], [role="menuitem"], [role="option"]';

function PromptInput({
	className,
	disabled = false,
	maxHeight = 240,
	value,
	onValueChange,
	onSubmit,
	children,
}: PromptInputProps) {
	const [internalValue, setInternalValue] = useState(value || "");

	const handleChange = (newValue: string) => {
		setInternalValue(newValue);
		onValueChange?.(newValue);
	};
	const handleSurfacePointerDown = (
		event: React.PointerEvent<HTMLDivElement>
	) => {
		if (disabled || event.button !== 0) {
			return;
		}

		const target = event.target;
		// Portaled previews bubble through React but are not part of this surface.
		if (!(target instanceof Node && event.currentTarget.contains(target))) {
			return;
		}
		if (
			target instanceof Element &&
			target.closest(PROMPT_INTERACTIVE_SELECTOR)
		) {
			return;
		}

		const editor = event.currentTarget.querySelector<HTMLElement>(
			PROMPT_EDITOR_SELECTOR
		);
		if (!editor) {
			return;
		}

		event.preventDefault();
		editor.focus();
	};

	return (
		<TooltipProvider>
			<PromptInputContext.Provider
				value={{
					value: value ?? internalValue,
					setValue: onValueChange ?? handleChange,
					maxHeight,
					onSubmit,
					disabled,
				}}
			>
				<SurfaceProvider value={2}>
					<div
						className={cn(
							"composer-surface rounded-2xl border border-transparent p-2",
							className
						)}
						data-slot="prompt-input"
						onPointerDown={handleSurfacePointerDown}
					>
						{children}
					</div>
				</SurfaceProvider>
			</PromptInputContext.Provider>
		</TooltipProvider>
	);
}

export type PromptInputTextareaProps = {
	disableAutosize?: boolean;
} & React.ComponentProps<typeof Textarea>;

function PromptInputTextarea({
	className,
	disabled: disabledProp,
	onChange,
	onKeyDown,
	ref: forwardedRef,
	disableAutosize = false,
	...props
}: PromptInputTextareaProps) {
	const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
	const isDisabled = Boolean(disabled || disabledProp);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (disableAutosize) {
			return;
		}

		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		textarea.style.cssText = `${textarea.style.cssText}; height: auto; overflow-y: hidden`;
		const scrollHeight = textarea.scrollHeight;
		const nextHeight =
			typeof maxHeight === "number"
				? `${Math.min(scrollHeight, maxHeight)}px`
				: `min(${scrollHeight}px, ${maxHeight})`;
		const nextOverflowY =
			typeof maxHeight === "number" && scrollHeight > maxHeight
				? "auto"
				: "hidden";
		textarea.style.cssText = `${textarea.style.cssText}; height: ${nextHeight}; overflow-y: ${nextOverflowY}`;
	});

	const handleTextareaRef = (element: HTMLTextAreaElement | null) => {
		textareaRef.current = element;
		assignTextareaRef(forwardedRef, element);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		onKeyDown?.(e);
		if (e.defaultPrevented) {
			return;
		}

		if (e.nativeEvent.isComposing) {
			return;
		}

		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			onSubmit?.();
		}
	};

	const updatePromptValue = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setValue(e.target.value);
		onChange?.(e);
	};

	return (
		<Textarea
			className={cn(
				"min-h-11 w-full resize-none rounded-md border-none bg-transparent text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
				className
			)}
			disabled={isDisabled}
			onChange={updatePromptValue}
			onKeyDown={handleKeyDown}
			ref={handleTextareaRef}
			rows={1}
			value={value}
			{...props}
		/>
	);
}

function assignTextareaRef(
	ref: React.ComponentProps<typeof Textarea>["ref"] | undefined,
	element: HTMLTextAreaElement | null
) {
	if (!ref) {
		return;
	}

	if (typeof ref === "function") {
		ref(element);
		return;
	}

	ref.current = element;
}

type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>;

function PromptInputActions({
	children,
	className,
	...props
}: PromptInputActionsProps) {
	return (
		<div className={cn("flex items-center gap-2", className)} {...props}>
			{children}
		</div>
	);
}

type PromptInputActionProps = {
	className?: string;
	tooltip: React.ReactNode;
	children: React.ReactElement;
	side?: "top" | "bottom" | "left" | "right";
} & React.ComponentProps<typeof Tooltip>;

function PromptInputAction({
	tooltip,
	children,
	className,
	side = "top",
	...props
}: PromptInputActionProps) {
	const { disabled } = usePromptInput();

	return (
		<Tooltip {...props}>
			<TooltipTrigger disabled={disabled} render={children} />
			<TooltipContent className={className} side={side}>
				{tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

export {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
};
