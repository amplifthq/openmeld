import { describe, expect, it } from "vitest";
import {
  getSpaceMessageAddressingRelationSupportForTargetKind,
  isSpaceMessageAddressingRelationSupportedForTargetKind,
  resolveSpaceMessageAddressingTargetField,
  SPACE_MESSAGE_ADDRESSING_RELATION_VALUES,
  SPACE_MESSAGE_ADDRESSING_TARGET_FIELD_VALUES,
  SPACE_MESSAGE_ADDRESSING_TARGET_KIND_VALUES,
  spaceMessageAddressingRelationSchema,
  spaceMessageAddressingTargetKindSchema,
} from "../../src/index";

describe("space message addressing contract", () => {
  it("keeps relation order and target field mapping stable", () => {
    expect(SPACE_MESSAGE_ADDRESSING_RELATION_VALUES).toEqual([
      "wake",
      "reference",
    ]);
    expect(SPACE_MESSAGE_ADDRESSING_TARGET_FIELD_VALUES).toEqual([
      "activationTargets",
      "referenceTargets",
    ]);
    expect(resolveSpaceMessageAddressingTargetField("wake")).toBe(
      "activationTargets"
    );
    expect(resolveSpaceMessageAddressingTargetField("reference")).toBe(
      "referenceTargets"
    );
  });

  it("keeps Wake limited to Agent Profile targets while Reference supports human or agent targets", () => {
    expect(SPACE_MESSAGE_ADDRESSING_TARGET_KIND_VALUES).toEqual([
      "human_profile",
      "agent_profile",
    ]);
    expect(
      getSpaceMessageAddressingRelationSupportForTargetKind("human_profile")
    ).toEqual({
      wake: false,
      reference: true,
    });
    expect(
      getSpaceMessageAddressingRelationSupportForTargetKind("agent_profile")
    ).toEqual({
      wake: true,
      reference: true,
    });
  });

  it("rejects unknown relations and target kinds", () => {
    expect(spaceMessageAddressingRelationSchema.safeParse("wake").success).toBe(
      true
    );
    expect(
      spaceMessageAddressingRelationSchema.safeParse("mention").success
    ).toBe(false);
    expect(
      spaceMessageAddressingTargetKindSchema.safeParse("agent_profile").success
    ).toBe(true);
    expect(
      spaceMessageAddressingTargetKindSchema.safeParse("space_member").success
    ).toBe(false);
  });

  it("answers relation compatibility without dispatch side effects", () => {
    expect(
      isSpaceMessageAddressingRelationSupportedForTargetKind({
        relation: "wake",
        targetKind: "human_profile",
      })
    ).toBe(false);
    expect(
      isSpaceMessageAddressingRelationSupportedForTargetKind({
        relation: "wake",
        targetKind: "agent_profile",
      })
    ).toBe(true);
    expect(
      isSpaceMessageAddressingRelationSupportedForTargetKind({
        relation: "reference",
        targetKind: "human_profile",
      })
    ).toBe(true);
  });
});
