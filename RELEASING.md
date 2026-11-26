# Releasing Markpad Live

The updater endpoint in `src-tauri/tauri.conf.json` points at **`loopix8000/markpad-live`**. The desktop identifier is `io.github.loopix8000.markpadlive`. Markpad Live uses a separate application data directory, Windows file association and binary name.

## Signing

Before the first public release, the maintainer must provision the fork's updater signing identity. The checked-in public key is inherited from Markpad. Only the maintainer sets the fork's public key, before distributing an updater-enabled build. A release signed with a different key cannot update an installed client. Keep the private key outside the repository and store the corresponding values as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in GitHub Actions.

For a local Windows build without updater artifacts, from PowerShell run:

```powershell
node node_modules/@tauri-apps/cli/tauri.js build --ci --bundles nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

For signed macOS distribution configure `APPLE_DEVELOPER_ID_P12`, `APPLE_DEVELOPER_ID_PASSWORD`, `APPLE_DEVELOPER_ID_SHA1`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. The workflow also recognizes `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD` and `MACOS_SIGNING_IDENTITY`.

## Release workflow

1. Run `npm run release X.Y.Z` with Rust on PATH. Review the npm and Cargo versions and lockfiles.
2. Run the checks in the README and commit the release changes.
3. Run the Build workflow in the fork. It creates a draft release, builds each platform and generates `latest.json` from signed artifacts.
4. Verify the portable Windows executable and installer, universal macOS app and Linux packages. Test an update on a previous Markpad Live installation with the same signing identity.
5. Publish the draft when validation is complete. Package publishing consumes the published assets. Configure the fork's Chocolatey and Snap Store credentials and reserve the `markpad-live` names before enabling those jobs. The upstream Markpad packages belong to the upstream project.

See the [Tauri updater documentation](https://v2.tauri.app/plugin/updater/) for key generation and the [repository releases](https://github.com/loopix8000/markpad-live/releases) for published artifacts.
