# Privacy Policy

_Last updated: 2026-10-02_

Northstar (the "Northstar" browser extension and its companion MCP server) is a local
developer tool. This policy explains what it does and does not do with data.

## What Northstar does not do

- It does **not** collect, store, or transmit any personal data.
- It does **not** use analytics, tracking, advertising, or any third-party
  services.
- It does **not** send any data to the developer or to any remote server.

## What data Northstar handles, and where it stays

When you leave a comment on a frontend (a local dev server or a remote preview),
Northstar captures only the information needed to describe that change: your comment
text, a CSS selector and visible text for the element, the page URL and route, and,
where the page's own framework exposes it, the rendering component and a source
file location. A screenshot of the element, cropped to that element and not the
whole page, is captured only when you turn that toggle on for the comment; it is
off by default. It captures nothing until you activate it on a tab and pick an
element. This data:

- is stored locally in your browser's extension storage while queued, and
- is sent **only** to a helper program on your own computer, through the browser's
  Native Messaging, which writes it into your project's `.northstar/` folder.

None of it leaves your machine, even when the page itself is remote. The helper
answers only the Northstar extension, and a web page cannot reach it.

When you use **Send selection to AI** or the keyboard shortcut, the text you selected,
the page URL and the page title are saved as a comment in that same folder, in the
same way.

Sending a batch also makes Northstar write one line into the assistant session that
you started with `northstar run`. That line is a fixed constant: none of the data above
is ever written to the assistant, and Northstar only reads a rendered copy of that
session's screen, in memory, to check that the assistant is idle before writing. The
screen is not stored.

Northstar keeps a small amount of state in `~/.northstar/`: your settings, the
sessions that are running (agent, folder and process id), and logs of events with byte
counts. The logs never contain comment text, selected text or anything typed.

## Permissions

- `activeTab`, `scripting`: to inject the overlay into, and read the element you
  comment on from, only the single tab you activate by clicking the toolbar icon.
  The extension has no standing access to any site and runs on no page until you
  click; the access ends when the tab navigates. `scripting` also injects a small
  read-only script into the page's own main world to resolve the component and
  route an element belongs to; it never writes back to the page and has no
  extension API access from that world.
- host access to `localhost`/`127.0.0.1`/`*.localhost`: used only so the overlay can
  run on a local dev server you activated. The extension makes no network request
  with it, and it grants no ability to contact any other site. On Firefox this is
  opt-in and is requested the first time you activate the overlay.
- `nativeMessaging`: to reach the local Northstar helper described above. The helper
  only answers the Northstar extension and accepts a fixed list of actions.
- `contextMenus`: to add **Send selection to AI** to the right click menu and to
  offer the keyboard shortcut. They use `activeTab` for the page you used them on.
- `storage`, `unlimitedStorage`: to queue comments (including a screenshot when
  you asked for one) locally until your assistant's project is reachable.

## Contact

Questions about this policy: see the contact in `LICENSE.md` or open an issue at
https://github.com/pallandir/northstar/issues.
