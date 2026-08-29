---
id: find-people-and-their-computers-together
title: Find people and their computers together
kind: improved
areas: ["people", "computers", "navigation"]
audiences: ["members", "admins"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:436", "commit:039fe8df2c1366b271b2a9f3199e11f53391fcf6", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:c3c4d138-2fd2-4df6-9ef2-d49fb24cf085", "pr-comment:5463688488"]
---

People now keeps Human Profiles in a dedicated sidebar and opens each person's
full details in the main view. Computer cards live with their owner, invitations
share one dialog, and the current Computer is always one click away from the
bottom toolbar. Computer status now follows the current OpenMeld Service
connection, so a registered Computer never looks ready only because OpenMeld
has seen it before.

The People sidebar now groups teammates as **Connected** or **Not Connected**
based on whether they have connected a Computer, with plain-language tooltips
for both labels. Your own profile stays first, while teammates in each group are
ordered by when they were last seen in OpenMeld Web. Activity uses compact copy
such as **3 hours ago**, explains **Last seen 3 hours ago** on hover, and sits on
the same row as Local Agent icons. Empty Channel rows no longer reserve space.
Opening or returning to OpenMeld Web now refreshes your last-seen time; using the
CLI alone does not.
