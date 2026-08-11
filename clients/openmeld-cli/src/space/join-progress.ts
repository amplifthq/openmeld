import { createDelayedSpinner } from "../ui/delayed-spinner";

export const SPACE_JOIN_LOCAL_READINESS_SPINNER_MESSAGE =
  "Checking local agent readiness before joining...";
export const SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE =
  "Checking space readiness before joining...";

export function shouldShowSpaceJoinProgress(input: {
  resolvedView: "human" | "agent";
  interactive: boolean;
  output?: string;
  rawStream?: boolean;
}): boolean {
  return (
    input.resolvedView === "human" &&
    input.interactive &&
    input.rawStream !== true &&
    input.output !== "ndjson"
  );
}

export async function withSpaceJoinProgress<T>(input: {
  enabled: boolean;
  message: string;
  run: () => Promise<T>;
}): Promise<T> {
  const spinner = createDelayedSpinner({
    enabled: input.enabled,
    message: input.message,
  });
  spinner.start();

  try {
    const result = await input.run();
    spinner.complete();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}
