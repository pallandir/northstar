import { browser } from "../lib/browser.js";
import { captureElement, captureTarget } from "../lib/fingerprint.js";
import { buildLocate, capturePage, captureSemantics, deriveIntent } from "../lib/locate.js";
import { resolveSource } from "../lib/source-map.js";
import { isLocalUrl } from "../lib/transport.js";
import { resolveXPath } from "../lib/xpath.js";
import type { Message, PinModel, QueueStatus, Response, SendOutcome } from "../messages.js";
import { onNavigate, probeElement } from "../probe/client.js";
import type { ProbeResult } from "../probe/protocol.js";
import type { DraftRequest, Rect } from "../types.js";
import { Drawer, type DrawerContext } from "./drawer.js";
import { downloadHandoff } from "./handoff.js";
import type { InspectorSubmission } from "./inspector.js";
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

const STATUS_POLL_MS = 5000;
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
  pollTimer: number | null;
  stopNavigateListener: (() => void) | null;
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
    pollTimer: null,
    stopNavigateListener: null,
  };
  const mode = pageMode();

  const surface = new Surface();
  let toolbar: Toolbar | null = null;
  let drawer: Drawer | null = null;
  let disposed = false;

  const alive = () => !disposed && Boolean(browser.runtime?.id);

  function teardown(): void {
    if (disposed) return;
    setActive(false);
    disposed = true;
    removePicker();
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {}
  }

  function usable(): boolean {
    if (alive()) return true;
    teardown();
    return false;
  }

  async function send(message: Message): Promise<Response> {
    if (!usable()) return { ok: false, error: "extension context invalidated" };
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err) {
      usable();
      return { ok: false, error: (err as Error).message };
    }
  }

  const onMessage = (message: Message) => {
    if (message.type === "set-active") setActive(message.on);
  };
  browser.runtime.onMessage.addListener(onMessage);

  void send({ type: "sync-active" }).then((res) => {
    if (res.ok && res.active) setActive(true);
  });

  function setActive(on: boolean): void {
    if (on === st.active) return;
    st.gen++;
    st.active = on;
    if (on) {
      st.picking = true;
      toolbar = new Toolbar(surface, {
        onComments: toggleDrawer,
        onSend: () => void handleSend(),
        onHandoff: handleHandoff,
        onReset: handleReset,
        onTogglePick: () => setPicking(!st.picking),
        onDeactivate: () => void send({ type: "deactivate" }),
      });
      drawer = new Drawer(surface, {
        onEdit: (cid, text, opts) => void editComment(cid, text, opts),
        onRemove: (key) => void removePin(key),
        onClose: toggleDrawer,
        onRevert: (key) => void handleRevert(key),
        onHoverComment: (key) => surface.focusPin(key),
        onDismissNotice: (id) => void handleDismissNotice(id),
      });
      void refresh();
      startPolling();
      st.stopNavigateListener = onNavigate(() => void refresh());
    } else {
      stopPolling();
      st.stopNavigateListener?.();
      st.stopNavigateListener = null;
      surface.closeInspector();
      surface.setSelection(null);
      surface.highlightHover(null);
      surface.setPins(
        [],
        () => {},
        () => {},
      );
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
    isActive: () => usable() && st.active,
    isPicking: () => usable() && st.active && st.picking && !st.modalOpen,
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
    surface.setSelection(el);
    render();

    const probe = probeElement(el);
    const release = () => {
      if (surface.selected() === el) surface.setSelection(null);
    };

    surface.showInspector(
      el,
      (result) => {
        release();
        void record(el, result, probe);
      },
      release,
    );
  }

  function toggleDrawer(): void {
    st.drawerOpen = !st.drawerOpen;
    drawer?.setOpen(st.drawerOpen, st.lastPins, drawerCtx(), st.lastStatus?.notices ?? []);
    render();
  }

  function drawerCtx(): DrawerContext {
    return { mode, connected: Boolean(st.lastStatus?.serverReachable) };
  }

  async function record(
    el: Element,
    payload: InspectorSubmission,
    probe: Promise<ProbeResult | null>,
  ): Promise<void> {
    const { operator, elementText } = captureElement(el);

    const r = el.getBoundingClientRect();
    const rect: Rect = { x: r.x, y: r.y, w: r.width, h: r.height };

    const attachScreenshot = payload.attachScreenshot === true;
    let screenshot: string | null = null;
    if (attachScreenshot) {
      screenshot = await captureHidden(rect);
    }

    const probeResult = await probe;

    const source = resolveSource(el) ?? probeResult?.source ?? null;
    const component = probeResult?.component ?? null;
    const route = probeResult?.route ?? null;
    const target = captureTarget(el, rect);
    const element = captureSemantics(el, target);

    const draft: DraftRequest = {
      comment: payload.comment,
      operation: payload.operation,
      operator,
      url: location.href,
      metadata: {
        page: location.pathname,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        elementText,
      },
      source,
      component,
      route,
      target,
      screenshotDataUrl: screenshot,
      attachScreenshot,
      planFirst: payload.planFirst ?? false,
      schemaVersion: 2,
      intent: deriveIntent(payload.operation),
      locate: buildLocate({ source, component, route, target, semantics: element, elementText }),
      page: capturePage(),
      element,
    };
    await send({ type: "save-request", draft });
    await refresh();
  }

  async function captureRegion(rect: Rect): Promise<string | null> {
    const res = await send({ type: "capture-region", rect, dpr: window.devicePixelRatio });
    return res.ok && res.dataUrl ? res.dataUrl : null;
  }

  async function captureHidden(rect: Rect): Promise<string | null> {
    surface.setHidden(true);
    await nextPaint();
    const shot = await captureRegion(rect);
    surface.setHidden(false);
    return shot;
  }

  async function handleDismissNotice(commentId: string): Promise<void> {
    await send({ type: "dismiss-notice", commentId });
    await refresh();
  }

  function startPolling(): void {
    if (st.pollTimer !== null) return;
    st.pollTimer = window.setInterval(() => void pollStatus(), STATUS_POLL_MS);
  }

  function stopPolling(): void {
    if (st.pollTimer === null) return;
    window.clearInterval(st.pollTimer);
    st.pollTimer = null;
  }

  async function pollStatus(): Promise<void> {
    if (!usable() || !st.active) return;
    const gen = st.gen;
    const res = await send({ type: "queue-status" });
    if (!st.active || gen !== st.gen) return;
    const next = res.ok ? (res.status ?? null) : null;
    if (!statusChanged(st.lastStatus, next)) return;
    await refresh();
  }

  async function handleSend(): Promise<void> {
    if (st.sending || !st.lastStatus?.serverReachable) return;
    st.sending = true;
    toolbar?.setSending(true);
    try {
      const res = await send({ type: "flush" });
      st.lastSend = res.ok ? (res.send ?? null) : null;
      if (st.lastSend) toolbar?.flashSent(st.lastSend);
      await refresh();
    } finally {
      st.sending = false;
      toolbar?.setSending(false);
    }
  }

  async function handleHandoff(): Promise<void> {
    const res = await send({ type: "get-comments", url: location.href });
    if (res.ok && res.comments && res.comments.length > 0) downloadHandoff(res.comments);
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
      if (el instanceof Element) {
        const r = el.getBoundingClientRect();
        screenshotDataUrl = await captureHidden({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
    } else if (opts?.attachScreenshot === false) {
      screenshotDataUrl = null;
    }
    await send({
      type: "update-comment",
      cid,
      text,
      planFirst: opts?.planFirst,
      screenshotDataUrl,
    });
    await refresh();
  }

  async function handleReset(): Promise<void> {
    const total = st.lastPins.length;
    if (total === 0) return;

    st.modalOpen = true;
    updateCursor();
    surface.showModal({
      title: "Delete all comments?",
      body: "This permanently removes all comments and their screenshots from every page. This cannot be undone.",
      actions: [
        { label: "Cancel", variant: "ghost", onClick: () => {} },
        {
          label: "Delete all comments",
          variant: "danger",
          onClick: () => void clearEverything(),
        },
      ],
      onDismiss: () => {
        st.modalOpen = false;
        updateCursor();
      },
    });
  }

  async function clearEverything(): Promise<void> {
    await send({ type: "clear-all" });
    await refresh();
  }

  async function refresh(): Promise<void> {
    const gen = st.gen;
    const [pinsRes, statusRes] = await Promise.all([
      send({ type: "page-comments", url: location.href }),
      send({ type: "queue-status" }),
    ]);
    if (!st.active || gen !== st.gen) return;
    st.lastPins = pinsRes.ok && pinsRes.pins ? pinsRes.pins : [];
    st.lastStatus = statusRes.ok ? (statusRes.status ?? null) : null;
    surface.setPins(
      st.lastPins,
      (key) => void removePin(key),
      (key, text, opts) => void editComment(key, text, opts),
    );
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
    await send({ type: "remove-comment", cid });
    await refresh();
  }

  async function handleRevert(key: string): Promise<void> {
    const note = "Revert the previous change you made for this comment.";
    await send({ type: "reopen-comment", id: key, note });
    await refresh();
  }

  function render(): void {
    const activeCount = st.lastPins.filter((p) => p.status !== "resolved").length;
    const notices = st.lastStatus?.notices ?? [];
    toolbar?.render({
      mode,
      count: activeCount,
      noticeCount: notices.length,
      status: st.lastStatus,
      drawerOpen: st.drawerOpen,
      lastSend: st.lastSend,
      picking: st.picking,
    });
    drawer?.render(st.lastPins, drawerCtx(), notices);
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

function statusChanged(a: QueueStatus | null, b: QueueStatus | null): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  return (
    a.serverReachable !== b.serverReachable ||
    a.port !== b.port ||
    a.queued !== b.queued ||
    a.root !== b.root ||
    a.version !== b.version ||
    a.terminal?.available !== b.terminal?.available ||
    noticesKey(a.notices) !== noticesKey(b.notices)
  );
}

function noticesKey(notices: QueueStatus["notices"]): string {
  return notices?.map((n) => n.commentId).join(",") ?? "";
}

const existing = window.__northstar;
let running = false;
try {
  running = Boolean(existing?.alive());
} catch {}
if (!running) {
  try {
    existing?.teardown();
  } catch {}
  window.__northstar = init();
}
