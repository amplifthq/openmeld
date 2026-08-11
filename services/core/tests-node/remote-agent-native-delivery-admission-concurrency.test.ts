import { describe, expect, it } from "vitest";
import {
  prepareRemoteAgentAdmissionFoundation,
  runRemoteAgentAdmissionWithWatchdog,
  startRemoteAgentTurnContextAndSkills,
} from "../src/remote-agent/application/native-delivery-admission-concurrency";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
  };
}

describe("Remote Agent admission concurrency", () => {
  it("persists admission intent beside reading the current designation", async () => {
    const started: string[] = [];
    const admissionIntent = deferred<boolean>();
    const designation = deferred<{ agentProfileId: string }>();

    const result = prepareRemoteAgentAdmissionFoundation({
      persistAdmissionIntent: () => {
        started.push("admission_intent");
        return admissionIntent.promise;
      },
      readDesignation: () => {
        started.push("designation");
        return designation.promise;
      },
    });

    expect(started).toEqual(["admission_intent", "designation"]);

    designation.resolve({ agentProfileId: "agent-1" });
    let settled = false;
    result.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    admissionIntent.resolve(true);
    await expect(result).resolves.toEqual({ agentProfileId: "agent-1" });
  });

  it("starts skills beside turn context without delaying a context failure", async () => {
    const started: string[] = [];
    const turnContext = deferred<{ text: string }>();
    const organizationSkills = deferred<readonly string[]>();

    const preparation = startRemoteAgentTurnContextAndSkills({
      readOrganizationSkills: () => {
        started.push("skills");
        return organizationSkills.promise;
      },
      resolveTurnContext: () => {
        started.push("turn_context");
        return turnContext.promise;
      },
    });

    expect(started).toEqual(["turn_context", "skills"]);

    turnContext.resolve({ text: "ready" });
    await expect(preparation.turnContext).resolves.toEqual({
      status: "fulfilled",
      value: { text: "ready" },
    });

    let skillsSettled = false;
    preparation.organizationSkills.finally(() => {
      skillsSettled = true;
    });
    await Promise.resolve();
    expect(skillsSettled).toBe(false);

    organizationSkills.resolve(["skill-1"]);
    await expect(preparation.organizationSkills).resolves.toEqual({
      status: "fulfilled",
      value: ["skill-1"],
    });
  });

  it("starts admission beside its watchdog without making the ACK wait for the watchdog", async () => {
    const started: string[] = [];
    const watchdog = deferred<boolean>();
    const admission = deferred<"acknowledged">();

    const attempt = runRemoteAgentAdmissionWithWatchdog({
      enqueueWatchdog: () => {
        started.push("watchdog");
        return watchdog.promise;
      },
      submitAdmission: () => {
        started.push("admission");
        return admission.promise;
      },
    });

    expect(started).toEqual(["watchdog", "admission"]);

    admission.resolve("acknowledged");
    await expect(attempt.admission).resolves.toBe("acknowledged");

    let watchdogSettled = false;
    attempt.watchdog.finally(() => {
      watchdogSettled = true;
    });
    await Promise.resolve();
    expect(watchdogSettled).toBe(false);

    watchdog.resolve(true);
    await expect(attempt.watchdog).resolves.toEqual({
      status: "fulfilled",
      value: true,
    });
  });
});
