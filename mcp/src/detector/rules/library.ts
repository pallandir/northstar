import type { Check } from "../types.js";
import { importSpecifiers, importsAny } from "./util.js";

const COMPONENT = ["component"] as const;

const OVERLAY_PACKAGES = [
  "@radix-ui/",
  "radix-ui",
  "@headlessui/",
  "react-aria",
  "react-aria-components",
  "@ark-ui/",
  "bits-ui",
  "@kobalte/",
  "@angular/cdk",
  "reka-ui",
  "vaul",
  "cmdk",
  "@floating-ui/",
  "@base-ui",
  "@mui/",
  "antd",
  "primevue",
  "vuetify",
  "@mantine/",
  "@chakra-ui/",
  "sonner",
  "@zag-js/",
  "@spartan-ng/",
];
const TOAST_PACKAGES = [
  "sonner",
  "react-hot-toast",
  "react-toastify",
  "@radix-ui/react-toast",
  "primevue",
  "@mantine/notifications",
  "notistack",
  "@angular/material",
  "ngx-toastr",
  "sileo",
];
const LOCAL_UI = /(^|\/)components\/ui(\/|$)/;
const ICON_FILE =
  /(?:^|[/._-])(?:icons?|logos?|illustrations?|sprites?|svgs?)(?:[/._-]|$)|(?:Icons?|Logos?|Illustrations?|Sprites?|Svgs?|SVGs?)(?=[A-Z/._-]|$)/;

const usesLocalUi = (text: string, file: string): boolean =>
  LOCAL_UI.test(file) || importSpecifiers(text).some((spec) => LOCAL_UI.test(spec));

export const libraryChecks: Check[] = [
  {
    id: "NS-LIB-ICON",
    kinds: [...COMPONENT, "markup"],
    run(ctx) {
      if (ICON_FILE.test(ctx.file)) return;
      const pattern = /<svg\b[^>]*>[\s\S]{0,400}?<path\b[^>]*\bd=["'`][^"'`]{40,}/g;
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        ctx.report("NS-LIB-ICON", m.index, "Hand drawn inline SVG path");
      }
    },
  },
  {
    id: "NS-LIB-OVERLAY",
    kinds: [...COMPONENT],
    run(ctx) {
      if (importsAny(ctx.text, OVERLAY_PACKAGES) || usesLocalUi(ctx.text, ctx.file)) return;
      const pattern =
        /\brole=["'](dialog|alertdialog|menu|listbox)["']|\baria-modal=|\baria-haspopup=/g;
      const first = pattern.exec(ctx.text);
      if (first)
        ctx.report(
          "NS-LIB-OVERLAY",
          first.index,
          "Hand rolled overlay semantics without an overlay library",
        );
    },
  },
  {
    id: "NS-LIB-FONT",
    kinds: ["css", "markup", "component"],
    run(ctx) {
      const pattern = /@font-face\s*\{/g;
      for (let m = pattern.exec(ctx.text); m; m = pattern.exec(ctx.text)) {
        ctx.report("NS-LIB-FONT", m.index);
      }
    },
  },
  {
    id: "NS-LIB-TOAST",
    kinds: [...COMPONENT],
    run(ctx) {
      if (importsAny(ctx.text, TOAST_PACKAGES) || usesLocalUi(ctx.text, ctx.file)) return;
      const pattern = /(?:className|class)=["'][^"']*\b(toast|snackbar)\b[^"']*["']/g;
      const first = pattern.exec(ctx.text);
      if (first)
        ctx.report("NS-LIB-TOAST", first.index, "Hand rolled toast without a notification library");
    },
  },
];
