import { validateWork, WorkError } from './model.js';

const workFields = ['schema-version', 'title', 'lang'];
const groupFields = ['id', 'title', 'scroll-vh', 'auto-ms'];
const commonFields = [
  'id', 'featured', 'x', 'y', 'width', 'height', 'min-width', 'max-width',
  'show-from', 'show-to', 'enter-end', 'exit-start', 'enter', 'hold', 'exit',
];
const numericFields = new Set([
  'schema-version', 'scroll-vh', 'auto-ms', 'min-width', 'max-width',
  'show-from', 'show-to', 'enter-end', 'exit-start', 'start-s', 'end-s',
]);
const mediaFields = ['title', 'role', 'transcript', 'start-s', 'end-s', 'loop'];

function attributes(element, allowed, path) {
  const values = {};
  for (const { name, value } of element.attributes) {
    if (!allowed.includes(name)) throw new WorkError(`${path}.${name}`, 'unknown attribute');
    const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (name === 'featured') {
      if (value !== 'true' && value !== 'false') throw new WorkError(`${path}.featured`, 'expected true or false');
      values[key] = value === 'true';
    } else if (numericFields.has(name)) {
      if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) {
        throw new WorkError(`${path}.${name}`, 'expected a decimal number');
      }
      values[key] = Number(value);
    } else {
      values[key] = value;
    }
  }
  return values;
}

function elements(parent, path) {
  return Array.from(parent.childNodes).filter((child) => {
    if (child.nodeType === 1) return true;
    if (child.nodeType === 8 || (child.nodeType === 3 && !child.textContent.trim())) return false;
    throw new WorkError(path, 'unexpected text outside a text object');
  });
}

function inline(parent, path, listed = false) {
  return Array.from(parent.childNodes).flatMap((node, index) => {
    if (node.nodeType === 8) return [];
    if (node.nodeType === 3) {
      if (!listed) return [node.textContent];
      if (!node.textContent.trim()) return [];
      throw new WorkError(path, 'expected list items');
    }
    const tag = node.localName;
    const itemPath = `${path}[${index}]`;
    if (!(listed ? ['li'] : ['strong', 'em', 'u', 'br', 'a']).includes(tag) ||
        [...(node.attributes ?? [])].some(({ name }) => tag !== 'a' || name !== 'href')) {
      throw new WorkError(itemPath, 'expected an allowed, unadorned inline or list tag');
    }
    if (tag === 'br') return [{ tag }];
    const part = { tag, children: inline(node, itemPath) };
    if (tag === 'a') part.href = node.getAttribute('href');
    return [part];
  });
}

function htmlObject(element, path) {
  if (element.localName === 'wn-text') {
    const fields = attributes(element, [...commonFields, 'kind', 'font', 'font-size', 'align', 'block-id'], path);
    return { ...fields, type: 'text',
      content: inline(element, `${path}.content`, fields.kind === 'unordered' || fields.kind === 'ordered') };

  }
  const type = element.localName.slice(3);
  if (!['wn-image', 'wn-audio', 'wn-video', 'wn-youtube'].includes(element.localName)) {
    throw new WorkError(path, `unsupported object <${element.localName}>`);
  }
  if (elements(element, path).length) throw new WorkError(path, `${type} cannot contain elements`);
  const fields = type === 'image' ? ['src', 'alt'] :
    [...mediaFields, type === 'youtube' ? 'video-id' : 'src'];
  return { ...attributes(element, [...commonFields, ...fields], path), type };
}

function parseMarkup(input, document) {
  // Read from inert template content. No source node is ever inserted into the page.
  const template = document.createElement('template');
  template.innerHTML = input;
  const roots = elements(template.content, 'work');
  if (roots.length !== 1 || roots[0].localName !== 'wn-story') {
    throw new WorkError('work', 'expected one wn-story root');
  }
  const root = roots[0];
  const groups = elements(root, 'work').map((element, index) => {
    const path = `work.groups[${index}]`;
    if (element.localName !== 'wn-group') throw new WorkError(path, 'expected wn-group');
    return {
      ...attributes(element, groupFields, path),
      objects: elements(element, path).map((entry, itemIndex) =>
        htmlObject(entry, `${path}.objects[${itemIndex}]`)),
    };
  });
  return { ...attributes(root, workFields, 'work'), groups };
}

export function parseWork(input, { document = globalThis.document, baseUrl = document?.baseURI } = {}) {
  if (typeof input !== 'string') return validateWork(input, { baseUrl });
  const source = input.trim();
  if (source.startsWith('<')) return validateWork(parseMarkup(source, document), { baseUrl });
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new WorkError('work', `invalid JSON (${error.message})`);
  }
  return validateWork(data, { baseUrl });
}

export async function readWork(source, { document, signal, assetBaseUrl }) {
  let input = source;
  let baseUrl = document.baseURI;
  if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, 'getUrl')) {
    if (typeof source.getUrl !== 'string' || !source.getUrl.trim()) {
      throw new WorkError('source.getUrl', 'expected an HTTP(S) URL');
    }
    let url;
    try {
      url = new URL(source.getUrl, document.baseURI);
    } catch {
      throw new WorkError('source.getUrl', 'expected an HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new WorkError('source.getUrl', 'expected an HTTP(S) URL');
    }
    const response = await document.defaultView.fetch(url, { signal });
    if (!response.ok) throw new WorkError('source.getUrl', `HTTP ${response.status}`);
    input = await response.text();
    baseUrl = response.url || url.href;
  }
  if (assetBaseUrl !== undefined) baseUrl = new URL(assetBaseUrl, baseUrl).href;
  return { work: parseWork(input, { document, baseUrl }), baseUrl };
}
