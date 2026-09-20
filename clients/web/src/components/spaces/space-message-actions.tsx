import { Button } from "@openmeld/ui/components/button";
import {
	createTooltipHandle,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
	createContext,
	type ReactElement,
	type ReactNode,
	useContext,
	useId,
	useMemo,
	useState,
} from "react";

const MessageActionTooltipContext = createContext<{
	handle: ReturnType<typeof createTooltipHandle<string>>;
	id: string;
} | null>(null);

export function MessageActionTooltipProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [handle] = useState(() => createTooltipHandle<string>());
	const id = useId();
	const value = useMemo(() => ({ handle, id }), [handle, id]);
	return (
		<MessageActionTooltipContext value={value}>
			{children}
			<Tooltip handle={handle}>
				{({ payload }) => <TooltipContent id={id}>{payload}</TooltipContent>}
			</Tooltip>
		</MessageActionTooltipContext>
	);
}

export function MessageActionTooltip(input: {
	children: ReactElement;
	label: string;
}) {
	const shared = useContext(MessageActionTooltipContext);
	if (shared) {
		return (
			<TooltipTrigger
				aria-describedby={shared.id}
				delay={500}
				handle={shared.handle}
				payload={input.label}
				render={input.children}
			/>
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger render={input.children} />
			<TooltipContent>{input.label}</TooltipContent>
		</Tooltip>
	);
}

export function MessageDetailsActionButton(input: {
	buttonClassName?: string;
	hasWakeProblem: boolean;
	label?: string;
	onClick: () => void;
}) {
	const label = input.label ?? "Message details";
	return (
		<MessageActionTooltip label={label}>
			<Button
				aria-label={label}
				className={cn(
					"size-7 p-1.5 shadow-none max-lg:min-h-7 max-lg:min-w-7",
					input.buttonClassName,
					resolveMessageDetailsButtonClassName({
						hasWakeProblem: input.hasWakeProblem,
					})
				)}
				onClick={input.onClick}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				{input.hasWakeProblem ? (
					<WarningCircleIcon aria-hidden="true" />
				) : (
					<InfoIcon aria-hidden="true" />
				)}
			</Button>
		</MessageActionTooltip>
	);
}

function resolveMessageDetailsButtonClassName(input: {
	hasWakeProblem: boolean;
}): string {
	if (input.hasWakeProblem) {
		return "bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive dark:bg-transparent dark:hover:bg-destructive/15";
	}

	return "bg-transparent shadow-none hover:bg-muted dark:bg-transparent";
}
