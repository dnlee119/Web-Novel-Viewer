import { assetUrl } from './model.js';

export function appendText(parent, parts, baseUrl) {
  for (const part of parts) {
    if (typeof part === 'string') {
      parent.append(part);
      continue;
    }
    const child = parent.ownerDocument.createElement(part.tag);
    if (part.tag === 'a') child.href = assetUrl(part.href, baseUrl, 'link');
    if (part.children) appendText(child, part.children, baseUrl);
    parent.append(child);
  }
}

export function textTag(kind) {
  return { heading: 'h3', unordered: 'ul', ordered: 'ol' }[kind] ?? 'p';
}
