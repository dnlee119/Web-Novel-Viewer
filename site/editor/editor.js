import { assetUrl, isList, validateWork } from '../viewer/model.js';
import { parseWork } from '../viewer/source.js';
import { appendText, textTag } from '../viewer/text.js';
import { changeKind, marked, readInline, readText, splitSelection, stripMark } from './edit-text.js';
import { createSceneMenu } from './scene-menu.js';
import { loadEditorWork, portableWork, saveEditorWork } from './transport.js';

const stylesheet = new URL('./editor.css', import.meta.url).href;
const mounted = new WeakMap();
let editorCount = 0;
const blankWork = { schemaVersion: 1, lang: 'ko', title: '제목 없는 작품',
  groups: [{ id: 'scene-1', title: '장면 1', objects: [] }] };
const viewEffects = [['none', '없음'], ['fade', '페이드'], ['slide', '슬라이드']];
const loops = [['none', '반복 안 함'], ['segment', '구간 반복'], ['full', '전체 반복']];
const kinds = [['paragraph', '문단'], ['sentence', '문장'], ['heading', '제목'],
  ['unordered', '글머리 기호'], ['ordered', '번호 목록']];

export function mountEditor(container, options = {}) {
  if (container?.nodeType !== 1) throw new TypeError('mountEditor requires a DOM container');
  mounted.get(container)?.destroy();
  const document = container.ownerDocument;
  const window = document.defaultView;
  const controller = new AbortController();
  const root = document.createElement('section');
  root.className = 'wne';
  root.setAttribute('aria-label', '작품 편집기');
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = stylesheet;
  root.append(styles);
  container.append(root);

  function node(tag, text, parent) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    parent?.append(element);
    return element;
  }

  function button(parent, label, action, preserveSelection = false) {
    const control = node('button', label, parent);
    control.type = 'button';
    if (preserveSelection) control.addEventListener('mousedown', (event) => {
      if (document.activeElement?.isContentEditable) event.preventDefault();
    });
    control.addEventListener('click', action);
    return control;
  }

  function field(parent, label, value, change, { type = 'text', choices, inputMode } = {}) {
    const wrapper = node('label', undefined, parent);
    node('span', label, wrapper);
    const control = node(choices ? 'select' : 'input', undefined, wrapper);
    if (choices) {
      for (const [key, name] of choices) node('option', name, control).value = key;
    } else {
      control.type = type;
      if (inputMode) control.inputMode = inputMode;
    }
    control.value = value ?? '';
    if (change) control.addEventListener('change', () => change(control.value));
    return control;
  }

  const commandBar = node('header', undefined, root);
  commandBar.className = 'wne-bar';
  const undo = button(commandBar, '실행 취소', () => travel(past, future));
  const redo = button(commandBar, '다시 실행', () => travel(future, past));
  const reload = button(commandBar, '호스트에서 불러오기', () => loadFromHost());
  reload.hidden = !(options.getUrl || options.load);
  const saveButton = button(commandBar, '서버에 저장', () => save());
  saveButton.hidden = !(options.postUrl || options.save);
  const file = node('input', undefined, commandBar);
  file.type = 'file';
  file.accept = '.json,.html,.wn,text/html,application/json';
  file.hidden = true;
  button(commandBar, '파일 열기', () => file.click());
  button(commandBar, 'JSON 사본 내보내기', () => download());
  button(commandBar, 'JSON 텍스트 보기', () => showJson());
  const restore = button(commandBar, '임시본 복구', () => restoreDraft());
  button(commandBar, '임시 저장', () => writeDraft());
  const autoLabel = node('label', undefined, commandBar);
  autoLabel.className = 'wne-auto';
  const auto = node('input', undefined, autoLabel);
  auto.type = 'checkbox';
  node('span', '주기적 임시 저장', autoLabel);

  const status = node('p', '', root);
  status.className = 'wne-status';
  status.setAttribute('role', 'status');
  const workspace = node('div', undefined, root);
  workspace.className = 'wne-workspace';
  const scenes = node('aside', undefined, workspace);
  scenes.className = 'wne-scenes';
  const documentColumn = node('div', undefined, workspace);
  documentColumn.className = 'wne-document';
  const inspector = node('aside', undefined, workspace);
  inspector.className = 'wne-inspector';
  inspector.id = 'wne-inspector-' + ++editorCount;
  const previewPanel = node('section', undefined, root);
  previewPanel.className = 'wne-preview';
  const previewBar = node('div', undefined, previewPanel);
  previewBar.className = 'wne-bar';
  const previewButton = button(previewBar, '미리보기 열기', () => togglePreview());
  previewButton.setAttribute('aria-expanded', 'false');
  const previewWidth = field(previewBar, '너비 (px)', 768, resizePreview, { type: 'number' });
  const previewHeight = field(previewBar, '높이 (px)', 400, resizePreview, { type: 'number' });
  const previewHost = node('div', undefined, previewPanel);
  previewHost.className = 'wne-preview-host';
  previewHost.hidden = true;
  const sceneMenu = createSceneMenu(root, controller.signal);

  let baseUrl = new URL(options.assetBaseUrl ?? document.baseURI, document.baseURI).href;
  let work = validateWork(blankWork, { baseUrl });
  let groupId = work.groups[0].id;
  let selected = null;
  let inspectorOpen = false;
  let sceneClipboard;
  let objectClipboard;
  let pasteSceneControl;
  let copyObjectControl;
  let pasteObjectControl;
  let groupActions;
  let range;
  let composing = false;
  let revision = 0;
  let savedRevision = -1;
  let draftRevision = -1;
  let serial = 0;
  let loading = false;
  let saving = false;
  let preview;
  let previewTimer;
  let draftTimer;
  const past = [];
  const future = [];
  const selectionSet = new Set();
  const draftScope = options.draftKey ?? (container.id ? window.location.pathname + ':' + container.id : '');
  const draftKey = draftScope ? 'web-novel-viewer:draft:' + draftScope : '';
  const group = () => work.groups.find((entry) => entry.id === groupId) ?? work.groups[0];
  const object = () => group().objects.find((entry) => entry.id === selected);
  const message = (value) => { status.textContent = value; };
  const errorMessage = (error) => { if (!controller.signal.aborted) message(error.message || String(error)); };

  function id(prefix) {
    let value;
    do {
      value = prefix + '-' + ++serial;
    } while (work.groups.some((entry) => entry.id === value || entry.objects.some((item) => item.id === value || item.blockId === value)));
    return value;
  }

  function snapshot() {
    return { work, baseUrl, groupId, selected, inspectorOpen };
  }

  function select(group, item) {
    groupId = group;
    selected = item;
    inspectorOpen = false;
    range = undefined;
    selectionSet.clear();
  }

  function apply(next, { redraw = true } = {}) {
    const clean = validateWork(next, { baseUrl });
    if (JSON.stringify(clean) === JSON.stringify(work)) return;
    past.push(snapshot());
    if (past.length > 100) past.shift();
    future.length = 0;
    work = clean;
    revision++;
    if (redraw) render();
    else {
      updateCommands();
      queuePreview();
    }
  }

  function change(edit, options) {
    if (composing) return false;
    try {
      const next = structuredClone(work);
      edit(next.groups.find((entry) => entry.id === group().id), next);
      apply(next, options);
      return true;
    } catch (error) {
      errorMessage(error);
      return false;
    }
  }

  function travel(from, to) {
    if (composing || !from.length) return;
    to.push(snapshot());
    ({ work, baseUrl, groupId, selected, inspectorOpen } = from.pop());
    range = undefined;
    selectionSet.clear();
    revision++;
    render();
    editableForObject()?.focus();
    message(from === past ? '실행 취소했습니다.' : '다시 실행했습니다.');
  }

  function updateCommands() {
    undo.disabled = !past.length;
    redo.disabled = !future.length;
    saveButton.disabled = saving || loading || savedRevision === revision;
    reload.disabled = loading || saving;
    try {
      restore.disabled = !draftKey || !window.localStorage.getItem(draftKey);
    } catch {
      restore.disabled = true;
    }
  }

  function editableForObject() {
    return [...documentColumn.querySelectorAll('[contenteditable]')].find((element) => element.dataset.object === selected);
  }

  function addText() {
    const objectId = id('text');
    if (change((entry) => entry.objects.push({ id: objectId, type: 'text', content: [''] }))) {
      selected = objectId;
      render();
      editableForObject()?.focus();
    }
  }

  function addImage() {
    const form = node('form', undefined, documentColumn);
    form.className = 'wne-insert';
    const url = field(form, '이미지 URL', '', null);
    const alt = field(form, '대체 텍스트', '', null);
    const submit = node('button', '이미지 추가', form);
    submit.type = 'submit';
    button(form, '취소', () => form.remove());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const objectId = id('image');
      if (change((entry) => entry.objects.push({ id: objectId, type: 'image', src: url.value, alt: alt.value }))) {
        selected = objectId;
        render();
      }
    });
    url.focus();
  }

  function addMedia() {
    const form = node('form', undefined, documentColumn);
    form.className = 'wne-insert';
    const type = field(form, '미디어 유형', 'audio', null, { choices:
      [['audio', '오디오'], ['video', '동영상'], ['youtube', 'YouTube']] });
    const source = field(form, '자산 URL 또는 YouTube ID', '', null);
    const title = field(form, '미디어 제목', '', null);
    const transcript = field(form, '대본 또는 내용 설명', '', null);
    node('button', '미디어 추가', form).type = 'submit';
    button(form, '취소', () => form.remove());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const objectId = id('media');
      const sourceKey = type.value === 'youtube' ? 'videoId' : 'src';
      const media = { id: objectId, type: type.value, [sourceKey]: source.value,
        title: title.value || undefined, transcript: transcript.value || undefined };
      if (change((entry) => entry.objects.push(media), { redraw: false })) {
        selected = objectId;
        render();
      }
    });
    type.focus();
  }

  function rememberSelection() {
    const editable = editableForObject();
    const native = window.getSelection();
    if (!editable || !native?.rangeCount) return;
    const current = native.getRangeAt(0);
    if (editable.contains(current.startContainer) && editable.contains(current.endContainer)) range = current.cloneRange();
  }

  function format(tag, href) {
    if (composing) return;
    rememberSelection();
    const editable = editableForObject();
    const target = object();
    if (!range || range.collapsed || !editable?.contains(range.startContainer)) {
      message('본문에서 서식을 바꿀 구절을 선택하세요.');
      return;
    }
    try {
      if (href !== undefined) assetUrl(href, baseUrl, 'link');
      const listItem = isList(target.kind) && (range.startContainer.parentElement?.closest('li') ??
        (range.startContainer.localName === 'li' ? range.startContainer : null));
      const root = isList(target.kind) ? listItem : editable;
      if (!root?.contains(range.startContainer) || !root.contains(range.endContainer)) {
        message('한 문단 또는 목록 항목 안의 구절을 선택하세요.');
        return;
      }
      const { before, middle, after } = splitSelection(root, range, baseUrl);
      const children = stripMark(middle, tag);
      const insert = href === undefined && marked(middle, tag) ? children :
        [href === undefined ? { tag, children } : { tag, href, children }];
      const parts = [...before, ...insert, ...after];
      const index = listItem ? [...editable.children].indexOf(listItem) : -1;
      if (change((entry) => {
        const item = entry.objects.find(({ id }) => id === target.id);
        if (index >= 0) item.content[index].children = parts;
        else item.content = parts;
      })) {
        const fresh = editableForObject();
        fresh?.focus();
        const block = index >= 0 ? fresh?.children[index] : fresh;
        if (block) {
          const next = document.createRange();
          next.setStart(block, Math.min(before.length, block.childNodes.length));
          next.setEnd(block, Math.min(before.length + insert.length, block.childNodes.length));
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(next);
          range = next.cloneRange();
        }
      }
    } catch (error) {
      errorMessage(error);
    }
  }

  function linkForm(toolbar) {
    if (toolbar.querySelector('form')) return;
    const form = node('form', undefined, toolbar);
    form.className = 'wne-insert';
    const href = field(form, '링크 주소', '', null);
    node('button', '링크 적용', form).type = 'submit';
    button(form, '취소', () => form.remove());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      format('a', href.value);
    });
    href.focus();
  }

  function feature() {
    if (composing) return;
    rememberSelection();
    const target = object();
    if (!target) return;
    const editable = editableForObject();
    let pieces;
    if (range && !range.collapsed && editable?.contains(range.startContainer) &&
        editable.contains(range.endContainer) && !isList(target.kind)) {
      pieces = splitSelection(editable, range, baseUrl);
    }
    if (!pieces || !pieces.middle.length ||
        (!pieces.before.length && !pieces.after.length)) {
      change((entry) => { entry.objects.find(({ id }) => id === target.id).featured = true; });
      return;
    }
    const lineage = target.blockId ?? id('block');
    const beforeId = pieces.before.length ? id('text') : null;
    const afterId = pieces.after.length ? id('text') : null;
    if (change((entry) => {
      const index = entry.objects.findIndex(({ id }) => id === target.id);
      const parts = [];
      if (beforeId) parts.push({ ...target, id: beforeId, blockId: lineage, content: pieces.before });
      parts.push({ ...target, blockId: lineage, featured: true, content: pieces.middle });
      if (afterId) parts.push({ ...target, id: afterId, blockId: lineage, content: pieces.after });
      entry.objects.splice(index, 1, ...parts);
    })) message('선택한 구절을 연출 객체로 만들었습니다.');
  }

  function dissolve() {
    const target = object();
    if (!target) return;
    change((entry) => {
      let index = entry.objects.findIndex(({ id }) => id === target.id);
      const item = entry.objects[index];
      item.featured = false;
      for (const key of ['x', 'y', 'width', 'height', 'minWidth', 'maxWidth', 'showFrom', 'showTo',
        'enterEnd', 'exitStart', 'enter', 'hold', 'exit']) delete item[key];
      if (!item.blockId) return;
      const compatible = (other) => other?.blockId === item.blockId && !other.featured &&
        ['kind', 'font', 'fontSize', 'align'].every((key) => other[key] === item[key]);
      if (compatible(entry.objects[index - 1])) {
        item.content.unshift(...entry.objects[index - 1].content);
        entry.objects.splice(--index, 1);
      }
      if (compatible(entry.objects[index + 1])) {
        item.content.push(...entry.objects[index + 1].content);
        entry.objects.splice(index + 1, 1);
      }
    });
  }

  function paste(event, editable, item) {
    event.preventDefault();
    if (composing || !event.clipboardData) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const where = selection.getRangeAt(0);
    if (!editable.contains(where.commonAncestorContainer)) return;
    const html = event.clipboardData.getData('text/html');
    const template = node('template');
    template.innerHTML = html;
    const parts = html ? readInline(template.content, baseUrl) :
      event.clipboardData.getData('text/plain').split(/\r?\n/).flatMap((line, index) => index ? [{ tag: 'br' }, line] : [line]);
    const fragment = document.createDocumentFragment();
    appendText(fragment, parts, baseUrl);
    const last = fragment.lastChild;
    where.deleteContents();
    where.insertNode(fragment);
    if (last) where.setStartAfter(last);
    where.collapse(true);
    selection.removeAllRanges();
    selection.addRange(where);
    updateText(editable, item);
  }

  function splitParagraph(event, editable, item) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing || isList(item.kind)) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const position = selection.getRangeAt(0);
    if (!editable.contains(position.commonAncestorContainer)) return;
    event.preventDefault();
    const { before, after } = splitSelection(editable, position, baseUrl);
    const nextId = id('text');
    if (change((entry) => {
      const index = entry.objects.findIndex(({ id }) => id === item.id);
      entry.objects[index].content = before.length ? before : [''];
      entry.objects.splice(index + 1, 0, { id: nextId, type: 'text',
        kind: item.kind === 'heading' ? 'paragraph' : item.kind,
        align: item.align, font: item.font, fontSize: item.fontSize, content: after.length ? after : [''] });
    }, { redraw: false })) {
      selected = nextId;
      render();
      editableForObject()?.focus();
    }
  }

  function updateText(editable, item) {
    if (!composing) change((entry) => {
      entry.objects.find(({ id }) => id === item.id).content = readText(editable, item, baseUrl);
    }, { redraw: false });
  }

  function activeObjects() {
    return group().objects.filter((item) => selectionSet.size ? selectionSet.has(item.id) : item.id === selected);
  }

  function copyScene(sceneId) {
    if (composing) return;
    const scene = work.groups.find((entry) => entry.id === sceneId);
    if (!scene) return;
    sceneClipboard = { value: structuredClone(scene), baseUrl };
    pasteSceneControl.disabled = false;
    message(scene.title + ' 장면을 복사했습니다.');
  }

  function copyObjects() {
    if (composing) return;
    const objects = activeObjects();
    if (!objects.length) return;
    objectClipboard = { value: structuredClone(objects), baseUrl };
    pasteObjectControl.disabled = false;
    message(objects.length + '개 객체를 복사했습니다.');
  }

  function duplicateObjects(objects, sourceBase) {
    const copies = sourceBase === baseUrl ? structuredClone(objects) :
      portableWork({ groups: [{ objects }] }, sourceBase).groups[0].objects;
    const blocks = new Map();
    for (const item of copies) {
      item.id = id('object');
      if (item.blockId) {
        if (!blocks.has(item.blockId)) blocks.set(item.blockId, id('block'));
        item.blockId = blocks.get(item.blockId);
      }
    }
    return copies;
  }

  function pasteScene(after = group().id) {
    if (composing || !sceneClipboard) return;
    const source = sceneClipboard.value;
    const scene = { ...source, id: id('scene'), title: source.title + ' (복사본)',
      objects: duplicateObjects(source.objects, sceneClipboard.baseUrl) };
    if (change((entry, next) => {
      const index = next.groups.findIndex(({ id }) => id === after);
      next.groups.splice(index + 1, 0, scene);
    }, { redraw: false })) {
      select(scene.id, null);
      render();
      focusScene(scene.id);
      message('장면 복사본을 붙여넣었습니다.');
    }
  }

  function pasteObjects() {
    if (composing || !objectClipboard) return;
    const copies = duplicateObjects(objectClipboard.value, objectClipboard.baseUrl);
    const anchor = activeObjects().at(-1);
    if (change((entry) => {
      const index = anchor ? entry.objects.findIndex((item) => item.id === anchor.id) : -1;
      entry.objects.splice(index === -1 ? entry.objects.length : index + 1, 0, ...copies);
    }, { redraw: false })) {
      select(groupId, copies[0].id);
      render();
      pickButton(copies[0].id)?.focus();
      message(copies.length + '개 객체를 붙여넣었습니다.');
    }
  }

  function focusScene(sceneId) {
    [...scenes.querySelectorAll('[data-scene]')].find((button) => button.dataset.scene === sceneId)?.focus();
  }

  function moveScene(sceneId, delta) {
    const from = work.groups.findIndex((entry) => entry.id === sceneId);
    if (from < 0 || !work.groups[from + delta]) return;
    if (change((entry, next) => {
      [next.groups[from], next.groups[from + delta]] = [next.groups[from + delta], next.groups[from]];
    })) focusScene(sceneId);
  }

  function deleteScene(sceneId) {
    const index = work.groups.findIndex((entry) => entry.id === sceneId);
    if (index < 0) return;
    const emptyScene = work.groups.length === 1 ? { id: id('scene'), title: '장면 1', objects: [] } : null;
    const title = work.groups[index].title;
    if (!change((entry, next) => {
      if (emptyScene) next.groups = [emptyScene];
      else next.groups.splice(index, 1);
    }, { redraw: false })) return;
    if (sceneId === groupId) select(work.groups[Math.min(index, work.groups.length - 1)].id, null);
    render();
    focusScene(groupId);
    message(title + ' 장면을 삭제했습니다. 실행 취소로 복구할 수 있습니다.');
  }

  function renderScenes() {
    sceneMenu.close();
    scenes.replaceChildren();
    node('h2', '장면', scenes);
    for (const [index, entry] of work.groups.entries()) {
      const row = node('div', undefined, scenes);
      row.className = 'wne-scene-row';
      const choice = button(row, entry.title, () => {
        select(entry.id, null);
        render();
        focusScene(entry.id);
      });
      choice.dataset.scene = entry.id;
      if (entry.id === groupId) choice.setAttribute('aria-current', 'true');
      const label = entry.title + ' 장면 메뉴';
      const trigger = button(row, '⋯', () => openMenu());
      trigger.setAttribute('aria-label', label);
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');

      function openMenu(point) {
        sceneMenu.toggle(trigger, label, [
          { label: '장면 선택', run: () => choice.click() },
          { label: '장면 위로', disabled: index === 0, run: () => moveScene(entry.id, -1) },
          { label: '장면 아래로', disabled: index === work.groups.length - 1, run: () => moveScene(entry.id, 1) },
          { label: '장면 복사', run: () => copyScene(entry.id) },
          { label: '장면 붙여넣기', disabled: !sceneClipboard, run: () => pasteScene(entry.id) },
          { label: '해당 장면 삭제', run: () => deleteScene(entry.id) },
        ], point);
      }
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openMenu(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        openMenu();
      });
    }
    button(scenes, '장면 추가', () => {
      const scene = { id: id('scene'), title: '장면 ' + (work.groups.length + 1), objects: [] };
      if (change((entry, next) => next.groups.push(scene), { redraw: false })) {
        select(scene.id, null);
        render();
        focusScene(scene.id);
      }
    });
    button(scenes, '해당 장면 삭제', () => deleteScene(group().id));
    pasteSceneControl = button(scenes, '장면 붙여넣기', () => pasteScene());
    pasteSceneControl.disabled = !sceneClipboard;
    for (const [delta, label] of [[-1, '장면 위로'], [1, '장면 아래로']]) {
      button(scenes, label, () => moveScene(group().id, delta)).disabled = !work.groups[work.groups.indexOf(group()) + delta];
    }
    field(scenes, '장면 이름', group().title, (title) => change((entry) => { entry.title = title; }));
    field(scenes, '자동 재생 (ms)', group().autoMs ?? 6000,
      (value) => change((entry) => { entry.autoMs = Number(value); }), { type: 'number' });
    field(scenes, '스크롤 길이', group().scrollVh,
      (value) => change((entry) => { entry.scrollVh = Number(value); }), { type: 'number' });
  }

  function renderDocument() {
    documentColumn.replaceChildren();
    field(documentColumn, '작품 제목', work.title, (value) =>
      change((entry, next) => { next.title = value; }, { redraw: false }));
    const toolbar = node('div', undefined, documentColumn);
    toolbar.className = 'wne-bar';
    button(toolbar, '문단 추가', addText);
    button(toolbar, '이미지 삽입', addImage);
    button(toolbar, '미디어 삽입', addMedia);
    for (const [tag, label] of [['strong', '굵게'], ['em', '기울임'], ['u', '밑줄']]) {
      button(toolbar, label, () => format(tag), true);
    }
    button(toolbar, '링크 삽입', () => linkForm(toolbar), true);
    button(toolbar, '연출 객체 만들기', feature, true);
    button(toolbar, '연출 해제', dissolve);
    copyObjectControl = button(toolbar, '객체 복사', copyObjects);
    pasteObjectControl = button(toolbar, '객체 붙여넣기', pasteObjects);
    groupActions = node('div', undefined, documentColumn);
    groupActions.className = 'wne-group-actions';

    for (const [index, item] of group().objects.entries()) {
      const row = node('div', undefined, documentColumn);
      row.className = 'wne-object';
      const head = node('div', undefined, row);
      head.className = 'wne-object-head';
      const selectButton = button(head, item.featured ? '연출 ' + (index + 1) : '객체 ' + (index + 1), () => openInspector(item.id));
      selectButton.dataset.pick = item.id;
      selectButton.setAttribute('aria-pressed', String(selected === item.id));
      selectButton.setAttribute('aria-controls', inspector.id);
      row.addEventListener('click', (event) => {
        if (!head.contains(event.target)) selectObject(item.id, true);
      });
      const selectionLabel = node('label', undefined, head);
      const checkbox = node('input', undefined, selectionLabel);
      checkbox.type = 'checkbox';
      checkbox.checked = selectionSet.has(item.id);
      node('span', '객체 선택', selectionLabel);
      checkbox.setAttribute('aria-label', selectButton.textContent + ' 선택');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectionSet.add(item.id);
        else selectionSet.delete(item.id);
        updateObjectCommands();
      });
      if (item.type === 'text') {
        const editable = node(textTag(item.kind), undefined, row);
        editable.className = 'wne-text';
        editable.contentEditable = 'true';
        editable.dataset.object = item.id;
        editable.setAttribute('aria-label', '본문 ' + (index + 1));
        editable.setAttribute('role', 'textbox');
        editable.setAttribute('aria-multiline', 'true');
        if (item.align) editable.style.textAlign = item.align;
        if (item.font) editable.style.fontFamily = item.font;
        if (item.fontSize) editable.style.fontSize = item.fontSize;
        appendText(editable, item.content, baseUrl);
        editable.addEventListener('focus', () => selectObject(item.id));
        editable.addEventListener('input', (event) => {
          if (!event.isComposing) updateText(editable, item);
        });
        editable.addEventListener('compositionstart', () => { composing = true; });
        editable.addEventListener('compositionend', () => {
          composing = false;
          updateText(editable, item);
        });
        editable.addEventListener('keydown', (event) => splitParagraph(event, editable, item));
        editable.addEventListener('beforeinput', (event) => {
          if (composing || !['historyUndo', 'historyRedo'].includes(event.inputType)) return;
          event.preventDefault();
          if (event.inputType === 'historyUndo') travel(past, future);
          else travel(future, past);
        });
        editable.addEventListener('paste', (event) => paste(event, editable, item));
        editable.addEventListener('drop', (event) => event.preventDefault());
        editable.addEventListener('click', (event) => {
          if (event.target.closest('a')) event.preventDefault();
        });
      } else if (item.type === 'image') {
        const image = node('img', undefined, row);
        image.alt = item.alt;
        image.src = assetUrl(item.src, baseUrl, 'image');
      } else {
        node('p', item.title, row);
      }
    }
    if (!group().objects.length) node('p', '문단이나 이미지를 추가해 장면을 작성하세요.', documentColumn);
  }

  function pickButton(id) {
    return [...documentColumn.querySelectorAll('[data-pick]')].find((button) => button.dataset.pick === id);
  }

  function selectObject(id, open = false) {
    if (selected === id && (!open || inspectorOpen)) return;
    if (selected !== id) range = undefined;
    selected = id;
    inspectorOpen = open;
    updateObjectCommands();
    renderInspector();
  }

  function openInspector(id) {
    selectObject(id, true);
    inspector.querySelector('h2')?.focus();
  }

  function closeInspector() {
    inspectorOpen = false;
    renderInspector();
    pickButton(selected)?.focus();
  }

  function updateObjectCommands() {
    const objects = activeObjects();
    copyObjectControl.disabled = !objects.length;
    pasteObjectControl.disabled = !objectClipboard;
    const choices = work.groups.filter(({ id }) => id !== groupId).map(({ id, title }) => [id, title]);
    groupActions.replaceChildren();
    groupActions.hidden = !choices.length || !objects.length;
    if (groupActions.hidden) return;
    const destination = field(groupActions, '이동할 장면', choices[0][0], null, { choices });
    button(groupActions, '선택한 객체 이동', () => {
      const ids = new Set(objects.map(({ id }) => id));
      if (change((entry, next) => {
        const target = next.groups.find(({ id }) => id === destination.value);
        target.objects.push(...entry.objects.filter(({ id }) => ids.has(id)));
        entry.objects = entry.objects.filter(({ id }) => !ids.has(id));
      }, { redraw: false })) {
        select(destination.value, objects[0].id);
        render();
      }
    });
  }

  function updateInspectorDisclosure(show) {
    for (const control of documentColumn.querySelectorAll('[data-pick]')) {
      const current = control.dataset.pick === selected;
      control.setAttribute('aria-pressed', String(current));
      control.setAttribute('aria-expanded', String(current && show));
    }
  }

  function renderInspector() {
    const item = object();
    const show = inspectorOpen && Boolean(item);
    inspector.hidden = !show;
    workspace.toggleAttribute('data-inspector-open', show);
    updateInspectorDisclosure(show);
    inspector.replaceChildren();
    if (!show) return;
    const heading = node('h2', '객체 속성', inspector);
    heading.tabIndex = -1;
    button(inspector, '속성 닫기', closeInspector);
    for (const [delta, label] of [[-1, '객체 위로'], [1, '객체 아래로']]) {
      button(inspector, label, () => change((entry) => {
        const from = entry.objects.findIndex(({ id }) => id === item.id);
        [entry.objects[from], entry.objects[from + delta]] = [entry.objects[from + delta], entry.objects[from]];
      })).disabled = !group().objects[group().objects.indexOf(item) + delta];
    }

    function update(key, value, choices, numeric = false, required = false) {
      let lastValue = value;
      const control = field(inspector, keyLabels[key], value, (edited) => {
        const success = change((entry) => {
          const target = entry.objects.find(({ id }) => id === item.id);
          if (key === 'kind') Object.assign(target, changeKind(target, edited));
          else target[key] = edited === '' && !required ? undefined : numeric ? Number(edited) : edited;
        }, { redraw: false });
        if (success) {
          lastValue = object()[key] ?? edited;
          renderDocument();
          updateObjectCommands();
          updateInspectorDisclosure(true);
        }
        control.value = lastValue ?? '';
      }, { choices, inputMode: numeric ? 'decimal' : undefined });
    }

    button(inspector, '객체 삭제', () => {
      if (change((entry) => { entry.objects = entry.objects.filter(({ id }) => id !== item.id); }, { redraw: false })) {
        selected = null;
        selectionSet.delete(item.id);
        render();
      }
    });

    const keyLabels = {
      kind: '본문 유형', align: '정렬', font: '글꼴', fontSize: '글자 크기', x: '가로 위치', y: '세로 위치',
      width: '너비', height: '높이', minWidth: '최소 표시 너비 (px)', maxWidth: '최대 표시 너비 (px)',
      showFrom: '표시 시작', showTo: '표시 종료', enterEnd: '등장 종료', exitStart: '퇴장 시작',
      enter: '등장 효과', hold: '유지 효과', exit: '퇴장 효과',
      src: '자산 URL', alt: '대체 텍스트', title: '미디어 제목', transcript: '대본', role: '소리 구분',
      videoId: 'YouTube 영상 ID', startS: '재생 시작 (초)', endS: '재생 종료 (초)', loop: '반복',
    };
    if (item.type === 'text') {
      update('kind', item.kind, kinds);
      update('align', item.align ?? 'start', [['start', '시작'], ['center', '가운데'], ['end', '끝'], ['justify', '양쪽']]);
      update('font', item.font);
      update('fontSize', item.fontSize);
    } else if (item.type === 'image') {
      update('src', item.src, null, false, true);
      update('alt', item.alt, null, false, true);
    } else {
      const source = item.type === 'youtube' ? 'videoId' : 'src';
      update(source, item[source], null, false, true);
      update('title', item.title);
      update('transcript', item.transcript);
      update('role', item.role, [['music', '배경음'], ['dialogue', '대사']]);
      update('startS', item.startS, null, true);
      update('endS', item.endS, null, true);
      update('loop', item.loop, loops);
    }
    for (const key of ['x', 'y', 'width', 'height']) update(key, item[key]);
    for (const key of ['minWidth', 'maxWidth', 'showFrom', 'showTo', 'enterEnd', 'exitStart']) update(key, item[key], null, true);
    for (const effect of ['enter', 'hold', 'exit']) update(effect, item[effect], viewEffects);
  }

  function render() {
    range = undefined;
    renderScenes();
    renderDocument();
    updateObjectCommands();
    renderInspector();
    updateCommands();
    queuePreview();
  }

  function keydown(event) {
    if (event.key === 'Escape' && inspectorOpen && inspector.contains(event.target)) {
      event.preventDefault();
      closeInspector();
      return;
    }
    if (event.isComposing || composing || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (!event.altKey && !event.shiftKey && ['c', 'v'].includes(key) &&
        !event.target.closest('input, select, textarea, [contenteditable]')) {
      const sceneId = event.target.closest('.wne-scene-row')?.querySelector('[data-scene]').dataset.scene;
      const inScene = scenes.contains(event.target);
      const inObjects = documentColumn.contains(event.target) || inspector.contains(event.target);
      if (inScene || inObjects) {
        event.preventDefault();
        if (inScene) {
          if (key === 'c') copyScene(sceneId ?? groupId);
          else pasteScene(sceneId);
        } else if (key === 'c') copyObjects();
        else pasteObjects();
      }
      return;
    }
    if (event.altKey || !['z', 'y', 'b', 'i', 'u'].includes(key)) return;
    if (event.target.matches('input, select, textarea')) return;
    event.preventDefault();
    if (key === 'y' || key === 'z' && event.shiftKey) travel(future, past);
    else if (key === 'z') travel(past, future);
    else {
      rememberSelection();
      format({ b: 'strong', i: 'em', u: 'u' }[key]);
    }
  }

  function resizePreview() {
    previewHost.style.width = Math.max(200, Number(previewWidth.value) || 768) + 'px';
    previewHost.style.setProperty('--wnv-height', Math.max(180, Number(previewHeight.value) || 400) + 'px');
  }

  function togglePreview() {
    previewHost.hidden = !previewHost.hidden;
    previewButton.textContent = previewHost.hidden ? '미리보기 열기' : '미리보기 닫기';
    previewButton.setAttribute('aria-expanded', String(!previewHost.hidden));
    if (previewHost.hidden) {
      preview?.destroy();
      preview = undefined;
    } else {
      resizePreview();
      queuePreview();
    }
  }

  function queuePreview() {
    window.clearTimeout(previewTimer);
    if (previewHost.hidden || controller.signal.aborted) return;
    previewTimer = window.setTimeout(async () => {
      try {
        const { mountViewer } = await import('../viewer/viewer.js');
        if (previewHost.hidden || controller.signal.aborted) return;
        preview?.destroy();
        const next = mountViewer(previewHost, work, { assetBaseUrl: baseUrl });
        preview = next;
        await next.ready;
        if (preview === next) next.seek(groupId);
      } catch (error) {
        if (error.name !== 'AbortError') errorMessage(error);
      }
    }, 220);
  }

  function accept(next, nextBase) {
    past.push(snapshot());
    future.length = 0;
    work = next;
    baseUrl = nextBase;
    select(work.groups[0].id, null);
    revision++;
    render();
  }

  async function loadFromHost(initial = false) {
    if (controller.signal.aborted || loading || saving || composing) return false;
    loading = true;
    const before = revision;
    updateCommands();
    try {
      const result = await loadEditorWork(options, document, controller.signal);
      if (controller.signal.aborted) return false;
      if (before !== revision || composing) {
        message('불러오는 중 수정한 내용을 유지했습니다. 필요하면 다시 불러오세요.');
        return false;
      }
      accept(result.work, result.baseUrl);
      if (initial) past.length = 0;
      savedRevision = revision;
      message('작품을 불러왔습니다.');
      return true;
    } catch (error) {
      if (!controller.signal.aborted) message('불러오기 실패 · ' + error.message);
      return false;
    } finally {
      loading = false;
      if (!controller.signal.aborted) updateCommands();
    }
  }

  async function save() {
    if (controller.signal.aborted || saving || loading || composing || !(options.postUrl || options.save)) return false;
    const before = revision;
    saving = true;
    updateCommands();
    try {
      await saveEditorWork(options, document, structuredClone(work), controller.signal);
      if (controller.signal.aborted) return false;
      savedRevision = before;
      message(revision === before ? '서버에 저장했습니다.' : '이전 편집본을 저장했습니다. 새 변경 사항은 아직 남아 있습니다.');
      return true;
    } catch (error) {
      if (!controller.signal.aborted) message('저장 실패 · 편집 내용을 유지했습니다. ' + error.message);
      return false;
    } finally {
      saving = false;
      if (!controller.signal.aborted) updateCommands();
    }
  }

  function importText(input) {
    const nextBase = new URL(options.assetBaseUrl ?? baseUrl, document.baseURI).href;
    const next = parseWork(input, { document, baseUrl: nextBase });
    accept(next, nextBase);
  }

  file.addEventListener('change', async () => {
    const selectedFile = file.files[0];
    if (!selectedFile) return;
    const before = revision;
    try {
      const text = await selectedFile.text();
      if (controller.signal.aborted || before !== revision || composing) return;
      importText(text);
      message('파일을 열었습니다.');
    } catch (error) {
      errorMessage(error);
    } finally {
      file.value = '';
    }
  });

  function exportWork() {
    return portableWork(work, baseUrl);
  }

  function showJson() {
    if (composing) return;
    root.querySelector('.wne-copy')?.remove();
    const panel = node('section', undefined, root);
    panel.className = 'wne-copy';
    const text = node('textarea', undefined, panel);
    text.setAttribute('aria-label', '복사할 작품 JSON');
    text.readOnly = true;
    text.value = JSON.stringify(exportWork(), null, 2);
    button(panel, '닫기', () => panel.remove());
    text.focus();
    text.select();
  }

  function download() {
    if (composing) return;
    try {
      const blob = new Blob([JSON.stringify(exportWork(), null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = node('a', undefined, root);
      link.href = url;
      link.download = 'web-novel-v1.json';
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      message('JSON 사본을 내보냈습니다.');
    } catch {
      message('이 환경에서 파일을 내려받을 수 없습니다. 아래에서 JSON을 복사할 수 있습니다.');
      showJson();
    }
  }

  function writeDraft(automatic = false) {
    if (composing || automatic && revision === draftRevision) return false;
    try {
      if (!draftKey) throw new Error('작품별 임시 저장 키가 필요합니다.');
      window.localStorage.setItem(draftKey, JSON.stringify({ work, baseUrl }));
      draftRevision = revision;
      if (!automatic) message('이 브라우저에 임시 저장했습니다.');
      updateCommands();
      return true;
    } catch {
      auto.checked = false;
      window.clearInterval(draftTimer);
      message('임시 저장을 사용할 수 없습니다. JSON 사본 또는 호스트 저장을 이용하세요.');
      return false;
    }
  }

  function restoreDraft() {
    if (controller.signal.aborted || composing) return false;
    try {
      const raw = draftKey && window.localStorage.getItem(draftKey);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const restoredBase = assetUrl(data.baseUrl, document.baseURI, 'baseUrl');
      accept(validateWork(data.work, { baseUrl: restoredBase }), restoredBase);
      draftRevision = revision;
      message('임시 저장본을 복구했습니다.');
      return true;
    } catch {
      message('임시 저장본을 읽을 수 없습니다. 현재 편집 내용을 유지했습니다.');
      return false;
    }
  }

  auto.addEventListener('change', () => {
    window.clearInterval(draftTimer);
    if (auto.checked && writeDraft(true)) {
      draftTimer = window.setInterval(() => writeDraft(true), options.draftIntervalMs ?? 15000);
      message('주기적 임시 저장을 켰습니다.');
    } else if (auto.checked && revision === draftRevision) {
      draftTimer = window.setInterval(() => writeDraft(true), options.draftIntervalMs ?? 15000);
      message('주기적 임시 저장을 켰습니다.');
    } else if (!auto.checked && revision === draftRevision) {
      message('주기적 임시 저장을 껐습니다.');
    }
  });

  const handle = {
    ready: undefined,
    exportWork,
    load: () => loadFromHost(),
    save,
    restoreDraft,
    destroy() {
      controller.abort();
      document.removeEventListener('selectionchange', rememberSelection);
      root.removeEventListener('keydown', keydown);
      window.clearTimeout(previewTimer);
      window.clearInterval(draftTimer);
      preview?.destroy();
      root.remove();
      if (mounted.get(container) === handle) mounted.delete(container);
    },
  };
  mounted.set(container, handle);
  root.addEventListener('keydown', keydown);
  document.addEventListener('selectionchange', rememberSelection);
  render();
  handle.ready = options.source !== undefined || options.getUrl || options.load
    ? loadFromHost(true) : Promise.resolve(true);
  return handle;
}
