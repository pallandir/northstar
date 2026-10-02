export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 1080 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[];

export const DEFAULT_VIEWPORTS: ViewportName[] = ["mobile", "desktop"];
