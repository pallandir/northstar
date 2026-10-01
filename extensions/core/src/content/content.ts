import { pageKey, templateLine } from "@northstar/protocol";
import { browser } from "../lib/browser.js";
import { UserError } from "../lib/errors.js";
import { isLocalUrl } from "../lib/origins.js";
import { collectSourcePaths } from "../lib/source-map.js";
import { resolveXPath } from "../lib/xpath.js";
import type {
  Message,
  PinModel,
  ProblemNote,
  QueueStatus,
  Response,
  SendOutcome,
} from "../messages.js";
import { probeElement, settleProbe } from "../probe/client.js";
import type { ProbeOutcome } from "../probe/client.js";
import type { Rect } from "../types.js";
import { buildDraft } from "./draft.js";
import { Drawer, type DrawerContext } from "./drawer.js";
import { downloadHandoff } from "./handoff.js";
import type { InspectorSubmission } from "./inspector.js";
import { createPageTracker } from "./page-tracker.js";
import { installPicker } from "./picker.js";
import { Surface } from "./surface.js";
import { type Mode, Toolbar } from "./toolbar.js";

declare global {
  interface Window {
    __northstar?: Instance;
  }
}

interface Instance {
  alive: () => boolean;
  teardown: () => void;
}

type Answer = Extract<Response, { ok: true }>;

const REFRESH_POLL_MS = 5000;
const STYLE_ALLOWLIST = new Set(["color", "background-color", "border-color"]);

function pageMode(): Mode {
  return isLocalUrl(location.href) ? "local" : "remote";
}

interface ContentState {
  gen: number;
  active: boolean;
  picking: boolean;
  modalOpen: boolean;
  sending: boolean;
  drawerOpen: boolean;
  lastPins: PinModel[];
  lastStatus: QueueStatus | null;
  lastSend: SendOutcome | null;
  problem: ProblemNote | null;
  missing: Set<string>;
  pollTimer: number | null;
}

function problemOf(err: unknown): ProblemNote {
  if (err instanceof UserError) return { error: err.message, fix: err.fix };
  console.error("[northstar]", err);
  return {
    error: "Something went wrong inside Northstar.",
    fix: "Reload the page and try again. Details are in the console.",
  };
}

function field<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new UserError("Northstar sent an incomplete answer.", "Reload the page and try again.");
  }
  return value;
}

function init(): Instance {
  const st: ContentState = {
    gen: 0,
    active: false,
    picking: true,
    modalOpen: false,
    sending: false,
    drawerOpen: false,
    lastPins: [],
    lastStatus: null,
    lastSend: null,
    problem: null,
    missing: new Set(),
    pollTimer: null,
  };
  const mode = pageMode();

  const surface = new Surface();
  let toolbar: Toolbar | null = null;
  let drawer: Drawer | null = null;
  let disposed = false;
  let orphaned = false;

  const alive = () => !disposed && Boolean(browser.runtime?.id);

  const tracker = createPageTracker((key) => {
    st.gen++;
    st.lastPins = [];
    surface.setPins([], pinHandlers, key);
    render();
    void run(refresh);
  });

  function teardown(): void {
    if (disposed) return;
    setActive(false);
    disposed = true;
    tracker.stop();
    removePicker();
    browser.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener("pageshow", onPageShow);
  }

  function orphan(): void {
    if (orphaned) return;
    orphaned = true;
    stopPolling();
    removePicker();
    tracker.stop();
    document.documentElement.style.cursor = "";
    surface.showModal({
      title: "Northstar was updated",
      body: "This page is still running the old version. Reload it to keep commenting.",
      actions: [{ label: "Reload page", onClick: () => location.reload() }],
      onDismiss: () => {},
    });
  }

  async function call(message: Message): Promise<Answer> {
    if (!alive()) {
      orphan();
      throw new UserError("Northstar was updated or reloaded.", "Reload this page.");
    }
    let res: Response;
    try {
      res = (await browser.runtime.sendMessage(message)) as Response;
    } catch (err) {
      console.error("[northstar] background unreachable", err);
      throw new UserError(
        "Northstar could not reach its background service.",
        "Reload this page. If it keeps happening, reload the extension.",
      );
    }
    if (!res.ok) {
      throw new UserError(res.error, res.fix ?? "Reload the page and try again.");
    }
    return res;
  }

  async function run(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (err) {
      st.problem = problemOf(err);
      render();
    }
  }

  const onMessage = (message: Message) => {
    if (message.type === "set-active") setActive(message.on);
    if (message.type === "refresh") void run(refresh);
  };
  browser.runtime.onMessage.addListener(onMessage);

  async function syncActive(): Promise<void> {
    const res = await call({ type: "sync-active" });
    setActive(res.active === true);
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) void run(syncActive);
  };
  window.addEventListener("pageshow", onPageShow);

  syncActive().catch((err: unknown) =>
    console.error("[northstar] could not read the tab state", err),
  );

  const pinHandlers = {
    onRemove: (key: string) => void run(() => removePin(key)),
    onEdit: (
      key: string,
      text: string,
      opts?: { planFirst?: boolean; attachScreenshot?: boolean },
    ) => run(() => editComment(key, text, opts)),
  };

  surface.watchMissing((keys) => {
    st.missing = keys;
    render();
  });

  function setActive(on: boolean): void {
    if (on === st.active) return;
    st.gen++;
    st.active = on;
    if (on) {
      st.picking = true;
      st.problem = null;
      toolbar = new Toolbar(surface, {
        onComments: toggleDrawer,
        onSend: (sessionId) => void run(() => handleSend(sessionId)),
        onHandoff: () => void run(handleHandoff),
        onReset: handleReset,
        onTogglePick: () => setPicking(!st.picking),
        onDeactivate: () => void run(() => call({ type: "deactivate" }).then(() => undefined)),
        onChooseProject: (root) =>
          void run(async () => {
            await call({ type: "choose-project", root });
            await refresh();
          }),
        onQuickRun: (agent) => void run(() => handleQuickRun(agent)),
        onCopyLine: () => void run(handleCopyLine),
      });
      drawer = new Drawer(surface, {
        onEdit: (cid, text, opts) => void run(() => editComment(cid, text, opts)),
        onRemove: (key) => void run(() => removePin(key)),
        onClose: toggleDrawer,
        onRevert: (key) => void run(() => handleRevert(key)),
        onHoverComment: (key) => surface.focusPin(key),
        onDismissNotice: (id) => void run(() => handleDismissNotice(id)),
      });
      tracker.check();
      void run(refresh);
      startPolling();
    } else {
      stopPolling();
      surface.closeInspector();
      surface.setSelection(null);
      surface.highlightHover(null);
      surface.setPins([], pinHandlers, tracker.key());
      toolbar?.destroy();
      drawer?.destroy();
      toolbar = null;
      drawer = null;
      st.picking = true;
      st.modalOpen = false;
      st.sending = false;
      st.drawerOpen = false;
      st.lastPins = [];
      st.lastStatus = null;
      st.lastSend = null;
      st.problem = null;
      st.missing = new Set();
      surface.unmount();
    }
    updateCursor();
  }

  function setPicking(on: boolean): void {
    if (on === st.picking) return;
    st.picking = on;
    if (!on) {
      surface.highlightHover(null);
      surface.setSelection(null);
      surface.closeInspector();
    }
    updateCursor();
    render();
  }

  const removePicker = installPicker({
    isActive: () => alive() && st.active,
    isPicking: () => alive() && st.active && st.picking && !st.modalOpen,
    isModalOpen: () => st.modalOpen,
    ownsEvent: (event) => surface.ownsEvent(event),
    hasInspector: () => surface.hasInspector(),
    closeInspector: () => surface.closeInspector(),
    hasSelection: () => surface.selected() !== null,
    clearSelection: () => surface.setSelection(null),
    onHover: (target) => surface.highlightHover(target),
    onPick: pick,
  });

  function pick(el: Element): void {
    if (!st.active) return;
    const href = location.href;
    surface.setSelection(el);
    render();

    const probe = settleProbe(probeElement(el));
    const release = () => {
      if (surface.selected() === el) surface.setSelection(null);
    };

    surface.showInspector(
      el,
      async (result) => {
        await saveComment(el, result, probe, href);
        release();
      },
      release,
    );
  }

  function toggleDrawer(): void {
    st.drawerOpen = !st.drawerOpen;
    drawer?.setOpen(st.drawerOpen, pinsForView(), drawerCtx(), st.lastStatus?.notices ?? []);
    render();
  }

  function drawerCtx(): DrawerContext {
    return { mode, connected: Boolean(st.lastStatus?.serverReachable) };
  }

  function pinsForView(): PinModel[] {
    return st.lastPins.map((pin) => ({ ...pin, missing: st.missing.has(pin.key) }));
  }

  async function saveComment(
    el: Element,
    payload: InspectorSubmission,
    probe: Promise<ProbeOutcome>,
    href: string,
  ): Promise<void> {
    if (pageKey(location.href) !== pageKey(href)) {
      throw new UserError(
        "The page changed before the comment was saved.",
        "Pick the element again.",
      );
    }
    const outcome = await probe;
    if (!outcome.ok) {
      console.error("[northstar] probe failed", outcome.error);
      throw new UserError(
        "Northstar could not read this element.",
        "Reload the page and try again.",
      );
    }
    for (const failure of outcome.result.failures) console.warn("[northstar] probe", failure);

    let screenshot: string | null = null;
    if (payload.attachScreenshot) {
      const r = el.getBoundingClientRect();
      screenshot = await captureHidden({ x: r.x, y: r.y, w: r.width, h: r.height });
    }
    const draft = buildDraft(el, payload, href, outcome.result, screenshot);
    await call({ type: "save-request", draft });
    toolbar?.flashSaved();
    await refresh();
  }

  async function captureHidden(rect: Rect): Promise<string> {
    surface.setHidden(true);
    try {
      await nextPaint();
      const res = await call({ type: "capture-region", rect, dpr: window.devicePixelRatio });
      return field(res.dataUrl);
    } finally {
      surface.setHidden(false);
    }
  }

  async function handleDismissNotice(commentId: string): Promise<void> {
    await call({ type: "dismiss-notice", commentId });
    await refresh();
  }

  function startPolling(): void {
    if (st.pollTimer !== null) return;
    st.pollTimer = window.setInterval(() => void run(pollRefresh), REFRESH_POLL_MS);
  }

  function stopPolling(): void {
    if (st.pollTimer === null) return;
    window.clearInterval(st.pollTimer);
    st.pollTimer = null;
  }

  async function pollRefresh(): Promise<void> {
    if (!alive() || !st.active || document.hidden) return;
    if (tracker.check()) return;
    await refresh();
  }

  async function sendWith(message: Message): Promise<void> {
    if (st.sending) return;
    st.sending = true;
    toolbar?.setSending(true);
    try {
      const res = await call(message);
      st.lastSend = field(res.send);
      if (st.lastSend.woke?.delivered) toolbar?.flashSent(st.lastSend);
      await refresh();
    } finally {
      st.sending = false;
      toolbar?.setSending(false);
    }
  }

  function handleSend(sessionId?: string): Promise<void> {
    return sendWith({ type: "flush", sessionId });
  }

  function handleQuickRun(agent: string): Promise<void> {
    return sendWith({ type: "quick-run", agent });
  }

  async function handleCopyLine(): Promise<void> {
    const line = templateLine(st.lastStatus?.template ?? "resolve");
    try {
      await navigator.clipboard.writeText(line);
    } catch (err) {
      console.error("[northstar] clipboard write failed", err);
      throw new UserError(
        "Northstar could not copy the line to the clipboard.",
        "Click the page once to focus it and try again, or paste this line into your agent by hand.",
      );
    }
    toolbar?.flashCopied();
  }

  async function handleHandoff(): Promise<void> {
    const res = await call({ type: "get-comments", page: location.href });
    const comments = field(res.comments);
    if (comments.length === 0) {
      throw new UserError(
        "There are no unsent comments on this page to export.",
        "Add a comment first.",
      );
    }
    downloadHandoff(comments);
  }

  async function editComment(
    cid: string,
    text: string,
    opts?: { planFirst?: boolean; attachScreenshot?: boolean },
  ): Promise<void> {
    let screenshotDataUrl: string | null | undefined;
    if (opts?.attachScreenshot === true) {
      const pin = st.lastPins.find((p) => p.key === cid);
      const el = pin ? resolveXPath(pin.operator) : null;
      if (!(el instanceof Element)) {
        throw new UserError(
          "This element was not found on this page.",
          "Open the page where you left the comment.",
        );
      }
      const r = el.getBoundingClientRect();
      screenshotDataUrl = await captureHidden({ x: r.x, y: r.y, w: r.width, h: r.height });
    } else if (opts?.attachScreenshot === false) {
      screenshotDataUrl = null;
    }
    await call({
      type: "update-comment",
      cid,
      text,
      planFirst: opts?.planFirst,
      screenshotDataUrl,
    });
    await refresh();
  }

  function handleReset(): void {
    st.modalOpen = true;
    updateCursor();
    surface.showModal({
      title: "Delete all comments?",
      body: "This permanently removes every comment saved for this project, with its screenshots, and the unsent comments on this site. This cannot be undone.",
      actions: [
        { label: "Cancel", variant: "ghost", onClick: () => {} },
        {
          label: "Delete all comments",
          variant: "danger",
          onClick: () => void run(clearEverything),
        },
      ],
      onDismiss: () => {
        st.modalOpen = false;
        updateCursor();
      },
    });
  }

  async function clearEverything(): Promise<void> {
    await call({ type: "clear-all" });
    await refresh();
  }

  async function refresh(): Promise<void> {
    const gen = st.gen;
    const href = location.href;
    const key = pageKey(href);
    await call({ type: "report-sources", paths: collectSourcePaths() });
    const [pinsRes, statusRes] = await Promise.all([
      call({ type: "page-comments", page: href }),
      call({ type: "queue-status" }),
    ]);
    if (!st.active || gen !== st.gen || pageKey(location.href) !== key) return;
    st.lastPins = field(pinsRes.pins);
    st.lastStatus = field(statusRes.status);
    st.problem = pinsRes.problem ?? null;
    surface.setPins(st.lastPins, pinHandlers, key);
    render();
  }

  async function removePin(cid: string): Promise<void> {
    const pin = st.lastPins.find((p) => p.key === cid);
    if (pin && (pin.kind === "style" || pin.kind === "text") && pin.operation?.from != null) {
      const el = resolveXPath(pin.operator);
      if (el instanceof HTMLElement) {
        if (
          pin.kind === "style" &&
          pin.operation.property &&
          STYLE_ALLOWLIST.has(pin.operation.property)
        ) {
          el.style.setProperty(pin.operation.property, pin.operation.from);
        } else if (pin.kind === "text" && el.children.length === 0) {
          el.textContent = pin.operation.from;
        }
      }
    }
    await call({ type: "remove-comment", cid });
    await refresh();
  }

  async function handleRevert(key: string): Promise<void> {
    const note = "Revert the previous change you made for this comment.";
    await call({ type: "reopen-comment", id: key, note });
    await refresh();
  }

  function render(): void {
    const pins = pinsForView();
    const activeCount = pins.filter((p) => p.status !== "resolved").length;
    const notices = st.lastStatus?.notices ?? [];
    toolbar?.render({
      mode,
      count: activeCount,
      noticeCount: notices.length,
      status: st.lastStatus,
      drawerOpen: st.drawerOpen,
      lastSend: st.lastSend,
      picking: st.picking,
      problem: st.problem,
    });
    drawer?.render(pins, drawerCtx(), notices);
  }

  function updateCursor(): void {
    document.documentElement.style.cursor =
      st.active && st.picking && !st.modalOpen ? "crosshair" : "";
  }

  function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  return { alive, teardown };
}

const existing = window.__northstar;
if (!existing?.alive()) {
  existing?.teardown();
  window.__northstar = init();
}
