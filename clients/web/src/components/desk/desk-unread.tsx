import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidDropdownMenuContent } from "@openmeld/ui/fluid/dropdown-menu";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel, useNodes, useReactFlow, useViewport } from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useSpaceInboxUnreadById } from "#/components/spaces/use-account-space-indicators";
import { spaceInboxUnreadTargetsQueryOptions } from "#/query/organizations/inbox";

type UnreadTarget = {
	spaceId: string;
	signalId?: string;
	threadRootSignalId?: string;
};
const DeskReadingContext = createContext<{
	active: UnreadTarget | null;
	activate: (target: UnreadTarget) => void;
	organizationId: string;
	unread: ReturnType<typeof useSpaceInboxUnreadById>;
} | null>(null);

export function DeskReadingProvider({
	organizationId,
	children,
}: {
	organizationId: string;
	children: ReactNode;
}) {
	const [active, activate] = useState<UnreadTarget | null>(null);
	const unread = useSpaceInboxUnreadById({ enabled: true, organizationId });
	useEffect(() => {
		const stopReadingOutsideSpace = (event: Event) => {
			if (
				event.target instanceof Element &&
				!event.target.closest("[data-desk-space-window]")
			) {
				activate(null);
			}
		};
		document.addEventListener("pointerdown", stopReadingOutsideSpace, true);
		document.addEventListener("focusin", stopReadingOutsideSpace, true);
		return () => {
			document.removeEventListener(
				"pointerdown",
				stopReadingOutsideSpace,
				true
			);
			document.removeEventListener("focusin", stopReadingOutsideSpace, true);
		};
	}, []);
	return (
		<DeskReadingContext value={{ active, activate, organizationId, unread }}>
			{children}
		</DeskReadingContext>
	);
}

export function useDeskReading(spaceId = "") {
	const context = useContext(DeskReadingContext);
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const { zoom } = useViewport();
	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry) {
					return;
				}
				setVisible(
					entry.intersectionRect.width >=
						Math.min(300, entry.boundingClientRect.width) &&
						entry.intersectionRect.height >=
							Math.min(240, entry.boundingClientRect.height)
				);
			},
			{
				root: element.closest("[data-desk-canvas]"),
				threshold: [0, 0.25, 0.5, 0.75, 1],
			}
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return {
		ref,
		borderStyle:
			(context?.unread.get(spaceId)?.unreadCount ?? 0) > 0
				? { borderColor: "var(--unread)" }
				: undefined,
		focusSignalId:
			context?.active?.spaceId === spaceId
				? context.active.signalId
				: undefined,
		focusThreadRootSignalId:
			context?.active?.spaceId === spaceId
				? context.active.threadRootSignalId
				: undefined,
		unreadCount: context?.unread.get(spaceId)?.unreadCount ?? 0,
		readable: visible && zoom >= 0.6 && context?.active?.spaceId === spaceId,
		activate: () => {
			if (context?.active?.spaceId !== spaceId) {
				context?.activate({ spaceId });
			}
		},
	};
}

export function DeskUnreadNavigation() {
	const context = useContext(DeskReadingContext);
	const flow = useReactFlow();
	const client = useQueryClient();
	const reduceMotion = useReducedMotion();
	const [last, setLast] = useState<string | null>(null);
	const [error, setError] = useState(false);
	const [pending, setPending] = useState(false);
	const arrivalOrder = useRef<string[]>([]);
	const nodes = useNodes().filter(
		(node) =>
			node.data.kind === "space" &&
			(context?.unread.get(String(node.data.spaceId))?.unreadCount ?? 0) > 0
	);
	const ids = nodes.map((node) => String(node.data.spaceId));
	// Preserve the traversal order when another message arrives in the same Space.
	arrivalOrder.current = [
		...arrivalOrder.current.filter((id) => ids.includes(id)),
		...ids.filter((id) => !arrivalOrder.current.includes(id)),
	];
	const ordered = arrivalOrder.current.flatMap((id) =>
		nodes.filter((node) => node.data.spaceId === id)
	);
	if (!(context && ordered.length)) {
		return null;
	}
	const jump = async (spaceId: string) => {
		const node = ordered.find((entry) => entry.data.spaceId === spaceId);
		if (!node || pending) {
			return;
		}
		setPending(true);
		setError(false);
		try {
			const data = await client.fetchQuery(
				spaceInboxUnreadTargetsQueryOptions({
					enabled: true,
					organizationId: context.organizationId,
					spaceId,
				})
			);
			const target = data.targets[0];
			await flow.fitView({
				nodes: [node],
				padding: 0.12,
				minZoom: 0.6,
				maxZoom: Math.max(0.6, flow.getZoom()),
				duration: reduceMotion ? 0 : 280,
			});
			context.activate({
				spaceId,
				signalId: target?.signalId,
				threadRootSignalId: target?.threadRootSignalId ?? undefined,
			});
			setLast(spaceId);
		} catch (error) {
			console.error("Could not navigate to unread Desk Space", error);
			setError(true);
		} finally {
			setPending(false);
		}
	};
	const next =
		ordered[
			(ordered.findIndex((node) => node.data.spaceId === last) + 1) %
				ordered.length
		];
	return (
		<Panel position="top-center">
			<div className="flex overflow-hidden rounded-full border border-blue-200 bg-blue-50 text-blue-700 shadow-sm dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
				<Button
					className="rounded-none text-inherit"
					disabled={pending}
					onClick={() => next && jump(String(next.data.spaceId))}
					size="sm"
					variant="ghost"
				>
					{error
						? "Try again"
						: `${ordered.length} ${ordered.length === 1 ? "Space" : "Spaces"} with new messages`}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label="Choose a Space with new messages"
								className="rounded-none text-inherit"
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<CaretDownIcon />
					</DropdownMenuTrigger>
					<FluidDropdownMenuContent align="center">
						{ordered.map((node) => (
							<DropdownMenuItem
								key={node.id}
								onClick={() => jump(String(node.data.spaceId))}
							>
								{String(node.data.title ?? "Space")}{" "}
								<span className="ml-auto text-muted-foreground">
									{context.unread.get(String(node.data.spaceId))?.unreadCount}
								</span>
							</DropdownMenuItem>
						))}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			</div>
		</Panel>
	);
}
