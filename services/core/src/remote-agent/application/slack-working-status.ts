import { setSlackThreadStatus } from "./slack-client";

export const REMOTE_AGENT_SLACK_WORKING_STATUS = "is working on your request…";
export const REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS = 90;

const SLACK_THREAD_STATUS_TIMEOUT_MS = 500;

export async function setRemoteAgentSlackThreadWorkingStatus(input: {
  botToken: string;
  channelId: string;
  threadTs: string;
}): Promise<void> {
  await setSlackThreadStatus({
    botToken: input.botToken,
    channelId: input.channelId,
    signal: AbortSignal.timeout(SLACK_THREAD_STATUS_TIMEOUT_MS),
    status: REMOTE_AGENT_SLACK_WORKING_STATUS,
    threadTs: input.threadTs,
  });
}
