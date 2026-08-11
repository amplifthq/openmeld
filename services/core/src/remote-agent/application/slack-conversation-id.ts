export function buildRemoteAgentSlackConversationId(input: {
  channelId: string;
  teamId: string;
  threadTs: string;
}): string {
  return `slack:${input.teamId}:${input.channelId}:${input.threadTs}`;
}
