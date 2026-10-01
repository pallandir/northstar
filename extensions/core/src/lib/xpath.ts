export function resolveXPath(xpath: string): Element | null {
  let node: Node | null;
  try {
    node = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
  } catch (err) {
    throw new Error(`invalid XPath ${xpath}: ${(err as Error).message}`);
  }
  return node instanceof Element ? node : null;
}
