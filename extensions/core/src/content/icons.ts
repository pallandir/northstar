import iconChat from "@material-symbols/svg-400/rounded/chat.svg?raw";
import iconClose from "@material-symbols/svg-400/rounded/close.svg?raw";
import iconColors from "@material-symbols/svg-400/rounded/colors.svg?raw";
import iconDelete from "@material-symbols/svg-400/rounded/delete.svg?raw";
import iconDragIndicator from "@material-symbols/svg-400/rounded/drag_indicator.svg?raw";
import iconPointScan from "@material-symbols/svg-400/rounded/point_scan.svg?raw";
import iconRefresh from "@material-symbols/svg-400/rounded/refresh.svg?raw";
import iconResetColors from "@material-symbols/svg-400/rounded/reset_colors.svg?raw";
import iconSend from "@material-symbols/svg-400/rounded/send.svg?raw";
import iconShare from "@material-symbols/svg-400/rounded/share.svg?raw";
import iconTextFields from "@material-symbols/svg-400/rounded/text_fields.svg?raw";
import iconWarning from "@material-symbols/svg-400/rounded/warning.svg?raw";

const parser = new DOMParser();

export function icon(raw: string, className: string): SVGSVGElement {
  const doc = parser.parseFromString(raw, "image/svg+xml");
  const svg = doc.documentElement as unknown as SVGSVGElement;
  svg.setAttribute("class", className);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  return document.importNode(svg, true);
}

export {
  iconChat as ICON_COMMENT,
  iconColors as ICON_COLOR,
  iconTextFields as ICON_TEXT,
  iconPointScan as ICON_TARGET,
  iconDelete as ICON_TRASH,
  iconDragIndicator as ICON_GRIP,
  iconResetColors as ICON_RESET,
  iconSend as ICON_SEND,
  iconShare as ICON_HANDOFF,
  iconClose as ICON_CLOSE,
  iconRefresh as ICON_REFRESH,
  iconWarning as ICON_WARNING,
};
