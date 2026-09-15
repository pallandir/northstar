import { browser } from "../lib/browser.js";
import { captureElement, captureTarget } from "../lib/fingerprint.js";
import { resolveSource } from "../lib/source-map.js";
import { isLocalUrl } from "../lib/transport.js";
import { resolveXPath } from "../lib/xpath.js";
import type { Message, PinModel, QueueStatus, Response, SendOutcome } from "../messages.js";
import { onNavigate, probeElement } from "../probe/client.js";
import type { ProbeResult } from "../probe/protocol.js";
import type { DraftRequest, Rect } from "../types.js";
import { Drawer, type DrawerContext } from "./drawer.js";
import { downloadHandoff } from "./handoff.js";
import type { InspectorSubmission, InspectorTarget } from "./inspector.js";
import { Surface } from "./surface.js";
import { type Mode, Toolbar } from "./toolbar.js";

declare global {
  interface Window {
    __northstarLoaded?: boolean;
  }
}

if (!window.__northstarLoaded) {
  window.__northstarLoaded = true;
  init();
}

const STATUS_POLL_MS = 5000;
const STYLE_ALLOWLIST = new Set(["color", "background-color", "border-color"]);

function pageMode(): Mode {
  return isLocalUrl(location.href) ? "local" : "remote";
}

interface ContentState {
  active: boolean;
  picking: boolean;
  interacting: boolean;
  drawerOpen: boolean;
  lastPins: PinModel[];
  lastStatus: QueueStatus | null;
  lastSend: SendOutcome | null;
  pollTimer: number | null;
  pendingProbe: Promise<ProbeResult | null> | null;
  stopNavigateListener: (() => void) | null;
}

function init(): void {
  const st: ContentState = {
    active: false,
    picking: true,
    interacting: false,
    drawerOpen: false,
    lastPins: [],
    lastStatus: null,
    lastSend: null,
    pollTimer: null,
    pendingProbe: null,
    stopNavigateListener: null,
  };
  const mode = pageMode();

  const surface = new Surface();
  let toolbar: Toolbar | null = null;
  let drawer: Drawer | null = null;

  async function send(message: Message): Promise<Response> {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  browser.runtime.onMessage.addListener((message: Message) => {
    if (message.type === "set-active") setActive(message.on);
  });

  void send({ type: "sync-active" }).then((res) => {
    if (res.ok && res.active) setActive(true);
  });

  function setActive(on: boolean): void {
    if (on === st.active) return;
    st.active = on;
    if (on) {
      st.picking = true;
      toolbar = new Toolbar(surface, {
        onComments: toggleDrawer,
        onSend: () => void handleSend(),
        onHandoff: handleHandoff,
        onReset: handleReset,
        onTogglePick: () => setPicking(!st.picking),
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
      // An SPA navigation (pushState/replaceState/popstate/hashchange) leaves the pin set and
      // the route stale otherwise, since nothing else observes it.
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
      st.interacting = false;
      st.drawerOpen = false;
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
      st.interacting = false;
    }
    updateCursor();
    render();
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!st.active || !st.picking || st.interacting) return;
      if (surface.ownsEvent(event)) {
        surface.highlightHover(null);
        return;
      }
      surface.highlightHover(event.target as Element);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!st.active || !st.picking || st.interacting || surface.ownsEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      surface.highlightHover(null);
      pick(event.target as Element);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (st.active && st.picking && !st.interacting && event.key === "Escape")
        surface.setSelection(null);
    },
    true,
  );

  // A click opens the one popover: Comment / Text / Colour tabs, a target header, and a shared
  // footer. The probe round trip starts immediately so its answer is usually already in by the
  // time the popover opens; the header upgrades from a bare tag to the resolved component once
  // it lands, rather than blocking the popover on it.
  function pick(el: Element): void {
    surface.setSelection(el);
    render();

    const probe = probeElement(el);
    st.pendingProbe = probe;

    st.interacting = true;
    updateCursor();

    const r = el.getBoundingClientRect();
    const rect: Rect = { x: r.x, y: r.y, w: r.width, h: r.height };
    const target = captureTarget(el, rect);
    const attributeSource = resolveSource(el);
    const initialInfo: InspectorTarget = {
      componentName: null,
      source: attributeSource,
      tag: target.tag,
      selector: target.selector,
    };

    const done = () => {
      st.interacting = false;
      updateCursor();
    };

    const handle = surface.showInspector(
      el,
      initialInfo,
      (result) => {
        done();
        void record(el, result);
      },
      done,
    );

    void probe.then((probeResult) => {
      if (!probeResult) return;
      handle.updateTarget({
        componentName: probeResult.component?.stack[0]?.name ?? null,
        source: attributeSource ?? probeResult.source,
        tag: target.tag,
        selector: target.selector,
      });
    });
  }

  function toggleDrawer(): void {
    st.drawerOpen = !st.drawerOpen;
    drawer?.setOpen(st.drawerOpen, st.lastPins, drawerCtx(), st.lastStatus?.notices ?? []);
    render();
  }

  function drawerCtx(): DrawerContext {
    return { mode, connected: Boolean(st.lastStatus?.serverReachable) };
  }

  async function record(el: Element, payload: InspectorSubmission): Promise<void> {
    const { operator, elementText } = captureElement(el);

    const r = el.getBoundingClientRect();
    const rect: Rect = { x: r.x, y: r.y, w: r.width, h: r.height };

    // Explicit consent only: undefined must not capture, and nothing forces a screenshot on the
    // user's behalf any more.
    const attachScreenshot = payload.attachScreenshot === true;
    let screenshot: string | null = null;
    if (attachScreenshot) {
      screenshot = await captureHidden(rect);
    }

    const probeResult = st.pendingProbe ? await st.pendingProbe : null;
    st.pendingProbe = null;

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
      source: resolveSource(el) ?? probeResult?.source ?? null,
      component: probeResult?.component ?? null,
      route: probeResult?.route ?? null,
      target: captureTarget(el, rect),
      screenshotDataUrl: screenshot,
      attachScreenshot,
      planFirst: payload.planFirst ?? false,
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
    if (!st.active) return;
    const res = await send({ type: "queue-status" });
    const next = res.ok ? (res.status ?? null) : null;
    if (!statusChanged(st.lastStatus, next)) return;
    await refresh();
  }

  async function handleSend(): Promise<void> {
    if (!st.lastStatus?.serverReachable) return;
    const res = await send({ type: "flush" });
    st.lastSend = res.ok ? (res.send ?? null) : null;
    if (st.lastSend) toolbar?.flashSent(st.lastSend);
    await refresh();
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

    st.interacting = true;
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
        st.interacting = false;
        updateCursor();
      },
    });
  }

  async function clearEverything(): Promise<void> {
    await send({ type: "clear-all" });
    await refresh();
  }

  async function refresh(): Promise<void> {
    const [pinsRes, statusRes] = await Promise.all([
      send({ type: "page-comments", url: location.href }),
      send({ type: "queue-status" }),
    ]);
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
      st.active && st.picking && !st.interacting ? "crosshair" : "";
  }

  function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }
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
