import {
	HUMAN_PRESENCE_HEARTBEAT_MS,
	HUMAN_PRESENCE_LEASE_MS,
} from "@openmeld/schemas";
import { cn } from "@openmeld/ui/lib/utils";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useOrganizationMemberPresence } from "#/lib/organizations/organization-member-presence";

export type HumanPresenceStatus = "online" | "offline" | "unknown";
const HumanPresenceContext = createContext<
	ReadonlyMap<string, HumanPresenceStatus>
>(new Map());

export function HumanPresenceProvider({ children }: { children: ReactNode }) {
	const { currentOrganization } = useAppOrganization();
	const query = useOrganizationMemberPresence(currentOrganization.id);
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(
			() => setNow(Date.now()),
			HUMAN_PRESENCE_HEARTBEAT_MS
		);
		return () => window.clearInterval(timer);
	}, []);
	const presence = useMemo(() => {
		if (query.isError || now - query.dataUpdatedAt >= HUMAN_PRESENCE_LEASE_MS) {
			return new Map<string, HumanPresenceStatus>();
		}
		return new Map(
			(query.data?.members ?? []).flatMap((member) =>
				member.profileId ? [[member.profileId, member.status] as const] : []
			)
		);
	}, [query.data, query.dataUpdatedAt, query.isError, now]);
	return (
		<HumanPresenceContext.Provider value={presence}>
			{children}
		</HumanPresenceContext.Provider>
	);
}

export function useHumanPresence() {
	return useContext(HumanPresenceContext);
}

export function HumanPresenceIndicator({
	status = "unknown",
	large = false,
}: {
	status?: HumanPresenceStatus;
	large?: boolean;
}) {
	const label = {
		online: "Online",
		offline: "Offline",
		unknown: "Online status unavailable",
	}[status];
	if (status !== "online") {
		return <span className="sr-only">{label}</span>;
	}
	return (
		<span
			aria-label={label}
			className={cn(
				"absolute right-0 bottom-0 size-1.5 rounded-full bg-emerald-500 ring-1 ring-background",
				large && "right-1 bottom-1 size-2"
			)}
			role="img"
			title={label}
		/>
	);
}
