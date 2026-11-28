export class WorkError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'WorkError';
    this.path = path;
  }
}

const effects = ['none', 'fade', 'slide'];
const inlineTags = ['strong', 'em', 'u', 'br', 'a'];
const placementFields = ['x', 'y', 'width', 'height', 'minWidth', 'maxWidth', 'featured'];
const effectFields = ['showFrom', 'showTo', 'enterEnd', 'exitStart', 'enter', 'hold', 'exit'];

function record(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkError(path, 'expected an object');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new WorkError(`${path}.${key}`, 'unknown field');
  }
  return value;
}

function array(value, path) {
  if (!Array.isArray(value)) throw new WorkError(path, 'expected an array');
  return value;
}

function text(value, path, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new WorkError(path, 'expected text');
  }
  return value;
}

function number(value, minimum, maximum, path) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new WorkError(path, `expected a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function choice(value, allowed, path) {
  if (!allowed.includes(value)) throw new WorkError(path, `expected ${allowed.join(', ')}`);
  return value;
}

function id(value, path, used) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
    throw new WorkError(path, 'expected an identifier using letters, numbers, - and _');
  }
  if (used.has(value)) throw new WorkError(path, `duplicate ID "${value}"`);
  used.add(value);
  return value;
}

function length(value, path, canBeNegative = false) {
  if (value === undefined) return undefined;
  const units = /^(?<amount>-?(?:\d+(?:\.\d+)?|\.\d+))(?<unit>px|%|em|rem|ch)?$/;
  const match = (typeof value === 'string' || typeof value === 'number') && units.exec(value);
  if (!match || !Number.isFinite(Number(match.groups.amount)) ||
      (!canBeNegative && Number(match.groups.amount) <= 0)) {
    throw new WorkError(path, 'expected a length in px, %, em, rem or ch');
  }
  return match.groups.amount + (match.groups.unit ?? 'px');
}

export function assetUrl(value, baseUrl, path) {
  const reference = text(value, path).trim();
  let url;
  try {
    url = new URL(reference, baseUrl);
  } catch {
    throw new WorkError(path, 'expected a valid asset URL');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new WorkError(path, 'expected an HTTP(S) URL without credentials');
  }
  return url.href;
}

function inlineContent(value, path, baseUrl, listed = false) {
  return array(value, path).map((part, index) => {
    const partPath = `${path}[${index}]`;
    if (listed) {
      record(part, ['tag', 'children'], partPath);
      choice(part.tag, ['li'], `${partPath}.tag`);
      return { tag: 'li', children: inlineContent(part.children, `${partPath}.children`, baseUrl) };
    }
    if (typeof part === 'string') return part;
    if (part?.tag === 'br') {
      record(part, ['tag'], partPath);
      return { tag: 'br' };
    }
    const { tag, children, href } = record(part, part?.tag === 'a' ? ['tag', 'children', 'href'] : ['tag', 'children'], partPath);
    choice(tag, inlineTags, `${partPath}.tag`);
    const content = { tag, children: inlineContent(children, `${partPath}.children`, baseUrl) };
    if (tag === 'a') {
      assetUrl(href, baseUrl, `${partPath}.href`);
      content.href = href;
    }
    return content;
  });
}

function commonObject(value, path, used) {
  const enter = choice(value.enter ?? 'none', effects, `${path}.enter`);
  const hold = choice(value.hold ?? 'none', effects, `${path}.hold`);
  const exit = choice(value.exit ?? 'none', effects, `${path}.exit`);
  const showFrom = number(value.showFrom ?? 0, 0, 1, `${path}.showFrom`);
  const showTo = number(value.showTo ?? 1, showFrom, 1, `${path}.showTo`);
  if (showFrom === showTo) throw new WorkError(`${path}.showTo`, 'must be greater than showFrom');
  const enterEnd = number(value.enterEnd ?? (enter === 'none' ? 0 : 0.2), 0, 1, `${path}.enterEnd`);
  const exitStart = number(value.exitStart ?? (exit === 'none' ? 1 : 0.8), enterEnd, 1, `${path}.exitStart`);
  const minWidth = number(value.minWidth ?? 0, 0, Number.MAX_SAFE_INTEGER, `${path}.minWidth`);
  const maxWidth = number(value.maxWidth ?? Number.MAX_SAFE_INTEGER, minWidth, Number.MAX_SAFE_INTEGER, `${path}.maxWidth`);
  if (value.featured !== undefined && typeof value.featured !== 'boolean') {
    throw new WorkError(`${path}.featured`, 'expected a boolean');
  }
  return {
    featured: value.featured,
    id: id(value.id, `${path}.id`, used),
    type: value.type,
    showFrom, showTo, enterEnd, exitStart, enter, hold, exit, minWidth, maxWidth,
    x: length(value.x, `${path}.x`, true),
    y: length(value.y, `${path}.y`, true),
    width: length(value.width, `${path}.width`),
    height: length(value.height, `${path}.height`),
  };
}

const objectFields = {
  text: ['kind', 'content', 'font', 'fontSize', 'align', 'blockId'],
  image: ['src', 'alt'],
  audio: ['src', 'title', 'role', 'transcript', 'startS', 'endS', 'loop'],
  video: ['src', 'title', 'role', 'transcript', 'startS', 'endS', 'loop'],
  youtube: ['videoId', 'title', 'role', 'transcript', 'startS', 'endS', 'loop'],
};

function media(value, path, common, baseUrl) {
  const role = choice(value.role ?? (value.type === 'audio' ? 'music' : 'dialogue'),
    ['music', 'dialogue'], `${path}.role`);
  const title = text(value.title ?? common.id, `${path}.title`);
  const transcript = value.type === 'audio' && role === 'music' && value.transcript === undefined
    ? undefined : text(value.transcript, `${path}.transcript`);
  const startS = number(value.startS ?? 0, 0, Number.MAX_SAFE_INTEGER, `${path}.startS`);
  const endS = value.endS === undefined ? undefined :
    number(value.endS, startS, Number.MAX_SAFE_INTEGER, `${path}.endS`);
  if (endS === startS) throw new WorkError(`${path}.endS`, 'must be greater than startS');
  const loop = choice(value.loop ?? 'none', ['none', 'segment', 'full'], `${path}.loop`);
  if (loop === 'segment' && endS === undefined) {
    throw new WorkError(`${path}.endS`, 'required for segment looping');
  }
  const fields = { ...common, title, role, transcript, startS, endS, loop };
  if (value.type === 'youtube') {
    if (typeof value.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(value.videoId)) {
      throw new WorkError(`${path}.videoId`, 'expected an 11-character YouTube video ID');
    }
    return { ...fields, videoId: value.videoId };
  }
  const src = text(value.src, `${path}.src`).trim();
  assetUrl(src, baseUrl, `${path}.src`);
  return { ...fields, src };
}

function object(value, path, used, baseUrl) {
  const type = choice(value?.type, Object.keys(objectFields), `${path}.type`);
  const extra = objectFields[type];
  record(value, ['id', 'type', ...placementFields, ...effectFields, ...extra], path);
  const common = commonObject(value, path, used);
  if (type === 'image') {
    const src = text(value.src, `${path}.src`).trim();
    assetUrl(src, baseUrl, `${path}.src`);
    return { ...common, src, alt: text(value.alt, `${path}.alt`, true) };
  }
  if (type !== 'text') return media(value, path, common, baseUrl);
  const font = value.font;
  if (font !== undefined && (typeof font !== 'string' || !/^[\p{L}\p{N} _-]+$/u.test(font))) {
    throw new WorkError(`${path}.font`, 'expected a font family name');
  }
  const kind = choice(value.kind ?? 'paragraph',
    ['paragraph', 'sentence', 'heading', 'unordered', 'ordered'], `${path}.kind`);
  const content = inlineContent(value.content, `${path}.content`, baseUrl, isList(kind));
  if (!content.length) throw new WorkError(`${path}.content`, 'text object cannot be empty');
  return {
    ...common,
    kind,
    align: value.align === undefined ? undefined :
      choice(value.align, ['start', 'center', 'end', 'justify'], `${path}.align`),
    blockId: value.blockId === undefined ? undefined : text(value.blockId, `${path}.blockId`),
    content, font,
    fontSize: length(value.fontSize, `${path}.fontSize`),
  };
}

export function validateWork(value, { baseUrl } = {}) {
  record(value, ['schemaVersion', 'title', 'lang', 'groups'], 'work');
  if (value.schemaVersion !== 1) throw new WorkError('work.schemaVersion', 'supported version: 1');
  const seenIds = new Set();
  const groups = array(value.groups, 'work.groups').map((group, index) => {
    const path = `work.groups[${index}]`;
    record(group, ['id', 'title', 'scrollVh', 'autoMs', 'objects'], path);
    const groupId = id(group.id, `${path}.id`, seenIds);
    const objects = array(group.objects, `${path}.objects`).map((entry, itemIndex) =>
      object(entry, `${path}.objects[${itemIndex}]`, seenIds, baseUrl));
    return {
      id: groupId,
      title: text(group.title ?? groupId, `${path}.title`),
      scrollVh: number(group.scrollVh ?? 100, 1, 10000, `${path}.scrollVh`),
      autoMs: group.autoMs === undefined ? undefined :
        number(group.autoMs, 1, Number.MAX_SAFE_INTEGER, `${path}.autoMs`),
      objects,
    };
  });
  if (!groups.length) throw new WorkError('work.groups', 'expected at least one group');
  return {
    schemaVersion: 1,
    title: text(value.title ?? '작품', 'work.title'),
    lang: text(value.lang ?? 'ko', 'work.lang'),
    groups,
  };
}

export function isList(kind) {
  return kind === 'unordered' || kind === 'ordered';
}
