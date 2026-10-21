import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  authorizeDirectMessageSessionOperation,
  type DirectMessageSessionAccessInput,
} from "../src/space/rules/access/direct-message-session-access";

const HUMAN = "human-felix";
const AGENT = "agent-claude-code";
const OTHER_HUMAN = "human-tali";

function sessionInput(
  overrides: Partial<DirectMessageSessionAccessInput> = {}
): DirectMessageSessionAccessInput {
  return {
    actor: { openMeldProfileId: HUMAN, profileKind: "human" },
    meta: {
      purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
      directMessage: { pairKey: [HUMAN, AGENT].sort().join(":") },
    },
    members: [
      { profileId: HUMAN, profileKindSnapshot: "human", status: "active" },
      { profileId: AGENT, profileKindSnapshot: "agent", status: "active" },
    ],
    ...overrides,
  };
}

describe("agent Direct Message Session access", () => {
  it("lets the Human in the Session's pair rename, archive, or delete it", () => {
    expect(authorizeDirectMessageSessionOperation(sessionInput())).toEqual({
      ok: true,
      humanProfileId: HUMAN,
      agentProfileId: AGENT,
    });
  });

  it.each([
    ["the Agent itself", { openMeldProfileId: AGENT, profileKind: "agent" }],
    [
      "a colleague or owner observer outside the pair",
      { openMeldProfileId: OTHER_HUMAN, profileKind: "human" },
    ],
    ["a caller without a Profile", { profileKind: "human" }],
  ])("refuses %s", (_label, actor) => {
    expect(
      authorizeDirectMessageSessionOperation(sessionInput({ actor }))
    ).toMatchObject({ ok: false, code: "direct_message_session.forbidden" });
  });

  it("refuses the pair's Human once they are no longer an active member", () => {
    expect(
      authorizeDirectMessageSessionOperation(
        sessionInput({
          members: [
            {
              profileId: HUMAN,
              profileKindSnapshot: "human",
              status: "removed",
            },
            {
              profileId: AGENT,
              profileKindSnapshot: "agent",
              status: "active",
            },
          ],
        })
      )
    ).toMatchObject({ ok: false, code: "direct_message_session.forbidden" });
  });

  it.each([
    [
      "a converted Direct Message",
      {
        meta: {
          purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          directMessage: {
            pairKey: [HUMAN, AGENT].sort().join(":"),
            convertedAt: "2026-10-18T10:00:00.000Z",
          },
        },
      },
    ],
    [
      "a deleted Session",
      {
        meta: {
          purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          deletedAt: "2026-10-18T10:00:00.000Z",
          directMessage: { pairKey: [HUMAN, AGENT].sort().join(":") },
        },
      },
    ],
    ["an ordinary Space", { meta: { purpose: "team_space" } }],
    ["a missing Space", { meta: null }],
    [
      "a Human–Human Direct Message",
      {
        meta: {
          purpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
          directMessage: { pairKey: [HUMAN, OTHER_HUMAN].sort().join(":") },
        },
        members: [
          {
            profileId: HUMAN,
            profileKindSnapshot: "human",
            status: "active",
          },
          {
            profileId: OTHER_HUMAN,
            profileKindSnapshot: "human",
            status: "active",
          },
        ],
      },
    ],
  ])("treats %s as unavailable", (_label, overrides) => {
    expect(
      authorizeDirectMessageSessionOperation(
        sessionInput(overrides as Partial<DirectMessageSessionAccessInput>)
      )
    ).toMatchObject({ ok: false, code: "direct_message_session.not_found" });
  });
});
