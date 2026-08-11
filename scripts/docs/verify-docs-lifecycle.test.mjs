import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeDocument,
  isLifecycleDocument,
} from "./verify-docs-lifecycle.mjs";

const AGENT_CONTEXT = `## Agent Context

- Purpose: Test fixture.
- Read this when: Testing.
- Update this when: Behavior changes.
- Do not use this for: Product truth.
- Source of truth: This fixture.
`;

describe("developing documentation lifecycle verifier", () => {
  it("classifies review, plan, design, and handoff documents as lifecycle documents", () => {
    for (const path of [
      "developing/architecture/review/example.md",
      "developing/product/example-plan.md",
      "developing/product/example-design.md",
      "developing/product/example-handoff.md",
    ]) {
      assert.equal(isLifecycleDocument(path), true, path);
    }
    assert.equal(
      isLifecycleDocument("developing/product/product-model.md"),
      false
    );
  });

  it("requires Agent Context, Status, and removal conditions on lifecycle documents", () => {
    const result = analyzeDocument(
      "developing/product/example-design.md",
      "# Example\n"
    );
    assert.equal(result.violations.length, 8);
    assert.equal(result.violations[0].includes("Agent Context"), true);
    assert.equal(result.violations[6].includes("Status"), true);
    assert.equal(result.violations[7].includes("removal condition"), true);
  });

  it("rejects incomplete or late Agent Context blocks", () => {
    const incomplete = analyzeDocument(
      "developing/product/product-model.md",
      "# Product Model\n\n## Agent Context\n\n- Purpose: Test.\n"
    );
    assert.equal(incomplete.violations.length, 4);
    assert.equal(incomplete.violations[0].includes("Read this when"), true);

    const late = analyzeDocument(
      "developing/product/product-model.md",
      `# Product Model\n\nIntro first.\n\n${AGENT_CONTEXT}`
    );
    assert.equal(late.violations[0].includes("followed immediately"), true);
  });

  it("rejects lifecycle Status lines in owner documents", () => {
    const result = analyzeDocument(
      "developing/product/product-model.md",
      `# Product Model\n\n${AGENT_CONTEXT}\nStatus: ACTIVE\n`
    );
    assert.deepEqual(result.violations, [
      "developing/product/product-model.md: owner document must not carry a lifecycle Status: line",
    ]);
  });

  it("requires dated implementation records to live on a lifecycle path", () => {
    const misplaced = analyzeDocument(
      "developing/product/implementation-record.md",
      `# Record\n\n${AGENT_CONTEXT}\nStatus: IMPLEMENTED. Remove when owner docs absorb this record.\n`
    );
    assert.deepEqual(misplaced.violations, [
      "developing/product/implementation-record.md: owner document must not carry a lifecycle Status: line",
    ]);

    const placed = analyzeDocument(
      "developing/architecture/review/implementation-record.md",
      `# Record\n\n${AGENT_CONTEXT}\nStatus: IMPLEMENTED. Remove when owner docs absorb this record.\n`
    );
    assert.deepEqual(placed.violations, []);
  });

  it("accepts a complete lifecycle document and surfaces completed work for deletion review", () => {
    const result = analyzeDocument(
      "developing/architecture/review/example.md",
      `# Example\n\n${AGENT_CONTEXT}\nStatus: SHIPPED. Remove this file when owner docs contain the durable result.\n`
    );
    assert.deepEqual(result.violations, []);
    assert.equal(result.deletionCandidates.length, 1);
  });

  it("accepts a current owner document without a Status line", () => {
    const result = analyzeDocument(
      "developing/product/product-model.md",
      `# Product Model\n\n${AGENT_CONTEXT}\n## Purpose\nCurrent behavior.\n`
    );
    assert.deepEqual(result, { deletionCandidates: [], violations: [] });
  });
});
