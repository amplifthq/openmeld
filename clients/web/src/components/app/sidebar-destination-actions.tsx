import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import { createPortal } from "react-dom";

type Destination = "people" | "agents" | "spaces";
const ActionSlots = createContext<{
	slots: Record<Destination, HTMLDivElement | null>;
	setPeople: (node: HTMLDivElement | null) => void;
	setAgents: (node: HTMLDivElement | null) => void;
	setSpaces: (node: HTMLDivElement | null) => void;
} | null>(null);

export function SidebarDestinationActionsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [people, setPeople] = useState<HTMLDivElement | null>(null);
	const [agents, setAgents] = useState<HTMLDivElement | null>(null);
	const [spaces, setSpaces] = useState<HTMLDivElement | null>(null);
	const value = useMemo(
		() => ({
			slots: { people, agents, spaces },
			setPeople,
			setAgents,
			setSpaces,
		}),
		[people, agents, spaces]
	);
	return <ActionSlots.Provider value={value}>{children}</ActionSlots.Provider>;
}

export function SidebarDestinationActionSlot({
	destination,
}: {
	destination: Destination;
}) {
	const context = useContext(ActionSlots);
	const setters = {
		people: context?.setPeople,
		agents: context?.setAgents,
		spaces: context?.setSpaces,
	};
	return (
		<div
			className="pointer-events-none absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0 group-focus-within/destination:pointer-events-auto group-focus-within/destination:opacity-100 group-hover/destination:pointer-events-auto group-hover/destination:opacity-100 [&:has([aria-expanded=true])]:pointer-events-auto [&:has([aria-expanded=true])]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
			data-slot="sidebar-destination-actions"
			ref={setters[destination]}
		/>
	);
}

export function useSidebarDestinationActionSlot(destination?: Destination) {
	const context = useContext(ActionSlots);
	return destination ? context?.slots[destination] : undefined;
}

export function SidebarDestinationAction({
	destination,
	children,
}: {
	destination: Destination;
	children: ReactNode;
}) {
	const slot = useSidebarDestinationActionSlot(destination);
	if (slot === undefined) {
		return children;
	}
	return slot ? createPortal(children, slot) : null;
}
