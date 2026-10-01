import { PAIR_MESSAGE } from "@northstar/protocol";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function pairCsp(scriptNonce: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${scriptNonce}'`,
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function pairPage(options: {
  project: string;
  port: number;
  nonce: string;
  scriptNonce: string;
}): string {
  const { project, port, nonce, scriptNonce } = options;
  const config = JSON.stringify({ nonce, port, message: PAIR_MESSAGE });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Northstar</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#1c1b19;--muted:#6b675f;--line:#e4e0d8;--accent:#d97757;--accent-fg:#fff;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#f2efe8;--muted:#a49f94;--line:#2c2a26;--card:#1f1d1a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(26rem,calc(100vw - 2rem));background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.5rem}
h1{margin:0 0 .5rem;font-size:1.25rem;font-weight:600}
p{margin:0 0 1.25rem;color:var(--muted)}
strong{color:var(--fg)}
.row{display:flex;gap:.75rem;align-items:center}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:.6rem 1.1rem;background:var(--accent);color:var(--accent-fg);cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
button[disabled]{opacity:.6;cursor:default}
a{color:var(--muted);font-size:.9rem}
#status{margin:1rem 0 0;min-height:1.5rem;color:var(--fg)}
</style>
</head>
<body>
<main>
<h1>Connect the Northstar extension</h1>
<p>Allow your browser to send UI comments to the Northstar server for <strong>${escapeHtml(project)}</strong>.</p>
<div class="row"><button id="allow" type="button">Allow</button><a id="cancel" href="about:blank">Cancel</a></div>
<p id="status" role="status" aria-live="polite"></p>
</main>
<script nonce="${scriptNonce}">
const config = ${config};
const allow = document.getElementById("allow");
const status = document.getElementById("status");
document.getElementById("cancel").addEventListener("click", (event) => {
  event.preventDefault();
  window.close();
  status.textContent = "You can close this tab.";
});
allow.addEventListener("click", async () => {
  allow.disabled = true;
  try {
    const response = await fetch("/pair/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce: config.nonce }),
    });
    const body = await response.json();
    if (!response.ok) {
      status.textContent = body.error + " " + body.fix;
      allow.disabled = false;
      return;
    }
    window.postMessage({ type: config.message, token: body.token, port: config.port }, window.location.origin);
    status.textContent = "Connected. You can close this tab.";
  } catch (error) {
    status.textContent = "Could not reach the Northstar server. Restart your agent and try again.";
    allow.disabled = false;
  }
});
</script>
</body>
</html>
`;
}
