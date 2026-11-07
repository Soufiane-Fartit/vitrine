/**
 * Private, password-gated iOS Ad Hoc OTA installer for Vitrine.
 * Requires a private Cloudflare R2 bucket bound as IPA_BUCKET.
 * R2 never has public bucket access. No IPA URL is exposed without password.
 */
const TOKEN_TTL_SECONDS = 6 * 60 * 60;
const enc = new TextEncoder();

function headers(extra = {}) {
  return {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extra,
  };
}

function response(message, status = 200) {
  return new Response(message, {
    status, headers: headers({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: headers({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function equalBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

async function validPassword(supplied, expected) {
  if (typeof supplied !== "string" || supplied.length > 512) return false;
  return equalBytes(await digest(supplied), await digest(expected));
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signature(password, path, run, expiration) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, enc.encode(path + "\n" + run + "\n" + expiration)
  )));
}

function validRun(run) {
  return typeof run === "string" && /^[1-9][0-9]{0,19}$/.test(run);
}

async function signedUrl(origin, password, path, run, exp) {
  const mac = await signature(password, path, run, exp);
  const query = new URLSearchParams({ run, exp: String(exp), sig: mac });
  return origin + path + "?" + query.toString();
}

async function authorizeUrl(url, env) {
  const run = url.searchParams.get("run");
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  if (!validRun(run) || !/^[0-9]{10,11}$/.test(exp || "") ||
      !/^[a-f0-9]{64}$/.test(sig || "")) return null;
  const deadline = Number(exp);
  if (deadline < Math.floor(Date.now() / 1000) || deadline > Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS) return null;
  const expected = await signature(env.OTA_PASSWORD, url.pathname, run, deadline);
  if (!equalBytes(enc.encode(sig), enc.encode(expected))) return null;
  return run;
}

async function getMetadata(env, run) {
  const key = run === "latest" ? "latest.json" : "releases/" + run + "/metadata.json";
  const obj = await env.IPA_BUCKET.get(key);
  if (!obj) return null;
  const info = await obj.json();
  if (!info || !validRun(String(info.run)) || !/^[a-zA-Z0-9.-]{3,200}$/.test(info.bundle_id || "") ||
      typeof info.version !== "string" || info.version.length > 80 ||
      !info.version) return null;
  if (run !== "latest" && String(info.run) !== run) return null;
  return { run: String(info.run), bundleId: info.bundle_id, version: info.version };
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function plist(ipaUrl, info) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict><key>items</key><array><dict>',
    '<key>assets</key><array><dict><key>kind</key><string>software-package</string>',
    '<key>url</key><string>' + xmlEscape(ipaUrl) + '</string></dict></array>',
    '<key>metadata</key><dict>',
    '<key>bundle-identifier</key><string>' + xmlEscape(info.bundleId) + '</string>',
    '<key>bundle-version</key><string>' + xmlEscape(info.version) + '</string>',
    '<key>kind</key><string>software</string>',
    '<key>title</key><string>Vitrine</string>',
    '</dict></dict></array></dict></plist>',
  ].join("\n");
}

function landing() {
  const body = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Install Vitrine</title>',
    '<style>body{background:#f7f7f9;color:#22252b;font:16px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;margin:0;padding:40px 20px}',
    'main{max-width:400px;margin:14vh auto}h1{font-size:30px;letter-spacing:-.8px}p{color:#666b76;line-height:1.5}',
    'label{display:block;margin:28px 0 8px;font-weight:600}input,button,a.button{box-sizing:border-box;display:block;width:100%;font:inherit;border-radius:12px;padding:15px}',
    'input{border:1px solid #cbced6;background:white}button,a.button{margin-top:16px;border:0;background:#5947b8;color:white;text-align:center;text-decoration:none;font-weight:600;cursor:pointer}',
    '#message{min-height:24px;font-size:14px;margin-top:16px}a.button{display:none}</style></head><body><main>',
    '<h1>Vitrine</h1><p>Private wireless installation for your registered iPhone. Open this page in Safari.</p>',
    '<form id="gate"><label for="pw">Installation password</label><input id="pw" type="password" minlength="12" autocomplete="off" required>',
    '<button type="submit">Prepare installation</button></form>',
    '<p id="message" role="status" aria-live="polite"></p><a id="install" class="button">Install Vitrine</a>',
    '<p>Links expire after 6 hours. Your device must be included in the Ad Hoc provisioning profile.</p>',
    '<script>',
    'const form=document.getElementById("gate"),message=document.getElementById("message"),install=document.getElementById("install");',
    'form.addEventListener("submit",async(e)=>{e.preventDefault();install.style.display="none";message.textContent="Preparing link…";',
    'try{const res=await fetch("/link",{method:"POST",headers:{"Content-Type":"application/json"},',
    'body:JSON.stringify({password:document.getElementById("pw").value})});',
    'const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not prepare installation");',
    'install.href=data.install_url;install.style.display="block";message.textContent="Ready. Tap Install Vitrine below.";',
    '}catch(err){message.textContent=err.message;}finally{document.getElementById("pw").value="";}});',
    '</script></main></body></html>',
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: headers({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    }),
  });
}

async function link(req, env, origin) {
  const size = Number(req.headers.get("content-length") || 0);
  if (size > 2048) return json({ error: "Request too large" }, 413);
  let payload;
  try { payload = await req.json(); } catch (_) { return json({ error: "Invalid request" }, 400); }
  if (!await validPassword(payload && payload.password, env.OTA_PASSWORD)) {
    return json({ error: "Invalid password" }, 403);
  }
  const info = await getMetadata(env, "latest");
  if (!info) return json({ error: "No Ad Hoc OTA release published yet" }, 404);
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const manifest = await signedUrl(origin, env.OTA_PASSWORD, "/manifest", info.run, exp);
  return json({
    install_url: "itms-services://?action=download-manifest&url=" + encodeURIComponent(manifest),
    expires_at: new Date(exp * 1000).toISOString(),
  });
}

async function manifest(req, env, origin, run) {
  const info = await getMetadata(env, run);
  if (!info) return response("Release not found", 404);
  const exp = Number(new URL(req.url).searchParams.get("exp"));
  const ipa = await signedUrl(origin, env.OTA_PASSWORD, "/ipa", run, exp);
  const payload = plist(ipa, info);
  return new Response(req.method === "HEAD" ? null : payload, {
    status: 200,
    headers: headers({
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Length": String(enc.encode(payload).byteLength),
    }),
  });
}

async function ipa(req, env, run) {
  const key = "releases/" + run + "/vitrine.ipa";
  if (req.method === "HEAD") {
    const head = await env.IPA_BUCKET.head(key);
    if (!head) return response("IPA not found", 404);
    return new Response(null, {
      status: 200, headers: headers({
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(head.size),
      }),
    });
  }

  const range = req.headers.get("range");
  const options = range ? { range: req.headers } : undefined;
  const obj = await env.IPA_BUCKET.get(key, options);
  if (!obj || !obj.body) return response("IPA not found", 404);
  const h = headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": 'attachment; filename="vitrine.ipa"',
    "Accept-Ranges": "bytes",
  });
  let status = 200;
  if (range && obj.range) {
    status = 206;
    h["Content-Range"] = "bytes " + obj.range.offset + "-" +
      (obj.range.offset + obj.range.length - 1) + "/" + obj.size;
    h["Content-Length"] = String(obj.range.length);
  } else {
    h["Content-Length"] = String(obj.size);
  }
  return new Response(obj.body, { status, headers: h });
}

export default {
  async fetch(req, env) {
    if (!env || !env.IPA_BUCKET || !env.OTA_PASSWORD || env.OTA_PASSWORD.length < 12) {
      return response("OTA installer not configured", 503);
    }
    const url = new URL(req.url);
    if (url.pathname === "/" && req.method === "GET") return landing();
    if (url.pathname === "/link" && req.method === "POST") return link(req, env, url.origin);
    if ((url.pathname === "/manifest" || url.pathname === "/ipa") &&
        (req.method === "GET" || req.method === "HEAD")) {
      const run = await authorizeUrl(url, env);
      if (!run) return response("Expired or invalid installation link", 403);
      return url.pathname === "/manifest" ?
        manifest(req, env, url.origin, run) : ipa(req, env, run);
    }
    return response("Not found", 404);
  },
};
