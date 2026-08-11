import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDesiredMonitoring,
  collectAvailableAlertTypes,
  parseProvisionMonitoringArgs,
  provisionMonitoring,
} from "./provision-monitoring.mjs";

const EMAIL = "ops@example.com";
const DRY_RUN_MESSAGE_RE = /No Cloudflare API writes were made/u;
const HEALTH_CHECK_VERIFICATION_RE =
  /Health Check verification did not return/u;
const WORKERS_ALERT_RE = /workers_alert/u;
const ignoreLog = () => undefined;

// Exact result shape from Cloudflare's Get Alert Types API reference 200 example:
// https://developers.cloudflare.com/api/resources/alerting/subresources/available_alerts/methods/list/
const CLOUDFLARE_AVAILABLE_ALERTS_RESULT_EXAMPLE = {
  "Origin Monitoring": [
    {
      description: "High levels of 5xx HTTP errors at your origin.",
      display_name: "Origin Error Rate Alert",
      filter_options: [
        {
          AvailableValues: null,
          ComparisonOperator: "==",
          Key: "zones",
          Range: "1-n",
        },
        {
          AvailableValues: [
            {
              Description: "Service-Level Objective of 99.7",
              ID: "99.7",
            },
            {
              Description: "Service-Level Objective of 99.8",
              ID: "99.8",
            },
          ],
          ComparisonOperator: ">=",
          Key: "slo",
          Range: "0-1",
        },
      ],
      type: "http_alert_origin_error",
    },
  ],
};

test("builds the three production HTTPS health checks and email policies", () => {
  const desired = buildDesiredMonitoring({ email: EMAIL });

  assert.deepEqual(
    desired.healthChecks.map((check) => ({
      address: check.address,
      consecutiveFails: check.consecutive_fails,
      interval: check.interval,
      path: check.http_config.path,
      type: check.type,
    })),
    [
      {
        address: "openmeld.ai",
        consecutiveFails: 2,
        interval: 60,
        path: "/",
        type: "HTTPS",
      },
      {
        address: "gateway.openmeld.ai",
        consecutiveFails: 2,
        interval: 60,
        path: "/health",
        type: "HTTPS",
      },
      {
        address: "auth.openmeld.ai",
        consecutiveFails: 2,
        interval: 60,
        path: "/health",
        type: "HTTPS",
      },
    ]
  );
  assert.deepEqual(
    desired.notificationPolicies.map((policy) => ({
      alertType: policy.alert_type,
      email: policy.mechanisms.email[0].id,
    })),
    [
      {
        alertType: "health_check_status_notification",
        email: EMAIL,
      },
      { alertType: "workers_alert", email: EMAIL },
    ]
  );
});

test("defaults to dry-run and accepts the notification email from the environment", () => {
  const parsed = parseProvisionMonitoringArgs([], {
    CLOUDFLARE_NOTIFICATION_EMAIL: EMAIL,
  });

  assert.equal(parsed.apply, false);
  assert.equal(parsed.email, EMAIL);
});

test("reads alert types from Cloudflare's documented available-alerts result", () => {
  assert.deepEqual(
    collectAvailableAlertTypes(CLOUDFLARE_AVAILABLE_ALERTS_RESULT_EXAMPLE),
    new Set(["http_alert_origin_error"])
  );
});

test("dry-run prints a complete plan without credentials or network access", async () => {
  const output = [];
  const summary = await provisionMonitoring({
    apply: false,
    email: EMAIL,
    fetchImpl: () => {
      throw new Error("dry-run must not call fetch");
    },
    log: (line) => output.push(line),
  });

  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.healthChecks.length, 3);
  assert.equal(summary.notificationPolicies.length, 2);
  assert.match(output.join("\n"), DRY_RUN_MESSAGE_RE);
  assert.match(output.join("\n"), WORKERS_ALERT_RE);
});

test("apply creates, updates, and skips resources by their stable names", async () => {
  const api = createFakeCloudflareApi({
    availableAlertTypes: ["health_check_status_notification", "workers_alert"],
    healthChecks: [
      {
        ...buildDesiredMonitoring({ email: EMAIL }).healthChecks[0],
        id: "health-web",
        status: "healthy",
      },
      {
        ...buildDesiredMonitoring({ email: EMAIL }).healthChecks[1],
        id: "health-gateway",
        interval: 120,
        status: "healthy",
      },
    ],
    policies: [],
  });

  const summary = await runFakeApply(api);

  assert.equal(summary.ok, true);
  assert.deepEqual(
    summary.healthChecks.map(({ action, name }) => ({ action, name })),
    [
      { action: "unchanged", name: "openmeld-web-health" },
      { action: "updated", name: "openmeld-gateway-health" },
      { action: "created", name: "openmeld-auth-health" },
    ]
  );
  assert.deepEqual(
    summary.notificationPolicies.map(({ action, name }) => ({ action, name })),
    [
      { action: "created", name: "openmeld-health-check-status" },
      { action: "created", name: "openmeld-workers-usage" },
    ]
  );
  assert.deepEqual(api.writes, [
    "update health check",
    "create health check",
    "create notification policy",
    "create notification policy",
  ]);
  const healthPolicy = api.policies.find(
    (policy) => policy.name === "openmeld-health-check-status"
  );
  assert.deepEqual(healthPolicy.filters.health_check_id, [
    "health-web",
    "health-gateway",
    "health-3",
  ]);

  const repeated = await runFakeApply(api);

  assert.equal(repeated.ok, true);
  assert.ok(
    [...repeated.healthChecks, ...repeated.notificationPolicies].every(
      (resource) => resource.action === "unchanged"
    )
  );
  assert.equal(api.writes.length, 4);
});

test("apply reports an unavailable workers alert without hiding successful health setup", async () => {
  const api = createFakeCloudflareApi({
    availableAlertTypes: ["health_check_status_notification"],
  });

  const summary = await runFakeApply(api);

  assert.equal(summary.ok, false);
  assert.equal(summary.healthChecks.length, 3);
  assert.equal(summary.notificationPolicies.length, 1);
  assert.match(summary.blocked[0], WORKERS_ALERT_RE);
});

test("apply fails when the verification query cannot see a managed resource", async () => {
  const api = createFakeCloudflareApi({
    availableAlertTypes: ["health_check_status_notification", "workers_alert"],
    hideHealthChecksDuringVerification: true,
  });

  const summary = await runFakeApply(api);

  assert.equal(summary.ok, false);
  assert.match(summary.blocked.join("\n"), HEALTH_CHECK_VERIFICATION_RE);
});

function createFakeCloudflareApi(input = {}) {
  const healthChecks = structuredClone(input.healthChecks ?? []);
  const policies = structuredClone(input.policies ?? []);
  const writes = [];
  const availableAlertTypes = input.availableAlertTypes ?? [];
  let healthCheckListCount = 0;

  return {
    createHealthCheck: (body) => {
      writes.push("create health check");
      const created = { ...body, id: `health-${healthChecks.length + 1}` };
      healthChecks.push(created);
      return created;
    },
    createNotificationPolicy: (body) => {
      writes.push("create notification policy");
      const created = { ...body, id: `policy-${policies.length + 1}` };
      policies.push(created);
      return { id: created.id };
    },
    listAvailableAlertTypes: () => new Set(availableAlertTypes),
    listHealthChecks: () => {
      healthCheckListCount += 1;
      if (
        input.hideHealthChecksDuringVerification &&
        healthCheckListCount > 1
      ) {
        return [];
      }
      return healthChecks;
    },
    listNotificationPolicies: () => policies,
    updateHealthCheck: (id, body) => {
      writes.push("update health check");
      const index = healthChecks.findIndex((check) => check.id === id);
      healthChecks[index] = { ...body, id };
      return healthChecks[index];
    },
    updateNotificationPolicy: (id, body) => {
      writes.push("update notification policy");
      const index = policies.findIndex((policy) => policy.id === id);
      policies[index] = { ...body, id };
      return { id };
    },
    get healthChecks() {
      return healthChecks;
    },
    get policies() {
      return policies;
    },
    writes,
  };
}

function runFakeApply(client) {
  return provisionMonitoring({
    accountId: "account-id",
    apiToken: "api-token",
    apply: true,
    client,
    email: EMAIL,
    log: ignoreLog,
    zoneId: "zone-id",
  });
}
