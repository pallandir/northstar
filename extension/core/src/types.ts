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

export interface DraftRequest {
  comment: string;
  operation: Operation;
  operator: string;
  url: string;
  metadata: CommentMetadata;
  source: SourceLocation | null;
  screenshotDataUrl: string | null;
  planFirst?: boolean;
}

export interface QueuedRequest extends DraftRequest {
  cid: string;
  queuedAt: number;
}
