import { Button } from "@openmeld/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { spaceMessageDetailsQueryOptions } from "#/query/spaces/message-details";
import { delegatedWorkSummary } from "./space-message-delegations-presentation";

export function SpaceMessageDelegationSummary(input: {
	spaceId: string;
	signalId: string;
	openMeldProfileId?: string;
	onOpenDetails: () => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!root.current) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				setVisible(entries.some((entry) => entry.isIntersecting));
			},
			{ rootMargin: "100px" }
		);
		observer.observe(root.current);
		return () => observer.disconnect();
	}, []);
	const query = useQuery(
		spaceMessageDetailsQueryOptions({ ...input, enabled: visible })
	);
	const delegations = query.data?.delegations;
	if (query.isError) {
		return (
			<div ref={root}>
				<Button
					className="mt-2 h-auto whitespace-normal text-left text-muted-foreground"
					onClick={input.onOpenDetails}
					size="sm"
					variant="ghost"
				>
					Check delegated work
				</Button>
			</div>
		);
	}
	if (!delegations?.groups.length) {
		return <div ref={root} />;
	}
	return (
		<div ref={root}>
			<Button
				className="mt-2 h-auto max-w-full justify-start whitespace-normal text-left"
				onClick={input.onOpenDetails}
				size="sm"
				variant="outline"
			>
				Delegated work · {delegatedWorkSummary(delegations)}
				{delegations.nextCursor ? " · more" : ""}
			</Button>
		</div>
	);
}
