import { parse, serialize } from "parse5";

function* nodes(root) {
  yield root;
  for (const child of root.childNodes ?? []) yield* nodes(child);
}

function detach(node) {
  const children = node.parentNode?.childNodes;
  if (children) children.splice(children.indexOf(node), 1);
  node.parentNode = undefined;
}

// React sends completed Suspense segments outside the initial main element.
// Resolve only its literal segment moves. Never execute page scripts or treat
// an unrelated heading outside main as the requested token's heading.
export function readRenderedMain(html) {
  const document = parse(html);
  const ids = new Map();
  const scripts = [];
  for (const node of nodes(document)) {
    const id = node.attrs?.find(attr => attr.name === "id")?.value;
    if (/^[BSP]:[a-z\d]+$/iu.test(id ?? "")) {
      if (ids.has(id)) throw new Error("indexed website token page stream identity is invalid");
      ids.set(id, node);
    }
    if (node.tagName === "script") scripts.push(node);
  }
  for (const script of scripts) {
    const text = script.childNodes.map(node => node.value ?? "").join("");
    for (const call of text.matchAll(/(?:^|[;}])\s*\$R([SC])\("([BSP]:[a-z\d]+)","([BSP]:[a-z\d]+)"\)(?=;|$)/gimu)) {
      const sourceId = call[1] === "S" ? call[2] : call[3];
      const targetId = call[1] === "S" ? call[3] : call[2];
      const source = ids.get(sourceId), target = ids.get(targetId);
      const parent = target?.parentNode;
      if (!sourceId.startsWith("S:") || !targetId.startsWith(call[1] === "S" ? "P:" : "B:") ||
        source?.tagName !== "div" || target?.tagName !== "template" || !parent?.childNodes) {
        throw new Error("indexed website token page stream boundary is invalid");
      }
      const index = parent.childNodes.indexOf(target);
      let count = 1;
      if (call[1] === "C") {
        const start = parent.childNodes[index - 1];
        if (start?.nodeName !== "#comment" || !["$?", "$!"].includes(start.data)) {
          throw new Error("indexed website token page stream boundary is invalid");
        }
        let depth = 0, end = -1;
        for (let i = index + 1; i < parent.childNodes.length; i += 1) {
          const node = parent.childNodes[i];
          if (node.nodeName !== "#comment") continue;
          if (["$", "$?", "$!"].includes(node.data)) depth += 1;
          if (node.data === "/$") {
            if (depth === 0) { end = i; break; }
            depth -= 1;
          }
        }
        if (end < 0) throw new Error("indexed website token page stream boundary is invalid");
        count = end - index;
        start.data = "$";
      }
      const children = source.childNodes;
      source.childNodes = [];
      detach(source);
      for (const child of children) child.parentNode = parent;
      parent.childNodes.splice(index, count, ...children);
    }
  }
  for (const script of scripts) detach(script);
  const main = [...nodes(document)].find(node => node.tagName === "main");
  return main ? serialize(main) : undefined;
}
