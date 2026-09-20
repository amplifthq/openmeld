# better-sqlite3 13.0.3: use the bundled prebuild

v13 ships `prebuilds/<platform>-<arch>.node` and loads it from JavaScript. It
also ships `binding.gyp` with no `install` script, so pnpm infers
`node-gyp rebuild`. That compile fails on GitHub `windows-latest` because
node-gyp does not recognize Visual Studio 18.

This patch adds an explicit install script that only checks the bundled
prebuild exists. CLI and Auth stay on better-sqlite3 12.6.2, which still uses
`prebuild-install`. Root `package.json` `sherif.ignoreDependency` allows that
intentional dual version so repository-contracts do not treat it as drift.

Remove the patch when an upstream 13.x release restores a Node-only install
path that prefers the bundled binary before node-gyp.
