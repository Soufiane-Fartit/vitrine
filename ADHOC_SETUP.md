# Sign a prebuilt Vitrine IPA (Ad Hoc)

This fork provides **Vitrine - sign prebuilt Ad Hoc IPA** under [GitHub Actions](https://github.com/Soufiane-Fartit/vitrine/actions/workflows/vitrine-adhoc.yml). It does **not** compile Spotify, and no `SPOTIFY_IPA_URL` is needed.

## Prebuilt IPA used

- Publisher: [estrogencat/EeveeIPA](https://github.com/estrogencat/EeveeIPA/releases/tag/1.0.0-beta.16-LG-2026-10-26-11-29-04) (**unofficial third-party release**, not distributed or verified by Vitrine or Spotify).
- Version: Spotify **9.1.90** with **Vitrine 1.0.0-beta.16**.
- Asset: `EeveeSpotify-9.1.90-ESR-1.0.0-beta.16-LG-patched.ipa` (publisher labels it certificate-signing-compatible).
- SHA-256: `b9e32500c9f31a318ab30124a292c39560f7e088d036957b1e7782b946be6685`.

The workflow pins the exact download and checks the SHA-256 before signing, preventing a changed file from passing unnoticed. This **does not** establish the third-party executable's trustworthiness. No source build or independent security audit is performed. This prebuilt binary won't automatically incorporate later changes to this fork.

## One-time setup

1. In [Vitrine repository secrets](https://github.com/Soufiane-Fartit/vitrine/settings/secrets/actions), copy the secure signing values already used for Done (TaskReminder): `FASTLANE_ISSUER_ID`, `FASTLANE_KEY_ID`, `FASTLANE_KEY`, `GH_PAT`, `MATCH_PASSWORD`, `TEAMID`. GitHub secrets are scoped to each repository and cannot be copied automatically. `GH_PAT` needs access to the private `Match-Secrets` repo and permission to write new Vitrine profiles there.
2. **One new secret:** `IPA_ARCHIVE_PASSWORD` (12+ characters, unique, keep it safe). This is **only** because your fork is public; Actions artifacts can be downloaded by others. The signed IPA is encrypted as `.7z` before upload.
3. In [Apple Developer Identifiers](https://developer.apple.com/account/resources/identifiers/list), register the main Vitrine ID: `com.soufianefartit.vitrine`. Also register each extension ID reported in the workflow summary on the first run. The workflow will then create matching Ad Hoc profiles using your **existing** distribution certificate and iPhone registration; it will not create another certificate intentionally.
4. Run [Vitrine - sign prebuilt Ad Hoc IPA](https://github.com/Soufiane-Fartit/vitrine/actions/workflows/vitrine-adhoc.yml) manually on `main`.
5. Download the `vitrine-adhoc-encrypted` artifact, extract the nested `.7z` with your password, then install the signed `vitrine-adhoc.ipa` through your regular Ad Hoc installation method.

## Notes

- No TestFlight, separate certificate, new device registration, Spotify IPA URL, or local Mac.
- App ID is **different** from official Spotify and Done, so this IPA installs separately. Spotify URL/deep-link handling may differ.
- The workflow re-signs the main app and present extensions with separate provisioning profiles. Some Spotify-specific capabilities may require their own Apple entitlements and may not function after signing.
- The workflow does not prove real-device installation or playback: a successful run only confirms IPA/provisioning metadata.
- The alternative **Build IPA from your own Spotify IPA** workflow remains available for source builds.
- **Do not** upload signing credentials or the IPA to your public repository. The signing identity is read from your pre-existing private `Match-Secrets` store.
