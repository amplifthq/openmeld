import assert from "node:assert/strict";
import test from "node:test";

import { admitHostedFleetPlan } from "./hosted-fleet-plan-admission.mjs";

const RELEASE_SHA = "b".repeat(40);
const STABLE_TAG_SHA = "a".repeat(40);
const RECEIVER_FIRST_PROFILE_PATTERN = /local-service-runtime-receiver-first/u;
const BEFORE_MUTATION_PATTERN = /before any Production mutation/u;
const RELEASE_PLAN_PATTERN = /release:plan/u;
const STABLE_TAG_REF_PATTERN = /refs\/tags\/v0\.3\.135/u;
const CANONICAL_STABLE_VERSION_PATTERN = /canonical stable CLI version/u;

test("admits the static hosted fleet workflow for its default deploy order", async () => {
  const result = await admitHostedFleetPlan(
    {
      releaseSha: RELEASE_SHA,
      releaseSource: "/release-source",
      scope: "cloud",
    },
    {
      buildPlan: (input) => ({
        base: input.base,
        deployOrderProfile: "default-auth-receiver-first",
        sourceSha: input.sourceSha,
      }),
      fetchStableVersion: async () => "0.3.135",
      readHeadSha: () => RELEASE_SHA,
      resolveTagSha: (tag) => {
        assert.equal(tag, "v0.3.135");
        return STABLE_TAG_SHA;
      },
    }
  );

  assert.deepEqual(result, {
    baseRef: "refs/tags/v0.3.135",
    baseSha: STABLE_TAG_SHA,
    deployOrderProfile: "default-auth-receiver-first",
    releaseSha: RELEASE_SHA,
    scope: "cloud",
  });
});

test("rejects a receiver-first fleet plan before any Production mutation", async () => {
  await assert.rejects(
    () =>
      admitHostedFleetPlan(
        {
          releaseSha: RELEASE_SHA,
          releaseSource: "/release-source",
          scope: "full",
        },
        {
          buildPlan: () => ({
            deployOrderProfile: "local-service-runtime-receiver-first",
          }),
          fetchStableVersion: async () => "0.3.135",
          readHeadSha: () => RELEASE_SHA,
          resolveTagSha: () => STABLE_TAG_SHA,
        }
      ),
    (error) => {
      assert.match(error.message, RECEIVER_FIRST_PROFILE_PATTERN);
      assert.match(error.message, BEFORE_MUTATION_PATTERN);
      assert.match(error.message, RELEASE_PLAN_PATTERN);
      assert.match(error.message, STABLE_TAG_REF_PATTERN);
      return true;
    }
  );
});

test("fails closed when the stable channel cannot identify an immutable base tag", async () => {
  await assert.rejects(
    () =>
      admitHostedFleetPlan(
        {
          releaseSha: RELEASE_SHA,
          releaseSource: "/release-source",
          scope: "cloud",
        },
        {
          fetchStableVersion: async () => "0.3.135-beta",
          readHeadSha: () => RELEASE_SHA,
        }
      ),
    CANONICAL_STABLE_VERSION_PATTERN
  );
});

test("does not turn a scoped component deploy into a fleet-plan ceremony", async () => {
  const result = await admitHostedFleetPlan({
    releaseSha: RELEASE_SHA,
    releaseSource: "/release-source",
    scope: "web",
  });

  assert.deepEqual(result, {
    releaseSha: RELEASE_SHA,
    scope: "web",
    skipped: true,
  });
});
