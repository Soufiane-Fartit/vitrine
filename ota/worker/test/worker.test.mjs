import test from "node:test";
import assert from "node:assert/strict";
import installer from "../src/index.js";

const base = "https://vitrine-ota-installer.example.workers.dev";
const password = "the-key-must-be-at-least-12-characters";

function mockBucket(present = true) {
  const info = { run: "42393239407", bundle_id: "com.soufianefartit.vitrine", version: "9.1.90" };
  return {
    async get(key, opts) {
      if (key === "latest.json" || key === "releases/42393239407/metadata.json") {
        return present ? { json: async () => info } : null;
      }
      if (key === "releases/42393239407/vitrine.ipa") {
        if (opts?.range) return {
          size: 10, range: { offset: 2, length: 4 }, body: new Blob(["3456"]).stream(),
        };
        return { size: 10, body: new Blob(["1234567890"]).stream() };
      }
      return null;
    },
    async head(key) {
      return key === "releases/42393239407/vitrine.ipa" ? { size: 10 } : null;
    },
  };
}

const env = () => ({ OTA_PASSWORD: password, IPA_BUCKET: mockBucket() });

async function prepare(e = env()) {
  return installer.fetch(new Request(base + "/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  }), e);
}

test("landing has protected password form and never exposes an IPA", async () => {
  const resp = await installer.fetch(new Request(base + "/"), env());
  const html = await resp.text();
  assert.equal(resp.status, 200);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /releases\/[0-9]+\/vitrine\.ipa/);
  assert.match(resp.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("wrong password cannot create a link", async () => {
  const resp = await installer.fetch(new Request(base + "/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  }), env());
  assert.equal(resp.status, 403);
});

test("missing release reports 404 after successful authorization", async () => {
  const resp = await prepare({ OTA_PASSWORD: password, IPA_BUCKET: mockBucket(false) });
  assert.equal(resp.status, 404);
});

test("short-lived signed OTA manifest and IPA work without user authorization headers", async () => {
  const e = env();
  const resp = await prepare(e);
  assert.equal(resp.status, 200);
  const link = (await resp.json()).install_url;
  assert.ok(link.startsWith("itms-services://?action=download-manifest&url="));
  const manifestUrl = new URL(link).searchParams.get("url");
  const manifest = await installer.fetch(new Request(manifestUrl), e);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get("content-type"), /xml/);
  const xml = await manifest.text();
  assert.match(xml, /com\.soufianefartit\.vitrine/);
  assert.match(xml, /bundle-version<\/key><string>9\.1\.90/);
  assert.match(xml, /&amp;exp=/);
  const ipaUrl = xml.match(/<key>url<\/key><string>([^<]+)<\/string>/)[1]
    .replace(/&amp;/g, "&");
  const ipa = await installer.fetch(new Request(ipaUrl), e);
  assert.equal(ipa.status, 200);
  assert.equal(await ipa.text(), "1234567890");
  assert.equal(ipa.headers.get("accept-ranges"), "bytes");

  const partial = await installer.fetch(new Request(ipaUrl, {
    headers: { Range: "bytes=2-5" },
  }), e);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await partial.text(), "3456");

  const head = await installer.fetch(new Request(ipaUrl, { method: "HEAD" }), e);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");

  const expired = new URL(ipaUrl);
  expired.searchParams.set("exp", "1700000000");
  assert.equal((await installer.fetch(new Request(expired), e)).status, 403);
  const tampered = new URL(ipaUrl);
  tampered.searchParams.set("run", "12345");
  assert.equal((await installer.fetch(new Request(tampered), e)).status, 403);
});

test("unconfigured worker cannot serve installer", async () => {
  const resp = await installer.fetch(new Request(base + "/"), {
    OTA_PASSWORD: "short",
    IPA_BUCKET: mockBucket(),
  });
  assert.equal(resp.status, 503);
});
