import { assetUrl, isList } from '../viewer/model.js';

const marks = new Map([['b', 'strong'], ['strong', 'strong'], ['i', 'em'], ['em', 'em'], ['u', 'u'], ['a', 'a']]);

export function readInline(root, baseUrl) {
  const parts = [];
  for (const node of root.childNodes) {
    if (node.nodeType === 3) {
      if (node.data) parts.push(node.data);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = node.localName;
    if (['script', 'style', 'template', 'iframe'].includes(tag)) continue;
    if (tag === 'br') {
      parts.push({ tag: 'br' });
      continue;
    }
    let children = readInline(node, baseUrl);
    if (tag === 'a') {
      const href = node.getAttribute('href');
      try {
        assetUrl(href, baseUrl, 'link');
        children = [{ tag: 'a', href, children }];
      } catch {
        // Keep the text of links the viewer cannot open.
      }
    } else if (marks.get(tag) && children.length) {
      children = [{ tag: marks.get(tag), children }];
    } else if (['div', 'p', 'li', 'h1', 'h2', 'h3'].includes(tag) && parts.length) {
      parts.push({ tag: 'br' });
    }
    parts.push(...children);
  }
  return parts;
}

export function readText(root, object, baseUrl) {
  if (!isList(object.kind)) {
    const parts = readInline(root, baseUrl);
    return parts.length ? parts : [''];
  }
  const nodes = [...root.childNodes];
  const items = nodes.filter((node) => node.localName === 'li');
  if (items.length === nodes.length && items.length) {
    return items.map((item) => ({ tag: 'li', children: readInline(item, baseUrl) }));
  }
  return [{ tag: 'li', children: readInline(root, baseUrl) }];
}

function boundary(node, offset, forward) {
  if (node.nodeType !== 3 || offset === 0 || offset === node.length) return offset;
  if (globalThis.Intl?.Segmenter) {
    const part = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(node.data).containing(offset);
    if (part.index !== offset) return forward ? part.index + part.segment.length : part.index;
  } else if (/^[\udc00-\udfff]$/.test(node.data[offset]) && /^[\ud800-\udbff]$/.test(node.data[offset - 1])) {
    return offset + (forward ? 1 : -1);
  }
  return offset;
}

export function splitSelection(root, original, baseUrl) {
  const selection = original.cloneRange();
  if (!selection.collapsed) {
    selection.setStart(original.startContainer, boundary(original.startContainer, original.startOffset, false));
    selection.setEnd(original.endContainer, boundary(original.endContainer, original.endOffset, true));
  }
  const before = root.ownerDocument.createRange();
  before.selectNodeContents(root);
  before.setEnd(selection.startContainer, selection.startOffset);
  const after = root.ownerDocument.createRange();
  after.selectNodeContents(root);
  after.setStart(selection.endContainer, selection.endOffset);
  let middle = readInline(selection.cloneContents(), baseUrl);
  let ancestor = selection.commonAncestorContainer;
  if (ancestor.nodeType !== 1) ancestor = ancestor.parentElement;
  while (ancestor && ancestor !== root) {
    const tag = marks.get(ancestor.localName);
    if (tag === 'a') middle = [{ tag, href: ancestor.getAttribute('href'), children: middle }];
    else if (tag) middle = [{ tag, children: middle }];
    ancestor = ancestor.parentElement;
  }
  return { before: readInline(before.cloneContents(), baseUrl), middle, after: readInline(after.cloneContents(), baseUrl) };
}

export function stripMark(parts, tag) {
  return parts.flatMap((part) => {
    if (!part?.children) return [part];
    const children = stripMark(part.children, tag);
    return part.tag === tag ? children : [{ ...part, children }];
  });
}

export function marked(parts, tag) {
  return parts.length > 0 && parts.every((part) => part.tag === tag ||
    (part.children && marked(part.children, tag)));
}

export function changeKind(object, kind) {
  let content = object.content;
  if (isList(object.kind) && !isList(kind)) {
    content = content.flatMap((item, index) => index ? [{ tag: 'br' }, ...item.children] : item.children);
  } else if (!isList(object.kind) && isList(kind)) {
    const items = [[]];
    for (const part of content) {
      if (part.tag === 'br') items.push([]);
      else items.at(-1).push(part);
    }
    content = items.map((children) => ({ tag: 'li', children }));
  }
  return { ...object, kind, content: content.length ? content : [''] };
}
