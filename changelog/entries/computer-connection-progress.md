---
id: computer-connection-progress
title: Follow each step while connecting a computer
kind: improved
areas: ["desktop", "computer-connection"]
audiences: ["members"]
---

OpenMeld Desktop now shows the real stage of a computer connection or account
switch from the moment it starts, including measured download progress when
OpenMeld Tools are required. The matching Web setup session follows the same
live stages, can be opened directly from Desktop once the session exists, and
marks interrupted observation as reconnecting without changing how connection
success is determined.

The standalone Desktop connection page keeps its Back button easy to reach and
centers the connection card in the available space. It explains the first
connection check without disabling known, account-aligned controls during an
ordinary background refresh. Disconnect now shows when Desktop is checking the
connection, waiting for confirmation, and executing the request. Cancellation,
confirmed disconnection, and an unconfirmed result have distinct messages and a
safe next step; connection details retain the diagnostic reference. Disconnect
keeps Desktop signed in and leaves the Computer in the cloud list. Reopening an
operation resumes its feedback without replaying a previous connection result.

Connect this Mac also remains available when OpenMeld Tools are missing or too
old to check the connection. Choosing Connect uses the verified installer;
opening or refreshing the page never installs tools automatically. Identity and
other read errors still require a successful check before proceeding.
