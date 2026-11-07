# Wireless (OTA) installation — no iPhone-to-PC cable

Vitrine can install directly from iPhone Safari using a private Cloudflare Worker + R2 bucket. After the one-time setup, each successful [Ad Hoc GitHub Actions build](https://github.com/Soufiane-Fartit/vitrine/actions/workflows/vitrine-adhoc.yml) uploads the signed IPA privately. On your phone, open your Worker page, enter the password, and tap **Install Vitrine**. You do **not** download/extract artifacts or connect a phone to a computer.

This is **optional**. Without R2 configuration, the original encrypted `vitrine-adhoc-encrypted` GitHub artifact keeps working.

## Why R2 instead of Supabase / a public GitHub Page?

The IPA is ~137 MB. Supabase Free has a **50 MB per-file maximum**. Publishing an Ad Hoc IPA publicly can disclose the registered iPhones' UDIDs inside embedded provisioning profiles. R2 Standard offers a 10 GB-month free allowance, without egress fees, although R2 activation can require adding a payment method and usage beyond the free quota is billable. A **private** R2 bucket and password-protected Cloudflare Worker avoid publicly publishing the IPA or its installation link.

## One-time setup (Cloudflare)

1. Create / activate [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2). Create a **private R2 bucket** named exactly `vitrine-ota`, using **Standard** storage class. **Do not enable public bucket access or r2.dev.**
2. Under R2 > **Manage R2 API Tokens**, create an API token with **Object Read & Write** restricted to the `vitrine-ota` bucket only. Record the R2 **Account ID**, **Access Key ID**, and **Secret Access Key**. The API token is used only by the upload workflow, not by the iPhone.
3. Add three **Actions secrets** to [Vitrine's GitHub repository secrets](https://github.com/Soufiane-Fartit/vitrine/settings/secrets/actions):

   | Secret | Value |
   | --- | --- |
   | `R2_ACCOUNT_ID` | Your 32-character Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | R2 token's access key ID |
   | `R2_SECRET_ACCESS_KEY` | R2 token's secret access key |

4. On a PC (one time only), install Node.js, then from this repository run:

   ```bash
   cd ota/worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put OTA_PASSWORD
   ```

   Enter a **random password of at least 12 characters** at the last prompt. You may reuse your `IPA_ARCHIVE_PASSWORD` for convenience, but a separate strong password is preferable. **Never paste it into the code or commit it.** Keep the Worker `OTA_PASSWORD` secure; it protects access to signed installation links. Cloudflare will give you a `https://vitrine-ota-installer.<your-subdomain>.workers.dev` URL. Save/bookmark that URL in iPhone Safari. You don't need to buy or connect a domain.

5. On GitHub, manually **run Vitrine - sign prebuilt Ad Hoc IPA** again on `main`. The workflow checks the signed IPA, uploads it to the private R2 bucket, then still produces the encrypted artifact as a backup.

## Install from iPhone (no cable, no PC)

1. Open the `https://vitrine-ota-installer.<your-subdomain>.workers.dev` site **in Safari on your registered iPhone**.
2. Enter `OTA_PASSWORD` and press **Prepare installation**.
3. Tap **Install Vitrine** on the next screen; approve the iOS installation prompt.
4. iOS downloads the IPA through HTTPS and installs it. Your device must be registered in the Apple Ad Hoc profiles.

The page does not expose the private IPA directly. It generates six-hour, unguessable signed links to a temporary manifest and to the IPA. If the link expires, simply sign in again to generate a fresh one.

## Troubleshooting

- **`OTA installer not configured`:** Worker secret `OTA_PASSWORD` isn't set or is shorter than 12 characters, or the R2 binding isn't configured.
- **`No Ad Hoc OTA release published yet`:** Run the workflow after adding all three R2 secrets. Previous successful runs were not uploaded automatically.
- **`Missing OTA Actions secret`:** One or two of the R2 secrets were configured but not all three.
- **`Expired or invalid installation link`:** Return to the Worker homepage and generate a new link.
- **iPhone shows installation failed:** Confirm the device UDID is in all required Ad Hoc profiles, check signature and required entitlements, verify iPhone network access and allow installation time. An Actions run succeeding doesn't guarantee iOS will install a modified Spotify binary.
- **Cloudflare charges / retention:** R2 is usage-based. Configure an R2 lifecycle rule to delete stale `releases/` objects after 30 days, or remove older objects manually. If you remove the currently designated `latest.json` release, rerun the GitHub workflow to publish a new one.
- **Privacy:** Keep the bucket private, and avoid sharing the password or generated six-hour OTA links. The link itself grants temporary access to the signed binary (and its embedded provisioning device identifiers).

## Design notes

- Worker source: [`ota/worker/src/index.js`](ota/worker/src/index.js)
- Cloudflare Worker config: [`ota/worker/wrangler.json`](ota/worker/wrangler.json)
- R2 uploader: [`ota/publish_r2.py`](ota/publish_r2.py)
- Automated tests: `cd ota/worker && npm test` (no install required).
- **No Cloudflare credentials are embedded in source control.** The uploader uses bucket-scoped R2 credentials from GitHub Actions secrets, and the Worker reads its login secret from Cloudflare Workers secrets.
- Signed OTA URLs are **not printed to public GitHub Actions logs or summaries**.
- The encrypted GitHub Actions artifact is still published for fallback and for offline installation.

## Notes on app signing and third-party code

The source IPA is an unofficial prebuilt Spotify modification, so it hasn't been independently audited. The GitHub workflow verifies its pinned checksum and matches six embedded Ad Hoc profiles, but this is not a substitute for a real-device installation test or a full code-signature validation. OTA changes only *delivery*, not what has been signed.
