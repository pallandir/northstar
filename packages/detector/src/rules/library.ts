import type { Check } from "../types.js";

const COMPONENT = ["component"] as const;

const OVERLAY_LIBS =
  /@radix-ui|radix-ui|@headlessui|react-aria|@ark-ui|bits-ui|@kobalte|@angular\/cdk|reka-ui|vaul|cmdk|components\/ui|@floating-ui|@base-ui|@mui|antd|primevue|vuetify|@mantine|@chakra-ui|sonner|@zag-js|@spartan-ng/;
const TOAST_LIBS =
  /sonner|react-hot-toast|react-toastify|@radix-ui\/react-toast|primevue|@mantine\/notifications|notistack|@angular\/material|ngx-toastr|sileo/;
const ICON_FILE = /icon|logo|illustration|sprite|svg/i;

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
      if (OVERLAY_LIBS.test(ctx.text) || /components\/ui\//.test(ctx.file)) return;
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
      if (TOAST_LIBS.test(ctx.text) || /components\/ui\//.test(ctx.file)) return;
      const pattern = /(?:className|class)=["'][^"']*\b(toast|snackbar)\b[^"']*["']/g;
      const first = pattern.exec(ctx.text);
      if (first)
        ctx.report("NS-LIB-TOAST", first.index, "Hand rolled toast without a notification library");
    },
  },
];
