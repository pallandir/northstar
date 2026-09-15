# AMO listing

Reference copy for submitting Northstar to addons.mozilla.org. Build the upload
artifact with `npm run package:firefox`, which produces
`extension/firefox/web-ext-artifacts/northstar-firefox-<version>.zip`.

AMO requires a source-code package for this add-on because the shipped code is
bundled and minified by Vite. Produce it with `npm run source --workspace @northstar/firefox`,
which archives the tagged commit directly from git so it cannot drift from what is submitted.

## Summary (250 chars max)

Point at anything on your frontend, leave a comment, and let your local AI coding
assistant fix it in the real source. Everything stays on your machine.

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
From there you can point at any element and open one popover with three things you
can do: leave a comment, edit its text, or recolor it, and see the change live
before you send it. Every note is pinned to the element it belongs to, with a
stable reference so nothing gets lost in translation.

Northstar reads the running page to identify the component and route an element
belongs to wherever the framework exposes that (React, Vue, Svelte, Angular), so
your assistant lands on the right file immediately instead of searching for it.

Your comments are delivered to a small companion server that runs on your own
machine. Any assistant that speaks the Model Context Protocol can read them and
act. It has been tested with Claude Code, and other MCP compatible tools should
work as well.

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
between spotting something on screen and getting it fixed in code.

## Notes for reviewers

- The extension talks only to a loopback MCP server the developer runs locally
  (`http://localhost`, `http://127.0.0.1`, `http://*.localhost`). It makes no other
  network requests and has no remote code.
- `activeTab` and `scripting` grant access only to the tab the user actively clicks
  the toolbar icon on; there is no standing content script and no automatic
  injection on page load.
- The main-world targeting probe (`scripting.executeScript({ world: "MAIN" })`)
  only reads DOM and framework debug state already present in the page; it writes
  nothing back to the page and has no extension API access from that world.
- `storage` / `unlimitedStorage` queue comments locally so commenting still works
  when the local server is not running.
- See [`PRIVACY.md`](https://github.com/pallandir/northstar/blob/main/PRIVACY.md)
  for the full data-handling description.

## Privacy policy URL

https://github.com/pallandir/northstar/blob/main/PRIVACY.md
