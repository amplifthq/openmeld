# Cloudflare Workers Error-Rate Alert Checklist

Use this checklist for the newer `workers_observability_alert` alert type. Its
public API configuration contract is not sufficiently documented for safe
automation, so these alerts remain an explicit dashboard task.

## Destination and scope

- Destination: the same operations email supplied as
  `CLOUDFLARE_NOTIFICATION_EMAIL` to the provisioning script.
- Production Workers:
  - `openmeld-web`
  - `openmeld-gateway`
  - `openmeld-auth`
  - `openmeld-core`
  - `openmeld-remote-agent`

Create one alert per Worker so an incident identifies its owner immediately.
Do not combine all Workers into one opaque account-level alert.

## Dashboard steps

Cloudflare dashboard labels can vary by account rollout. Start at **Workers &
Pages**, select the production Worker, and open **Observability**. Look for
**Alerts** or **Create alert**. If that control is not present, use account-level
**Notifications** → **Add** and select the Workers Observability error-rate alert.

For each Worker:

1. Select the production Worker by its exact name above.
2. Choose the invocation error-rate metric, not HTTP 4xx/5xx status alone.
   Invocation errors include uncaught exceptions, exceeded resources, and
   Workers runtime internal errors.
3. Use a 5-minute evaluation window.
4. Set the initial critical threshold to an error rate greater than 5%, with at
   least 20 invocations in the window when the UI supports a minimum-volume
   condition.
5. Send email to the operations destination.
6. Name it `OpenMeld <worker-name> invocation error rate`.
7. Save it and verify the alert appears enabled.

The 5% threshold is a launch baseline, not a permanent SLO. After one week of
production traffic, review false positives and normal background error rates.
For high-volume Workers, add a warning alert at greater than 1% for 10 minutes.
For low-volume Workers, keep the 5% alert and rely on the public Health Checks to
catch complete outages without percentage noise.

## Verification record

Record these fields in the delivery or incident system:

- Worker name.
- Alert name and enabled state.
- Evaluation window and threshold.
- Minimum invocation condition, if available.
- Destination email.
- Cloudflare policy or alert ID, if shown.
- UTC verification time.

Finally, compare the five enabled alerts against the five production names above.
No Worker should be missing, duplicated, or pointed at a preview environment.

## References

- [Cloudflare Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Cloudflare Workers errors and exceptions](https://developers.cloudflare.com/workers/observability/errors/)
- [Cloudflare Workers metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
