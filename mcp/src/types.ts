export type CommentStatus = "open" | "in_progress" | "resolved" | "wontfix";

export type Intent = "change" | "bug" | "copy" | "style" | "question";

export type LocateKind =
  | "source"
  | "component"
  | "routeFile"
  | "testId"
  | "aria"
  | "text"
  | "selector"
  | "xpath";

export type LocateConfidence = number | "high" | "medium" | "low";

export interface LocateEntry {
  kind: LocateKind;
  value: string;
  confidence: LocateConfidence;
}

export interface PageInfo {
  title?: string | null;
  colorScheme?: string | null;
}

export interface ElementInfo {
  ariaRole?: string | null;
  ariaName?: string | null;
  landmark?: string | null;
  heading?: string | null;
}

export interface Resolution {
  by: string;
  note: string | null;
  files: string[];
  at: string;
}

export type OperationType = "comment" | "style" | "text";

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
  via: string;
}

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
  rect: { x: number; y: number; w: number; h: number };
  outerHtml: string;
}

export interface Comment {
  id: string;
  createdAt: string;
  comment: string;
  operation: Operation;
  operator: string;
  url: string;
  metadata: CommentMetadata;
  status: CommentStatus;
  source: SourceLocation | null;
  component: ComponentInfo | null;
  route: RouteInfo | null;
  target: Target | null;
  screenshot: string | null;
  attachScreenshot: boolean;
  planFirst?: boolean;
  cid?: string;
  schemaVersion?: number;
  intent?: Intent;
  locate?: LocateEntry[];
  page?: PageInfo;
  element?: ElementInfo;
  resolution?: Resolution;
}

export interface DeferredComment {
  id: string;
  createdAt: string;
  page: string;
  operationType: OperationType;
  comment: string;
  reason: string;
  flaggedBy: "user" | "assistant";
  category: "needs-plan" | "feedback";
}

export interface DeferralNotice {
  commentId: string;
  page: string;
  summary: string;
  createdAt: string;
}

export interface IncomingComment {
  comment: string;
  operation: Operation;
  operator: string;
  url: string;
  metadata: CommentMetadata;
  source?: SourceLocation | null;
  component?: ComponentInfo | null;
  route?: RouteInfo | null;
  target?: Target | null;
  screenshotDataUrl?: string | null;
  attachScreenshot?: boolean;
  planFirst?: boolean;
  cid?: string;
  schemaVersion?: number;
  intent?: Intent;
  locate?: LocateEntry[];
  page?: PageInfo;
  element?: ElementInfo;
}
