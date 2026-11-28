import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWork } from '../site/viewer/source.js';
import { groupRanges, objectState, offsetAt, positionAt, timeRanges } from '../site/viewer/timeline.js';

const source = readFileSync(new URL('../site/stories/first-train.json', import.meta.url), 'utf8');
const baseUrl = 'https://example.test/project/stories/first-train.json';
const work = parseWork(source, { baseUrl });

test('model preserves asset references, inline styling and timing defaults', () => {
  const [image, opening, detail] = work.groups[0].objects;
  assert.equal(image.src, './images/dawn-platform.webp');
  assert.equal(image.x, '0px');
  assert.equal(opening.content[1].tag, 'strong');
  assert.equal(opening.showFrom, 0);
  assert.equal(opening.enterEnd, 0);
  assert.equal(detail.enterEnd, 0.2);
  assert.deepEqual(parseWork(JSON.stringify(work), { baseUrl }).groups, work.groups);
});

test('model reports the locations of conflicting IDs, invalid ranges and unsupported values', () => {
  const candidate = JSON.parse(source);
  const parse = () => parseWork(candidate, { baseUrl });
  candidate.groups[1].id = 'platform';
  assert.throws(parse, /work\.groups\[1\]\.id: duplicate/);
  candidate.groups[1].id = 'door';
  const [image, text] = candidate.groups[0].objects;
  text.showFrom = 0.6;
  text.showTo = 0.4;
  assert.throws(parse, /objects\[1\]\.showTo/);
  delete text.showFrom;
  delete text.showTo;
  text.fontSize = [12];
  assert.throws(parse, /objects\[1\]\.fontSize/);
  delete text.fontSize;
  text.enter = 'unregistered';
  assert.throws(parse, /objects\[1\]\.enter/);
  delete text.enter;
  image.src = 'javascript:void(0)';
  assert.throws(parse, /objects\[0\]\.src/);
  candidate.schemaVersion = 2;
  assert.throws(parse, /work\.schemaVersion/);
  assert.throws(() => parseWork('{', { baseUrl }), /invalid JSON/);
});

test('timeline selects exact boundaries and clamps seeking within the active group', () => {
  const ranges = groupRanges(work.groups, 500);
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[0, 600], [600, 1090]]);
  assert.equal(positionAt(ranges, 600).group.id, 'door');
  assert.equal(positionAt(ranges, 5000).progress, 1);
  assert.equal(positionAt(ranges, -10).progress, 0);
  assert.equal(offsetAt(ranges, 'platform', 1), 599);
  assert.equal(offsetAt(ranges, 'door', 1), 1090);
  assert.equal(offsetAt(ranges, 'missing', 0.5), null);
  assert.equal(offsetAt(ranges, 'door', NaN), null);
});

test('object effects depend on local progress and the container, with a static motion fallback', () => {
  const detail = work.groups[0].objects[2];
  assert.equal(objectState(detail, 0.1, 1000).visible, false);
  assert.equal(objectState(detail, 0.18, 1000).opacity, 0);
  assert.equal(objectState(detail, 0.5, 1000).opacity, 1);
  assert.equal(objectState(detail, 0.18, 1000, false).opacity, 1);
  const constrained = { ...detail, minWidth: 600, maxWidth: 900 };
  assert.equal(objectState(constrained, 0.5, 599).visible, false);
  assert.equal(objectState(constrained, 0.5, 900).visible, true);
  assert.equal(objectState(constrained, 0.5, 901).visible, false);
});

test('automatic time uses the same group progress as scrolling', () => {
  const groups = [work.groups[0], { ...work.groups[1], autoMs: undefined }];
  const timed = timeRanges(groups);
  const scroll = groupRanges(groups, 500);
  assert.equal(timed[1].end, 14000);
  assert.equal(positionAt(timed, 8000).group.id, 'door');
  const position = positionAt(timed, 11000);
  assert.equal(position.progress, 0.5);
  assert.deepEqual(positionAt(scroll, offsetAt(scroll, position.group.id, position.progress)), position);
});

test('media model validates clip ranges, transcripts and YouTube IDs', () => {
  const candidate = JSON.parse(source);
  const media = candidate.groups[0].objects.at(-1);
  const parse = () => parseWork(candidate, { baseUrl }).groups[0].objects.at(-1);
  assert.deepEqual([parse().type, parse().role, parse().loop, parse().startS], ['audio', 'music', 'none', 0]);
  media.startS = 1;
  media.endS = 0.5;
  assert.throws(parse, /\.endS/);
  delete media.endS;
  media.loop = 'segment';
  assert.throws(parse, /required for segment looping/);
  media.endS = 2;
  assert.equal(parse().endS, 2);
  media.role = 'dialogue';
  assert.throws(parse, /\.transcript/);
  media.transcript = '대사 예시';
  media.type = 'youtube';
  delete media.src;
  media.videoId = 'invalid';
  assert.throws(parse, /\.videoId/);
  media.videoId = 'M7lc1UVf-VE';
  assert.equal(parse().videoId, 'M7lc1UVf-VE');
});

test('editor document types extend v1 without changing older paragraph data', () => {
  const candidate = JSON.parse(source);
  const paragraph = candidate.groups[0].objects[1];
  paragraph.kind = 'ordered';
  paragraph.align = 'center';
  paragraph.featured = true;
  paragraph.content = [{ tag: 'li', children: [{ tag: 'a', href: '../more', children: ['더 읽기'] }] }];
  const list = parseWork(candidate, { baseUrl }).groups[0].objects[1];
  assert.deepEqual(list.content, paragraph.content);
  assert.equal(list.kind, 'ordered');
  assert.equal(list.featured, true);
  paragraph.content[0].children[0].href = 'javascript:void(0)';
  assert.throws(() => parseWork(candidate, { baseUrl }), /\.href/);
});
