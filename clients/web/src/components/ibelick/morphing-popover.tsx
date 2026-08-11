"use client";

import { cn } from "@openmeld/ui/lib/utils";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	type Transition,
	type Variants,
} from "motion/react";
import {
	type ComponentProps,
	createContext,
	type ElementType,
	isValidElement,
	type ReactNode,
	use,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useClickOutside } from "#/hooks/use-click-outside";

const TRANSITION = {
	type: "spring",
	bounce: 0.1,
	duration: 0.4,
} satisfies Transition;

type MorphingPopoverContextValue = {
	close: () => void;
	isOpen: boolean;
	open: () => void;
	uniqueId: string;
	variants?: Variants;
};

const MorphingPopoverContext =
	createContext<MorphingPopoverContextValue | null>(null);

function usePopoverLogic({
	defaultOpen = false,
	open: controlledOpen,
	onOpenChange,
}: {
	defaultOpen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
} = {}) {
	const uniqueId = useId();
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const isOpen = controlledOpen ?? uncontrolledOpen;

	const open = () => {
		if (controlledOpen === undefined) {
			setUncontrolledOpen(true);
		}
		onOpenChange?.(true);
	};

	const close = () => {
		if (controlledOpen === undefined) {
			setUncontrolledOpen(false);
		}
		onOpenChange?.(false);
	};

	return { isOpen, open, close, uniqueId };
}

export type MorphingPopoverProps = {
	children: ReactNode;
	className?: string;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	transition?: Transition;
	variants?: Variants;
} & ComponentProps<"div">;

function MorphingPopover({
	children,
	transition = TRANSITION,
	defaultOpen,
	open,
	onOpenChange,
	variants,
	className,
	...props
}: MorphingPopoverProps) {
	const popoverLogic = usePopoverLogic({ defaultOpen, open, onOpenChange });

	return (
		<MorphingPopoverContext.Provider value={{ ...popoverLogic, variants }}>
			<MotionConfig transition={transition}>
				<div
					className={cn("relative flex items-center justify-center", className)}
					key={popoverLogic.uniqueId}
					{...props}
				>
					{children}
				</div>
			</MotionConfig>
		</MorphingPopoverContext.Provider>
	);
}

export type MorphingPopoverTriggerProps = {
	asChild?: boolean;
	children: ReactNode;
	className?: string;
} & ComponentProps<typeof motion.button>;

function MorphingPopoverTrigger({
	children,
	className,
	asChild = false,
	...props
}: MorphingPopoverTriggerProps) {
	const context = use(MorphingPopoverContext);
	if (!context) {
		throw new Error(
			"MorphingPopoverTrigger must be used within MorphingPopover"
		);
	}

	const childType =
		asChild && isValidElement(children) ? (children.type as ElementType) : null;
	const motionChildComponent = useMemo(() => {
		if (!childType) {
			return null;
		}

		return motion.create(childType);
	}, [childType]);

	if (asChild && isValidElement(children) && motionChildComponent) {
		const MotionChildComponent = motionChildComponent;
		const childProps = children.props as Record<string, unknown>;
		const childClassName =
			typeof childProps.className === "string"
				? childProps.className
				: undefined;
		const childOnClick =
			typeof childProps.onClick === "function" ? childProps.onClick : undefined;
		const handleClick: NonNullable<
			ComponentProps<typeof motion.button>["onClick"]
		> = (event) => {
			childOnClick?.(event);
			props.onClick?.(event);
			if (!event.defaultPrevented) {
				context.open();
			}
		};

		return (
			<MotionChildComponent
				{...childProps}
				{...props}
				aria-controls={`popover-content-${context.uniqueId}`}
				aria-expanded={context.isOpen}
				className={cn(childClassName, className)}
				key={context.uniqueId}
				layoutId={`popover-trigger-${context.uniqueId}`}
				onClick={handleClick}
			/>
		);
	}

	return (
		<motion.div
			key={context.uniqueId}
			layoutId={`popover-trigger-${context.uniqueId}`}
			onClick={context.open}
		>
			<motion.button
				{...props}
				aria-controls={`popover-content-${context.uniqueId}`}
				aria-expanded={context.isOpen}
				className={className}
				key={context.uniqueId}
				layoutId={`popover-label-${context.uniqueId}`}
				type={props.type ?? "button"}
			>
				{children}
			</motion.button>
		</motion.div>
	);
}

export type MorphingPopoverContentProps = {
	children: ReactNode;
	className?: string;
} & ComponentProps<typeof motion.div>;

function MorphingPopoverContent({
	children,
	className,
	...props
}: MorphingPopoverContentProps) {
	const context = use(MorphingPopoverContext);
	if (!context) {
		throw new Error(
			"MorphingPopoverContent must be used within MorphingPopover"
		);
	}

	const ref = useRef<HTMLDivElement>(null);
	useClickOutside(ref, context.close);

	useEffect(() => {
		if (!context.isOpen) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				context.close();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [context.close, context.isOpen]);

	return (
		<AnimatePresence>
			{context.isOpen ? (
				<motion.div
					{...props}
					animate="animate"
					className={cn(
						"absolute overflow-hidden rounded-md border border-zinc-950/10 bg-white p-2 text-zinc-950 shadow-md dark:border-zinc-50/10 dark:bg-zinc-700 dark:text-zinc-50",
						className
					)}
					exit="exit"
					id={`popover-content-${context.uniqueId}`}
					initial="initial"
					key={context.uniqueId}
					layoutId={`popover-trigger-${context.uniqueId}`}
					ref={ref}
					role="dialog"
					variants={context.variants}
				>
					{children}
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

export { MorphingPopover, MorphingPopoverContent, MorphingPopoverTrigger };
