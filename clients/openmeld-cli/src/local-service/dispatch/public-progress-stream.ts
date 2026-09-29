const PUBLIC_PROGRESS_SNAPSHOT_MAX_CHARS = 8 * 1024;

export function createDispatchPublicProgressReporter(input: {
  publish: (progressSnapshot: string) => boolean;
}): (update: string) => {
  status: "accepted" | "duplicate" | "unavailable";
} {
  const acceptedUpdates: string[] = [];
  const acceptedUpdateSet = new Set<string>();

  return (update) => {
    const normalized = update.trim();
    if (acceptedUpdateSet.has(normalized)) {
      return { status: "duplicate" };
    }
    const progressSnapshot = [...acceptedUpdates, normalized]
      .join("\n\n")
      .slice(-PUBLIC_PROGRESS_SNAPSHOT_MAX_CHARS);
    if (!input.publish(progressSnapshot)) {
      return { status: "unavailable" };
    }
    acceptedUpdateSet.add(normalized);
    acceptedUpdates.push(normalized);
    return { status: "accepted" };
  };
}
