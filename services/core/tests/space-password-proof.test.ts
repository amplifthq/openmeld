import { describe, expect, it } from "vitest";
import {
  buildSpacePasswordProof,
  parseSpacePasswordProofJson,
  type SpacePasswordProof,
  SpacePasswordProofError,
  verifySpacePasswordProof,
} from "../src/lib/space-password-proof";

describe("space-password-proof", () => {
  it("builds and verifies a password proof", async () => {
    const password = "OpenMeld#2026";
    const proof = await buildSpacePasswordProof(password);

    expect(proof).toMatchObject({
      v: 1,
      alg: "pbkdf2-sha256",
      iter: expect.any(Number),
      salt: expect.any(String),
      hash: expect.any(String),
    });
    expect(proof.iter).toBeGreaterThan(0);
    expect(await verifySpacePasswordProof(password, proof)).toBe(true);
  });

  it("returns false when password does not match proof", async () => {
    const proof = await buildSpacePasswordProof("Correct#Password");

    expect(await verifySpacePasswordProof("Wrong#Password", proof)).toBe(false);
  });

  it("throws stable error code when password is too short", async () => {
    await expect(buildSpacePasswordProof("12345")).rejects.toMatchObject({
      code: "space.password_too_short",
    });
  });

  it("parses valid password proof json", async () => {
    const proof = await buildSpacePasswordProof("Valid@Password");
    const raw = JSON.stringify(proof);

    expect(parseSpacePasswordProofJson(raw)).toEqual(proof);
  });

  it("fails on malformed password proof json", () => {
    expect(() => parseSpacePasswordProofJson("{bad-json")).toThrow(
      SpacePasswordProofError
    );
    expect(() => parseSpacePasswordProofJson("{}")).toThrow(
      SpacePasswordProofError
    );
  });

  it("fails on invalid proof object shape", () => {
    const malformedProof = {
      v: 1,
      alg: "pbkdf2-sha256",
      iter: 10_000,
      salt: "not-base64url",
      hash: "not-base64url",
    };

    expect(() =>
      parseSpacePasswordProofJson(JSON.stringify(malformedProof))
    ).toThrow(SpacePasswordProofError);
  });

  it("returns false when password is not a string", async () => {
    const proof = await buildSpacePasswordProof("Strong#Password");

    expect(
      await verifySpacePasswordProof(
        123 as unknown as string,
        proof as SpacePasswordProof
      )
    ).toBe(false);
  });
});
