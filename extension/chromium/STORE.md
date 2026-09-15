# Store listing

Reference copy for submitting the Northstar extension. Build the upload artifacts
with `npm run package --workspace @northstar/extension` and
`npm run package:firefox --workspace @northstar/extension`, which produce
`extension/northstar-chrome.zip` and `extension/northstar-firefox.zip`, each with
the manifest at the zip root.

## Single purpose

Northstar lets a developer leave real-time, element-anchored comments on a running
frontend and delivers them to an AI coding assistant on the same machine so it can
act on the real source files. The extension does one thing: it annotates a web UI
for that local assistant.

## Short description (132 chars max)

Point at anything on your frontend, leave a comment, and let your local AI coding
assistant fix it in the real source.

## Detailed description

Northstar turns the frontend you are building into something you can talk to
directly. Instead of writing tickets, taking screenshots, and describing what you
want changed, you click the element on the page and leave a comment right where the
problem is. That comment travels straight to your AI coding assistant, which then
works on the real source files in your project.

It feels like leaving notes in Figma, except the canvas is your actual running app
and the notes turn into code.

How it works

Click the Northstar icon to bring up a lightweight toolbar over the current tab.
From there you can point at any element and leave a comment, recolor its text or
background live to try out an idea, or edit its copy inline to see how new wording
reads. Every note is pinned to the element it belongs to, with a cropped screenshot
and a stable reference so nothing gets lost in translation.

When your dev build includes a framework inspector, each comment also carries the
exact file, line, and column the element came from, so your assistant lands on the
right code immediately instead of guessing.

Your comments are delivered to a small companion server that runs on your own
machine. Any assistant that speaks the Model Context Protocol can read them and act.
It has been tested with Claude Code, and other MCP compatible tools should work as
well.

Built for how developers actually work

Northstar stays out of the way until you ask for it. It does not run on any website
by default and has no standing access to the pages you visit. The moment you click
its icon, it works only on that one tab, and that access ends as soon as you
navigate away.

It works on localhost and on remote preview URLs alike. On localhost your comments
flow straight to your project. On a remote page they are kept safely on your device
so you can export them later, and nothing is ever sent to a remote server.

Privacy first, by design

Everything Northstar captures stays on your computer. There is no analytics, no
tracking, and no third party service involved. The only network connection it makes
is to a server running locally on your own machine at 127.0.0.1. Your comments,
screenshots, and source references never leave your device, even when the page you
are commenting on is hosted elsewhere.

Who it is for

Northstar is for developers, designers, and product teams who want to close the gap
between spotting something on screen and getting it fixed in code. If you have ever
wished you could just point at a button and say "make this the brand color" and have
it happen in the codebase, this is that.

## Permission justifications

- **activeTab**: grants access to the current tab only when the user clicks the
  toolbar button, so Northstar can read the element being commented on and capture a
  cropped screenshot of it. The extension has no access to any page before that
  click, and the access ends when the tab navigates.
- **scripting**: injects the commenting toolbar into that one active tab on demand,
  in place of a declared content script, so the extension does not run on pages
  automatically.
- **Host access (`http://localhost/*`, `http://127.0.0.1/*`, `http://*.localhost/*`)**:
  used only by the background service worker to reach the companion MCP server on
  loopback. This is not web-page access and does not let the extension contact any
  other site.
- **storage / unlimitedStorage**: queues comments (which include screenshots)
  locally so commenting works even when the assistant's server is not running, and
  drains automatically when it is.

## Data use disclosures

- Does not collect or transmit user data off the device.
- No analytics, tracking, or third-party services.
- All captured data (comment text, selector, screenshot, URL, source hint) stays on
  the user's machine and is sent only to `127.0.0.1`.

## Privacy policy URL

https://github.com/pallandir/northstar/blob/main/PRIVACY.md
