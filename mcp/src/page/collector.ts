export const COLLECTOR = String.raw`(() => {
  const MAX_NODES = 2500;
  const MAX_FOCUS_CHECKS = 40;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = document.documentElement;
  const body = document.body;
  const pageW = Math.max(root.scrollWidth, body ? body.scrollWidth : 0);
  const pageH = Math.max(root.scrollHeight, body ? body.scrollHeight : 0);
  const SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","META","LINK","HEAD","TITLE","BR","WBR","PATH","DEFS","G","CIRCLE","RECT","LINE","POLYGON","POLYLINE","ELLIPSE","USE","SYMBOL","CLIPPATH","LINEARGRADIENT","RADIALGRADIENT","STOP","TSPAN","MASK"]);
  const LANDMARKS = new Set(["HEADER","NAV","MAIN","FOOTER","SECTION","ASIDE","ARTICLE","FORM"]);
  const MEDIA = new Set(["IMG","SVG","VIDEO","CANVAS","PICTURE"]);
  const FIELDS = new Set(["INPUT","SELECT","TEXTAREA"]);
  const ROLE_INTERACTIVE = new Set(["button","link","tab","menuitem","checkbox","switch","radio","option","combobox","textbox","slider"]);

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const colourCache = new Map();
  const rgba = (value) => {
    const cached = colourCache.get(value);
    if (cached) return cached;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const alpha = d[3] / 255;
    const out = alpha === 0 ? [0, 0, 0, 0] : [Math.round(d[0] / alpha), Math.round(d[1] / alpha), Math.round(d[2] / alpha), Math.round(alpha * 100) / 100];
    colourCache.set(value, out);
    return out;
  };
  const over = (top, under) => {
    const a = top[3];
    return [Math.round(top[0] * a + under[0] * (1 - a)), Math.round(top[1] * a + under[1] * (1 - a)), Math.round(top[2] * a + under[2] * (1 - a)), 1];
  };

  const effectiveBackground = (el) => {
    const layers = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] === 1) break;
      node = node.parentElement;
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };

  const classesOf = (el) => Array.from(el.classList).filter((c) => /^[a-zA-Z][\w-]{0,24}$/.test(c) && !/\d{3,}/.test(c)).slice(0, 2);
  const step = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id) && document.querySelectorAll("#" + el.id).length === 1) return "#" + el.id;
    let part = tag + classesOf(el).map((c) => "." + c).join("");
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
    }
    return part;
  };
  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      const s = step(node);
      parts.unshift(s);
      if (s.startsWith("#") || node === body) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const visible = (el, cs, box) => cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && box.width > 0 && box.height > 0;

  const ownText = (el) => {
    let text = "";
    for (const child of el.childNodes) if (child.nodeType === 3) text += child.textContent;
    return text.replace(/\s+/g, " ").trim();
  };
  const fullText = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

  const nameOf = (el, tag) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return { name: aria.trim(), labelled: true };
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const text = by.split(/\s+/).map((id) => { const t = document.getElementById(id); return t ? fullText(t) : ""; }).join(" ").trim();
      if (text) return { name: text, labelled: true };
    }
    if (tag === "IMG") return { name: (el.getAttribute("alt") || "").trim(), labelled: el.hasAttribute("alt") };
    if (FIELDS.has(tag)) {
      const labels = el.labels ? Array.from(el.labels).map(fullText).join(" ").trim() : "";
      if (labels) return { name: labels, labelled: true };
      const title = el.getAttribute("title");
      if (title && title.trim()) return { name: title.trim(), labelled: true };
      return { name: (el.getAttribute("placeholder") || "").trim(), labelled: false };
    }
    const text = fullText(el).slice(0, 80);
    if (text) return { name: text, labelled: true };
    const title = el.getAttribute("title");
    if (title && title.trim()) return { name: title.trim(), labelled: true };
    const img = el.querySelector("img[alt]");
    if (img && img.getAttribute("alt").trim()) return { name: img.getAttribute("alt").trim(), labelled: true };
    const svgTitle = el.querySelector("svg title");
    if (svgTitle && svgTitle.textContent.trim()) return { name: svgTitle.textContent.trim(), labelled: true };
    return { name: "", labelled: false };
  };

  const isInteractive = (el, tag) => {
    if (tag === "A") return el.hasAttribute("href");
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY") return true;
    if (tag === "INPUT") return el.type !== "hidden";
    const role = el.getAttribute("role");
    if (role && ROLE_INTERACTIVE.has(role)) return true;
    const tab = el.getAttribute("tabindex");
    return tab !== null && Number(tab) >= 0;
  };

  const kindOf = (el, tag, interactive, text, surface) => {
    if (/^H[1-6]$/.test(tag) || el.getAttribute("role") === "heading") return "heading";
    if (tag === "BUTTON" || el.getAttribute("role") === "button" || (tag === "INPUT" && /^(button|submit|reset)$/.test(el.type))) return "button";
    if (tag === "A" && interactive) return "link";
    if (FIELDS.has(tag)) return "field";
    if (MEDIA.has(tag)) return "image";
    if (LANDMARKS.has(tag)) return "landmark";
    if (text) return "text";
    return surface ? "surface" : null;
  };

  const styleOf = (el, cs, parentBackground) => {
    const color = rgba(cs.color);
    const ownBackground = rgba(cs.backgroundColor);
    const bgImage = cs.backgroundImage;
    const backgroundImage = bgImage === "none" ? "none" : /gradient\(/.test(bgImage) ? "gradient" : "image";
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v) || 0);
    const side = (w, s, c) => parseFloat(w) > 0 && s !== "none" && s !== "hidden" && rgba(c)[3] > 0;
    const border = side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor) || side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor) || side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor) || side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor);
    const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    const gradientText = clip === "text" && (backgroundImage === "gradient" || cs.webkitTextFillColor === "rgba(0, 0, 0, 0)");
    return {
      color,
      background: effectiveBackground(el),
      ownBackground,
      backgroundImage,
      fontSize: parseFloat(cs.fontSize) || 0,
      fontWeight: Number(cs.fontWeight) || 400,
      fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      lineHeight: cs.lineHeight === "normal" ? null : parseFloat(cs.lineHeight) || null,
      textAlign: cs.textAlign,
      radius: Math.max.apply(null, radii),
      border,
      shadow: cs.boxShadow !== "none",
      gradientText,
      outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
      differsFromParent: ownBackground[3] > 0.02 && (Math.abs(ownBackground[0] - parentBackground[0]) + Math.abs(ownBackground[1] - parentBackground[1]) + Math.abs(ownBackground[2] - parentBackground[2]) > 12 || ownBackground[3] < 1),
    };
  };

  const nodes = [];
  const elements = [];
  const visit = (el, parentId, parentBackground) => {
    if (nodes.length >= MAX_NODES) return;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    const box = boxOf(el);
    let id = parentId;
    let nextBackground = parentBackground;
    if (visible(el, cs, box)) {
      const interactive = isInteractive(el, tag);
      const heading = /^H[1-6]$/.test(tag);
      const text = heading || interactive ? fullText(el).slice(0, 100) : ownText(el).slice(0, 100);
      const style = styleOf(el, cs, parentBackground);
      const surface = box.width * box.height > 400 && (style.differsFromParent || style.border || style.shadow || style.backgroundImage !== "none");
      const kind = kindOf(el, tag, interactive, text, surface);
      if (style.ownBackground[3] === 1) nextBackground = style.ownBackground;
      if (kind) {
        const naming = nameOf(el, tag);
        const level = heading ? Number(tag[1]) : el.getAttribute("role") === "heading" ? Number(el.getAttribute("aria-level")) || 2 : null;
        const children = Array.from(el.children).filter((c) => !SKIP.has(c.tagName.toUpperCase()) || c.tagName.toUpperCase() === "SVG");
        delete style.differsFromParent;
        nodes.push({
          id: nodes.length,
          parent: parentId,
          selector: selectorOf(el),
          tag: tag.toLowerCase(),
          role: el.getAttribute("role"),
          kind,
          level,
          text,
          name: naming.name,
          labelled: naming.labelled,
          hasAlt: tag === "IMG" ? el.hasAttribute("alt") : false,
          interactive,
          box,
          style,
          focus: "unchecked",
          svgOnly: children.length > 0 && children.every((c) => c.tagName.toUpperCase() === "SVG" || c.tagName.toUpperCase() === "IMG") && !ownText(el) && !fullText(el),
        });
        elements.push(el);
        id = nodes.length - 1;
      }
    }
    if (MEDIA.has(tag) && tag !== "PICTURE") return;
    for (const child of el.children) visit(child, id, nextBackground);
  };
  if (body) visit(body, null, effectiveBackground(body));

  let checked = 0;
  for (let i = 0; i < nodes.length && checked < MAX_FOCUS_CHECKS; i++) {
    const node = nodes[i];
    if (!node.interactive || node.box.y > pageH) continue;
    const el = elements[i];
    const before = getComputedStyle(el);
    const was = [before.outlineStyle, before.outlineWidth, before.boxShadow, before.borderTopColor, before.backgroundColor, before.textDecorationLine].join("|");
    el.focus({ preventScroll: true });
    const after = getComputedStyle(el);
    const now = [after.outlineStyle, after.outlineWidth, after.boxShadow, after.borderTopColor, after.backgroundColor, after.textDecorationLine].join("|");
    const ring = after.outlineStyle !== "none" && parseFloat(after.outlineWidth) > 0;
    node.focus = document.activeElement === el ? (ring || was !== now ? "visible" : "none") : "unchecked";
    el.blur();
    checked += 1;
  }

  const visibleChildren = (el) => Array.from(el.children).filter((c) => {
    if (SKIP.has(c.tagName.toUpperCase())) return false;
    const cs = getComputedStyle(c);
    const b = boxOf(c);
    return cs.display !== "none" && b.width > 0 && b.height > 0 && cs.position !== "fixed";
  });
  let host = body;
  for (let depth = 0; host && depth < 4; depth++) {
    const kids = visibleChildren(host);
    if (kids.length !== 1) break;
    host = kids[0];
  }
  let candidates = host ? visibleChildren(host) : [];
  candidates = candidates.flatMap((c) => {
    if (c.tagName.toUpperCase() !== "MAIN") return [c];
    const inner = visibleChildren(c);
    return inner.length > 1 ? inner : [c];
  });
  const blocks = candidates.map((c) => ({ selector: selectorOf(c), tag: c.tagName.toLowerCase(), box: boxOf(c) })).filter((b) => b.box.height >= 60);

  return {
    url: location.href,
    title: document.title,
    lang: root.lang || "",
    viewport: { width: vw, height: vh },
    document: { width: pageW, height: pageH },
    nodes,
    blocks,
  };
})()`;
