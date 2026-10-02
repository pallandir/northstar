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

interface ComponentFrame {
  name: string;
}

export interface ComponentInfo {
  stack: ComponentFrame[];
}

export interface RouteInfo {
  pattern: string;
  params: Record<string, string> | null;
  router: string;
  routeFile: string | null;
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

export type Intent = "change" | "bug" | "copy" | "style" | "question";

export interface LocateHint {
  kind: "source" | "component" | "routeFile" | "testId" | "aria" | "text" | "selector" | "xpath";
  value: string;
  confidence: number;
}

export interface PageInfo {
  title: string | null;
  colorScheme: string | null;
}

export interface SemanticInfo {
  ariaRole: string | null;
  ariaName: string | null;
  landmark: string | null;
  heading: string | null;
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
  schemaVersion?: number;
  intent?: Intent;
  locate?: LocateHint[];
  page?: PageInfo;
  element?: SemanticInfo;
}

export interface Rejection {
  field: string | null;
  error: string;
  fix: string;
}

export interface QueuedRequest extends DraftRequest {
  cid: string;
  queuedAt: number;
  sendingAt?: number;
  rejection?: Rejection;
}
