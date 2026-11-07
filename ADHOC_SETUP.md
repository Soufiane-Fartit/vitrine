# Vitrine: personal Ad Hoc build

This fork adds a separate **Vitrine - personal Ad Hoc IPA** GitHub Actions workflow. It builds from your own decrypted Spotify IPA, signs it for your registered iPhone, and uploads an **encrypted** archive. It never uploads to TestFlight or changes TaskReminder.

## One-time steps

1. At [Vitrine → Actions secrets](https://github.com/Soufiane-Fartit/vitrine/settings/secrets/actions), add the **same values** used by Done/TaskReminder:
   - `FASTLANE_ISSUER_ID`, `FASTLANE_KEY_ID`, `FASTLANE_KEY`
   - `GH_PAT`, `MATCH_PASSWORD`, `TEAMID`
   GitHub does not make secrets available across repositories. Do not paste their values into the repository or this chat. `GH_PAT` needs read/write access to the private `Soufiane-Fartit/Match-Secrets` repository.
2. Set `SPOTIFY_IPA_URL` to your HTTPS direct-download URL for a decrypted Spotify IPA supported by this fork. Never commit that IPA to the public repository.
3. Set `IPA_ARCHIVE_PASSWORD` to a unique strong password of 20 or more characters. You'll need this password to extract the result.
4. Register **explicit** bundle identifiers on [Apple Developer → Identifiers](https://developer.apple.com/account/resources/identifiers/list). The main ID is `com.soufianefartit.vitrine`. Each extension needs its own ID: `com.soufianefartit.vitrine.<extension-executable-lowercase>`. The build lists the exact IDs in its Actions job summary, before trying to create the profiles. If the first run fails with unregistered IDs, register those identifiers and rerun. You do **not** need to create another Apple distribution certificate, register your iPhone again, or create an App Store Connect app.
5. Enable Actions if prompted. Merge the signing PR, then run [Actions → Vitrine - personal Ad Hoc IPA](https://github.com/Soufiane-Fartit/vitrine/actions/workflows/vitrine-adhoc.yml) on `main`.
6. Download the `vitrine-adhoc-encrypted` artifact and extract the inner `vitrine-adhoc.7z` with 7-Zip and your password. Install `vitrine-adhoc.ipa` using a compatible device installer for your existing Ad Hoc provisioning.

## Design and caveats

- **Public fork**: GitHub Actions artifacts on a public repository may be accessible to others. We never upload plaintext IPA artifacts: the IPA is encrypted with 7-Zip AES-256, and only the encrypted archive is retained for seven days.
- **Signing reuse**: The Fastlane lane uses the same `Match-Secrets` repository, `master` branch, team and existing certificate as Done. It first performs a read-only check for an existing certificate; profile creation is scoped to the new Vitrine identifiers. Done's app IDs and profiles are not modified.
- **Extensions**: The workflow inspects the generated Spotify IPA and assigns a unique derived bundle ID and Ad Hoc profile to each nested `.appex`. If a capability is needed (widgets, app groups, push), enable it explicitly in the Apple Developer portal for the relevant ID. Some original Spotify integrations may not function after re-signing.
- **Separate app**: Uses `com.soufianefartit.vitrine`, which does not overwrite the official Spotify or Done app. Deep links or Spotify Connect behavior may differ.
- **No device claim**: The workflow validates bundle identifiers and provisioning profiles in the IPA but cannot prove installation, Spotify login, or playback on your iPhone.
