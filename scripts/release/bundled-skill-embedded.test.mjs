import test from "node:test";
import { verifyBundledSkillEmbedded } from "./verify-bundled-skill-embedded.mjs";

test("compiled standalone fallback contains every bundled skill with exact bytes", () => {
  verifyBundledSkillEmbedded();
});
