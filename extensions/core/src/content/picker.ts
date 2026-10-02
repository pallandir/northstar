export interface PickerHost {
  isActive: () => boolean;
  isPicking: () => boolean;
  isModalOpen: () => boolean;
  ownsEvent: (event: Event) => boolean;
  hasInspector: () => boolean;
  closeInspector: () => void;
  hasSelection: () => boolean;
  clearSelection: () => void;
  onHover: (target: Element | null) => void;
  onPick: (target: Element) => void;
}

const SWALLOWED = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const;

export function installPicker(host: PickerHost): () => void {
  const onMove = (event: MouseEvent) => {
    if (!host.isPicking()) return;
    if (host.ownsEvent(event) || !(event.target instanceof Element)) {
      host.onHover(null);
      return;
    }
    host.onHover(event.target);
  };

  const onPointer = (event: Event) => {
    if (!host.isPicking() || host.ownsEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "click" || !(event.target instanceof Element)) return;
    host.onHover(null);
    if (host.hasInspector()) host.closeInspector();
    host.onPick(event.target);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !host.isActive() || host.isModalOpen()) return;
    if (host.hasInspector()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      host.closeInspector();
    } else if (host.hasSelection()) {
      host.clearSelection();
    }
  };

  window.addEventListener("mousemove", onMove, true);
  for (const type of SWALLOWED) window.addEventListener(type, onPointer, true);
  window.addEventListener("keydown", onKey, true);

  return () => {
    window.removeEventListener("mousemove", onMove, true);
    for (const type of SWALLOWED) window.removeEventListener(type, onPointer, true);
    window.removeEventListener("keydown", onKey, true);
  };
}
