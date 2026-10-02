interface ColorPicker {
  el: HTMLElement;
  set(hex: string): void;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function hexToHsv(hex: string): Hsv {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const channel = (n: number) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function buildColorPicker(initial: string, onChange: (hex: string) => void): ColorPicker {
  let hsv = hexToHsv(initial);

  const el = document.createElement("div");
  el.className = "ns-cpick";

  const area = document.createElement("div");
  area.className = "ns-cpick-area";
  area.setAttribute("role", "slider");
  area.setAttribute("aria-label", "Saturation and brightness");
  area.tabIndex = 0;
  const thumb = document.createElement("div");
  thumb.className = "ns-cpick-thumb";
  area.append(thumb);

  const hue = document.createElement("input");
  hue.type = "range";
  hue.min = "0";
  hue.max = "360";
  hue.step = "1";
  hue.className = "ns-cpick-hue";
  hue.setAttribute("aria-label", "Hue");

  el.append(area, hue);

  function paint(): void {
    area.style.backgroundColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    thumb.style.left = `${hsv.s * 100}%`;
    thumb.style.top = `${(1 - hsv.v) * 100}%`;
    thumb.style.backgroundColor = hsvToHex(hsv);
    hue.value = String(Math.round(hsv.h));
  }

  function commit(): void {
    paint();
    onChange(hsvToHex(hsv));
  }

  function pick(event: PointerEvent): void {
    const rect = area.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    hsv = {
      ...hsv,
      s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
    commit();
  }

  area.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    area.setPointerCapture(event.pointerId);
    area.focus();
    pick(event);
  });
  area.addEventListener("pointermove", (event) => {
    if (area.hasPointerCapture(event.pointerId)) pick(event);
  });
  area.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    hsv = { ...hsv, s: clamp(hsv.s + move[0], 0, 1), v: clamp(hsv.v + move[1], 0, 1) };
    commit();
  });
  hue.addEventListener("input", () => {
    hsv = { ...hsv, h: Number(hue.value) };
    commit();
  });

  paint();

  return {
    el,
    set(hex) {
      const next = hexToHsv(hex);
      hsv = { h: next.s === 0 ? hsv.h : next.h, s: next.s, v: next.v };
      paint();
    },
  };
}
