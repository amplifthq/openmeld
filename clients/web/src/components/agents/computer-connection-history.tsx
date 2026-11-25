import { createServiceConnectionEvidenceApi } from "@openmeld/api-client";
import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export function ComputerConnectionHistory(input: {
	storageScope: string;
	target:
		| CurrentLocalRuntimeReplyReadinessResponse["currentTarget"]
		| undefined;
}) {
	if (input.target?.availability !== "resolved") {
		return null;
	}
	return (
		<ResolvedComputerConnectionHistory
			storageScope={input.storageScope}
			target={{
				deviceId: input.target.deviceId,
				runtimeLane: input.target.runtimeLane,
			}}
		/>
	);
}

function ResolvedComputerConnectionHistory(input: {
	storageScope: string;
	target: PeopleComputerTarget;
}) {
	const [open, setOpen] = useState(false);
	const history = useQuery({
		queryKey: [
			"computer-connection-history",
			input.storageScope,
			input.target.deviceId,
			input.target.runtimeLane,
		],
		queryFn: () =>
			createServiceConnectionEvidenceApi(
				createUnscopedWebOpenMeldApiFoundation()
			).read(input.target),
		enabled: open,
		staleTime: 30_000,
		retry: false,
	});
	return (
		<details
			className="relative border-t pt-3 text-sm"
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="cursor-pointer pr-36 font-medium text-muted-foreground text-sm leading-8">
				Connection history
			</summary>
			{open ? (
				<div className="mt-3 space-y-3">
					<Button
						className="absolute top-3 right-0"
						disabled={history.isFetching}
						onClick={() => {
							history.refetch().catch(() => undefined);
						}}
						size="sm"
						variant="outline"
					>
						Refresh history
					</Button>
					<p className="text-muted-foreground">
						Private to your account. Connection details upload when this
						computer reconnects.
					</p>
					{history.isPending ? (
						<SkeletonRows label="Loading connection history" />
					) : null}
					{history.isError ? (
						<div className="flex items-center gap-3">
							<p role="alert">Connection history could not be loaded.</p>
							<Button
								disabled={history.isFetching}
								onClick={() => history.refetch().catch(console.error)}
								size="sm"
								variant="ghost"
							>
								Try again
							</Button>
						</div>
					) : null}
					{history.data?.incidents.length === 0 ? (
						<p className="text-muted-foreground">
							No recent connection incidents have been uploaded.
						</p>
					) : null}
					{history.data?.incidents.length ? (
						<ScrollArea
							className="max-h-70"
							contentClassName="space-y-3 pr-3"
							scrollFade
							viewportClassName="overscroll-contain"
							viewportProps={{
								"aria-label": "Connection history",
								role: "region",
							}}
						>
							{history.data.incidents.map((incident) => (
								<div
									className="space-y-1 border-t pt-3"
									key={incident.incidentId}
								>
									<p>
										{incident.outcome === "recovered"
											? "Recovered automatically"
											: "Connection interrupted"}{" "}
										·{" "}
										{Math.max(
											1,
											Math.round(
												(incident.endedAtMs - incident.startedAtMs) / 1000
											)
										)}
										s recorded
									</p>
									<p className="text-muted-foreground">
										{new Date(incident.startedAtMs).toLocaleString()} · Service{" "}
										{incident.serviceVersion}
									</p>
									<details>
										<summary className="cursor-pointer text-muted-foreground">
											Technical details
										</summary>
										<p className="my-2 break-all text-muted-foreground text-xs">
											Incident {incident.incidentId}
											{incident.evidenceTruncated
												? " · Some repeated events were omitted."
												: ""}
										</p>
										<ScrollArea
											className="max-h-64 rounded-md border"
											orientation="both"
										>
											<pre className="rounded p-3 text-xs">
												{JSON.stringify(incident, null, 2)}
											</pre>
										</ScrollArea>
									</details>
								</div>
							))}
						</ScrollArea>
					) : null}
				</div>
			) : null}
		</details>
	);
}
