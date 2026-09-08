---
id: center-agent-reconnect-and-directory-pages
title: More reliable command reconnection and directory reads
kind: fixed
areas: ["center-agent"]
audiences: ["members", "contributors"]
publishedAt: 2026-09-07
release: v0.3.164
evidence: ["pr:697", "workflow:34048148581", "signal:6f67a276-764a-4687-a9ac-9216455094c6"]
---

Center Agent can detach from a command while its output connection is still
opening without trying to open that connection twice. Detaching does not stop
or restart the command.

Large organization directories can be read in bounded pages, preserving member
and Agent details with explicit totals and continuation cursors. The Agent must
finish the pages before treating a roster or identity match as complete.
