# Vitrine Ad Hoc — same setup as Done

Use **Codemagic** to download the signed IPA directly from the build, just as you do with **Done / TaskReminder**. There is **no Cloudflare, R2, password-protected archive, local Mac, or iPhone-to-PC cable** involved in this flow.

## One-time setup

1. Open [Codemagic](https://codemagic.io/apps) and **Add application** from [Soufiane-Fartit/vitrine](https://github.com/Soufiane-Fartit/vitrine). Choose the same Codemagic team/account as Done. If GitHub doesn't show the fork, allow the Codemagic GitHub App to access it.
2. Select the repository's **codemagic.yaml** configuration and the **iOS Ad Hoc** (`ios-adhoc`) workflow.
3. The workflow uses the existing **`taskreminder_secrets`** environment group already used by Done. It needs the same six values: `FASTLANE_ISSUER_ID`, `FASTLANE_KEY_ID`, `FASTLANE_KEY`, `TEAMID`, `MATCH_PASSWORD`, and `GH_PAT`. No new Apple certificate or provisioning setup is required if your profiles and iPhone are already registered.
4. Start the build. On the completed build page open **Artifacts** and download **`Vitrine-AdHoc.ipa`**. This is the **direct IPA artifact**, not a ZIP or encrypted 7z.

The workflow downloads the fixed Vitrine 1.0.0-beta.16 / Spotify 9.1.90 certificate-compatible IPA from [estrogencat/EeveeIPA](https://github.com/estrogencat/EeveeIPA/releases/tag/1.0.0-beta.16-LG-2026-10-26-11-29-04), verifies the pinned SHA-256 hash, reuses the existing Fastlane Match certificate store and generates Vitrine Ad Hoc profiles, then signs the main app plus five extensions with `zsign`.

## What remains on GitHub?

The previously successful [GitHub Actions workflow](https://github.com/Soufiane-Fartit/vitrine/actions/workflows/vitrine-adhoc.yml) is kept as an **alternative encrypted backup**, because the public repository should not publish a signed IPA openly (its embedded Ad Hoc profiles can expose registered device UDIDs). You **don't need to run that workflow** when using Codemagic. The Cloudflare R2 integration has been removed.

## Installation

Your iPhone must be registered in the Vitrine Ad Hoc profiles, exactly as with Done. Once the Codemagic build finishes, use its downloaded IPA and your normal installation route. A raw IPA file does not itself create a universal Safari installation link; the installation behavior depends on how you open it and on iOS. The goal of this workflow is **matching Done's direct artifact download**, without an additional archive/password/hosting service.

**Note:** The upstream IPA is an unofficial modified Spotify binary. A successful signature check does not independently audit it or prove on-device compatibility.
