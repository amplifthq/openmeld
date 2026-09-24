---
id: macos-computer-setup-reliability
title: More reliable Mac setup downloads
kind: fixed
areas: ["computer-setup", "desktop", "cli"]
audiences: ["members"]
---

Mac setup now stops when its download fails or is incomplete, retries stalled downloads, keeps production downloads on HTTPS, and verifies that production CLI binaries have OpenMeld's Apple-issued Developer ID signature before installation. If a CLI upgrade fails, its recovery instructions take you to Web for a fresh setup command instead of showing a command that cannot run. Connection instructions also describe Service startup failures without assuming macOS blocked the background item.
