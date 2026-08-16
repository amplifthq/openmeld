export const SLACK_CHANNEL_INTRODUCTION_ACKNOWLEDGEMENT_METADATA = {
  eventPayloadKey: "interaction_id",
  eventType: "openmeld_channel_intro_acknowledged",
} as const;

export const SLACK_CHANNEL_INTRODUCTION_RECOVERY_NOTICE_METADATA = {
  eventPayloadKey: "interaction_id",
  eventType: "openmeld_channel_intro_recovery_notice",
} as const;

export const SLACK_TEAMMATE_INVITATION_METADATA = {
  eventPayloadKey: "delivery_id",
  eventType: "openmeld_teammate_invited",
} as const;

export function buildSlackTeammateInvitationDeliveryId(input: {
  interactionId: string;
  targetSlackUserId: string;
}): string {
  return `${input.interactionId}:${input.targetSlackUserId}`;
}
