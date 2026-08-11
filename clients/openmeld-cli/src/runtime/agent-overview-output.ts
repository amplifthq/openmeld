export function shouldEmitAgentOverview(input: {
  argv?: readonly string[];
  handled?: boolean;
  resolvedView: "human" | "agent";
}): boolean {
  if (input.resolvedView !== "agent" || input.handled) {
    return false;
  }

  return (input.argv ?? process.argv).includes("--details");
}
