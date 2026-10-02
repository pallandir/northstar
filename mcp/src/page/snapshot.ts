export type Rgba = [number, number, number, number];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type NodeKind = "heading" | "button" | "link" | "field" | "image" | "text" | "surface" | "landmark";

type FocusState = "visible" | "none" | "unchecked";

interface NodeStyle {
  color: Rgba;
  background: Rgba;
  ownBackground: Rgba;
  backgroundImage: "none" | "gradient" | "image";
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  lineHeight: number | null;
  textAlign: string;
  radius: number;
  border: boolean;
  shadow: boolean;
  gradientText: boolean;
  outline: boolean;
  backgroundDisputed: boolean;
}

export interface PageNode {
  id: number;
  parent: number | null;
  selector: string;
  tag: string;
  role: string | null;
  kind: NodeKind;
  level: number | null;
  text: string;
  name: string;
  labelled: boolean;
  hasAlt: boolean;
  interactive: boolean;
  box: Box;
  style: NodeStyle;
  focus: FocusState;
  svgOnly: boolean;
}

interface PageBlock {
  selector: string;
  tag: string;
  box: Box;
}

export interface PageSnapshot {
  url: string;
  title: string;
  lang: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  nodes: PageNode[];
  blocks: PageBlock[];
  layers: Box[];
}

export function bottomOf(box: Box): number {
  return box.y + box.height;
}

export function rightOf(box: Box): number {
  return box.x + box.width;
}

export function centreX(box: Box): number {
  return box.x + box.width / 2;
}
