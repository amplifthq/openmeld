---
id: center-agent-reconnect-and-directory-pages
title: More reliable command reconnection and directory reads
kind: fixed
areas: ["center-agent"]
audiences: ["members", "contributors"]
---

Center Agent can detach from a command while its output connection is still
opening without trying to open that connection twice. Detaching does not stop
or restart the command.

Large organization directories can be read in bounded pages, preserving member
and Agent details with explicit totals and continuation cursors. The Agent must
finish the pages before treating a roster or identity match as complete.
