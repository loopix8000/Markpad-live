# Releasing Markpad Live

GitHub Actions builds every release for Windows, macOS and Linux. Installed copies of Markpad Live find a published release on their own and offer to install it.

## How updates reach users

The updater endpoint in `src-tauri/tauri.conf.json` points at **`loopix8000/markpad-live`**: the app reads `https://github.com/loopix8000/markpad-live/releases/latest/download/latest.json`. That address always serves the `latest.json` of the newest **published** release. A draft release is invisible to it.

A running app checks a few seconds after it starts and every six hours after that. It opens the update dialog only when a newer version is out, and does not offer the same version again in that session once the dialog is closed. **Check for updates…** in the app menu checks at any time. Only one window of a launch runs the automatic check.

| Platform | What updates itself |
| --- | --- |
| Windows (x64, ARM64) | The NSIS installer. The updater runs it in passive mode. |
| macOS (Universal) | The `.app`. |
| Linux | The AppImage only. A `.deb` or `.rpm` install skips the automatic check, and **Check for updates…** points it to its package manager. |

## Signing identity

Every update is signed, and the app installs only an update whose signature matches the public key in `plugins.updater.pubkey`. The key pair was generated for Markpad Live on 2026-11-27.

- The private key is `%USERPROFILE%\.tauri\markpad-live.key` on the maintainer's PC, and its password is in `markpad-live.key.password` beside it. Keep a backup of both somewhere other than that PC. **If the private key is lost, installed copies can no longer be updated**, and every user has to reinstall by hand after a new key is set.
- GitHub Actions has copies as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. To set them again, from Git Bash:

  ```sh
  gh secret set TAURI_SIGNING_PRIVATE_KEY --repo loopix8000/Markpad-live < ~/.tauri/markpad-live.key
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo loopix8000/Markpad-live < ~/.tauri/markpad-live.key.password
  ```

- Do not change `plugins.updater.pubkey`. A release signed with another key cannot update an installed copy.

## Per release

1. Run `npm run release X.Y.Z` with Rust on PATH. It writes the version to `package.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
2. Run the checks in the README, then commit and push to `master`.
3. Start the **Build and Release** workflow on `master`, from the Actions tab or with:

   ```sh
   gh workflow run build.yml --repo loopix8000/Markpad-live --ref master
   ```

   It creates the draft release `vX.Y.Z`, builds and signs each platform, uploads the installers with their `.sig` files, and writes `latest.json` from those signatures. It stops before writing `latest.json` if any platform's signature is missing.
4. Install the build from the draft and check it. To test the update path, start a previous version and use **Check for updates…** after publishing.
5. Publish the draft. From that moment installed copies pick up the update.

## macOS signing

Without Apple Developer ID secrets the workflow builds an unsigned app. Updates install normally, but a first install is blocked by Gatekeeper until the user opens the app from its context menu or removes the quarantine attribute with `xattr -dr com.apple.quarantine "/Applications/Markpad Live.app"`.

To sign and notarize, set `APPLE_DEVELOPER_ID_P12`, `APPLE_DEVELOPER_ID_PASSWORD`, `APPLE_DEVELOPER_ID_SHA1`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. The workflow also recognizes `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD` and `MACOS_SIGNING_IDENTITY`.

## Package managers

`publish-packages.yml` publishes a published release to Chocolatey and the Snap Store. Its jobs are skipped until the repository variable `PUBLISH_PACKAGES` is `true`. Before setting it, reserve the `markpad-live` names and add the `CHOCO_API_KEY` and Snap Store credentials the workflow reads. The upstream Markpad packages belong to the upstream project.

## Local builds

The desktop identifier is `io.github.loopix8000.markpadlive`, so Markpad Live uses its own application data directory, Windows file association and binary name.

For a local Windows installer without updater artifacts, from PowerShell run:

```powershell
node node_modules/@tauri-apps/cli/tauri.js build --ci --bundles nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

See the [Tauri updater documentation](https://v2.tauri.app/plugin/updater/) for details of the signing format.
