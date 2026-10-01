const SUPPORTED =
  typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";

let modalSupported: boolean | null = null;

function supportsModalSelector(): boolean {
  if (modalSupported === null) {
    try {
      document.createElement("dialog").matches(":modal");
      modalSupported = true;
    } catch {
      modalSupported = false;
    }
  }
  return modalSupported;
}

function openModal(): HTMLElement | null {
  const modalOnly = supportsModalSelector();
  for (const el of document.querySelectorAll<HTMLElement>("dialog[open]")) {
    // Without :modal support every open dialog counts. Re-parenting into a non-modal one is
    // harmless, the host stays in the top layer either way.
    if (!modalOnly || el.matches(":modal")) return el;
  }
  return null;
}

// The overlay host escapes page stacking by living in the top layer, not by out-bidding the page
// on z-index. The top layer stacks by promotion order, so anything the page promotes afterwards
// lands above us and we have to promote again.
export class TopLayer {
  private observer: MutationObserver | null = null;
  private frame = 0;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  private readonly onToggle = (event: Event) => {
    const target = event.target;
    if (target === this.host || !(target instanceof Element) || !target.hasAttribute("popover")) {
      return;
    }
    const state = (event as Event & { newState?: string }).newState;
    if (state !== undefined && state !== "open") return;
    this.schedule();
  };
  private readonly onMutate = (records: MutationRecord[]) => {
    const host = this.host;
    if (!host) return;
    if (!host.isConnected || records.some((record) => this.affectsTopLayer(record, host))) {
      this.schedule();
    }
  };

  private affectsTopLayer(record: MutationRecord, host: HTMLElement): boolean {
    if (record.type === "attributes") return record.target instanceof HTMLDialogElement;
    for (const node of record.removedNodes) {
      if (node === host || (node instanceof Element && node.contains(host))) return true;
    }
    for (const node of record.addedNodes) {
      if (!(node instanceof Element) || node === host) continue;
      if (node.matches("dialog, [popover]") || node.querySelector("dialog[open], [popover]")) {
        return true;
      }
    }
    return false;
  }

  attach(host: HTMLElement, shadow: ShadowRoot): void {
    this.host = host;
    this.shadow = shadow;
    if (SUPPORTED) host.setAttribute("popover", "manual");
    this.promote();

    document.addEventListener("toggle", this.onToggle, true);
    document.addEventListener("beforetoggle", this.onToggle, true);
    this.observer = new MutationObserver(this.onMutate);
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["open"],
      childList: true,
      subtree: true,
    });
  }

  detach(): void {
    document.removeEventListener("toggle", this.onToggle, true);
    document.removeEventListener("beforetoggle", this.onToggle, true);
    this.observer?.disconnect();
    this.observer = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const host = this.host;
    if (host && SUPPORTED) {
      try {
        host.hidePopover();
      } catch {
        // already hidden
      }
      host.removeAttribute("popover");
    }
    this.host = null;
    this.shadow = null;
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.promote();
    });
  }

  private promote(): void {
    const host = this.host;
    if (!host) return;

    // A modal dialog makes everything outside its subtree inert, top layer included, so the only
    // way to stay clickable over one is to become part of it.
    const modal = openModal();
    const parent = modal ?? document.documentElement;
    const restore = this.saveFocus();
    if (host.parentNode !== parent) parent.append(host);

    if (SUPPORTED) {
      try {
        host.hidePopover();
      } catch {
        // not currently showing
      }
      try {
        host.showPopover();
      } catch {
        // the host left the document between the check and the call
      }
    }
    restore();
  }

  private saveFocus(): () => void {
    const active = this.shadow?.activeElement;
    if (!(active instanceof HTMLElement)) return () => {};
    const editable =
      active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? active : null;
    const start = editable?.selectionStart ?? null;
    const end = editable?.selectionEnd ?? null;
    return () => {
      if (!active.isConnected) return;
      active.focus({ preventScroll: true });
      if (editable && start !== null && end !== null) {
        try {
          editable.setSelectionRange(start, end);
        } catch {
          // the field no longer supports a selection range
        }
      }
    };
  }
}
