export function SpaceMessageWakeReceipt(input: {
	targetLabelsByProfileId: ReadonlyMap<string, string>;
	targetProfileIds: readonly string[];
}) {
	if (input.targetProfileIds.length === 0) {
		return null;
	}

	const targetLabels = input.targetProfileIds.map(
		(profileId) =>
			input.targetLabelsByProfileId.get(profileId)?.trim() || profileId
	);

	return (
		<p
			className="max-w-full break-words text-muted-foreground text-xs leading-5 [overflow-wrap:anywhere]"
			data-testid="space-message-wake-receipt"
		>
			<span aria-hidden="true">→</span> woke {targetLabels.join(", ")}
		</p>
	);
}
