export interface SourceLocation {
  path: string;
  line: number;
  column: number;
  via: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type OperationType = "comment" | "style" | "text";

export interface Operation {
  type: OperationType;
  property: string | null;
  from: string | null;
  to: string | null;
}

export interface CommentMetadata {
  page: string;
  viewport: { w: number; h: number };
  elementText: string;
}

export interface ComponentFrame {
  name: string;
}

export interface ComponentInfo {
  // Innermost first: the component that rendered the element, then its ancestors.
  stack: ComponentFrame[];
}

export interface RouteInfo {
  pattern: string;
  params: Record<string, string> | null;
  router: string;
  routeFile: string | null;
  // "exact" came from the page's own router state; "inferred" is a guess from the URL shape and
  // must be presented to the agent as a guess, never as fact.
  confidence: "exact" | "inferred";
}

export interface TargetAncestor {
  tag: string;
  id: string | null;
  classes: string[];
}

export interface Target {
  selector: string;
  tag: string;
  id: string | null;
  testId: string | null;
  role: string | null;
  ariaLabel: string | null;
  classes: string[];
  attributes: Record<string, string>;
  ownText: string;
  ancestors: TargetAncestor[];
  rect: Rect;
  outerHtml: string;
}

export interface DraftRequest {
  comment: string;
  operation: Operation;
  operator: string;
  url: string;
  metadata: CommentMetadata;
  source: SourceLocation | null;
  component: ComponentInfo | null;
  route: RouteInfo | null;
  target: Target | null;
  screenshotDataUrl: string | null;
  attachScreenshot: boolean;
  planFirst?: boolean;
}

export interface QueuedRequest extends DraftRequest {
  cid: string;
  queuedAt: number;
}
