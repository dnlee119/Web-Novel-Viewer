import { iconButton } from '../ui/icon.js';
import { assetUrl } from './model.js';
import { appendTranscript, createMedia, isMedia } from './media.js';
import { readWork } from './source.js';
import { appendText, textTag } from './text.js';
import { groupRanges, objectState, offsetAt, positionAt, timeRanges } from './timeline.js';

const stylesheet = new URL('./viewer.css', import.meta.url).href;
const activeMounts = new WeakMap();
const pendingMounts = new WeakMap();

const labels = {
  ko: {
    chapter: '장면', original: '원문 보기', effects: '효과 끄기',
    play: '자동 재생', pause: '일시정지', previous: '이전 장면', next: '다음 장면', speed: '속도',
    sound: '소리 설정', music: '배경음', dialogue: '대사', volume: '음량', mute: '음소거',
    transcript: '대본 보기', badRange: '지정한 시작 위치가 미디어 길이를 넘습니다.',
    mediaBlocked: '미디어에서 재생을 다시 눌러 주세요.',
    mediaUnavailable: '미디어를 재생할 수 없습니다. 지원하는 형식과 주소를 확인해 주세요.',
    youtubeLoad: 'YouTube 재생', youtubeLoading: 'YouTube를 불러오는 중입니다.',
    youtubeLink: 'YouTube에서 보기', youtubeUnavailable: 'YouTube 임베드를 재생할 수 없습니다.',
    youtubeBlocked: '플레이어에서 재생을 눌러 주세요.',
    youtubeNarrow: '플레이어가 화면에 충분히 보여야 재생할 수 있습니다.',
    loading: '작품을 불러오는 중입니다.', error: '작품을 불러올 수 없습니다.',
  },
  en: {
    chapter: 'Scenes', original: 'Read original', effects: 'Disable effects',
    play: 'Auto play', pause: 'Pause', previous: 'Previous scene', next: 'Next scene', speed: 'Speed',
    sound: 'Sound settings', music: 'Music', dialogue: 'Dialogue', volume: 'volume', mute: 'mute',
    transcript: 'Read transcript', badRange: 'The start time exceeds the media duration.',
    mediaBlocked: 'Press play in the media player.',
    mediaUnavailable: 'Media unavailable. Check its format and address.',
    youtubeLoad: 'Play on YouTube', youtubeLoading: 'Loading YouTube.',
    youtubeLink: 'Open on YouTube', youtubeUnavailable: 'The YouTube embed could not play.',
    youtubeBlocked: 'Press play in the YouTube player.',
    youtubeNarrow: 'More of the player must be visible to play.',
    loading: 'Loading story.', error: 'Could not load the story.',
  },
};

function element(document, tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function createStoryObject(document, object, baseUrl) {
  let node;
  if (object.type === 'text') {
    node = element(document, textTag(object.kind), 'wnv-text');
    appendText(node, object.content, baseUrl);
    if (object.align) node.style.textAlign = object.align;
    if (object.font) node.style.fontFamily = object.font;
    if (object.fontSize) node.style.setProperty('--wnv-object-font-size', object.fontSize);
  } else if (object.type === 'image') {
    node = element(document, 'figure', 'wnv-image');
    const image = element(document, 'img');
    image.alt = object.alt;
    const fallback = element(document, 'span', 'wnv-image-fallback', object.alt);
    fallback.hidden = true;
    image.addEventListener('error', () => {
      image.hidden = true;
      fallback.hidden = !object.alt;
    }, { once: true });
    image.src = assetUrl(object.src, baseUrl, object.id);
    node.append(image, fallback);
  } else {
    node = element(document, 'figure');
  }

  node.classList.add('wnv-object');
  node.dataset.objectId = object.id;
  if (object.x !== undefined || object.y !== undefined) node.classList.add('wnv-placed');
  for (const field of ['x', 'y', 'width', 'height']) {
    if (object[field] !== undefined) node.style.setProperty(`--wnv-object-${field}`, object[field]);
  }
  return node;
}

function fillOriginal(article, work, strings, baseUrl) {
  const document = article.ownerDocument;
  for (const group of work.groups) {
    const section = element(document, 'section', 'wnv-original-group');
    section.append(element(document, 'h2', null, group.title));
    for (const item of group.objects) {
      if (item.type === 'text') {
        const paragraph = element(document, textTag(item.kind));
        appendText(paragraph, item.content, baseUrl);
        if (item.align) paragraph.style.textAlign = item.align;
        section.append(paragraph);
      } else if (item.type === 'image' && item.alt) {
        section.append(element(document, 'p', 'wnv-original-image', item.alt));
      } else if (isMedia(item)) {
        section.append(element(document, 'p', 'wnv-original-image', item.title));
        appendTranscript(section, item, strings);
      }
    }
    article.append(section);
  }
}

const icons = {
  play: 'M7 3l14 9-14 9z', pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  previous: 'M5 5v14m14-14-11 7 11 7z', next: 'M19 5v14M5 5l11 7-11 7z',
  original: 'M12 6Q7 3 2 5v14q5-2 10 1 5-3 10-1V5q-5-2-10 1zm0 0v14',
  effects: 'm4 20 11-11 3 3L7 23zM5 3v6M2 6h6m11-5v6m-3-3h6',
  mute: 'M3 9h4l5-5v16l-5-5H3zm13 1 5 5m0-5-5 5',
};

function messages(locale, overrides) {
  return { ...(locale.toLowerCase().split('-')[0] === 'ko' ? labels.ko : labels.en), ...overrides };
}

function createView(document, work, baseUrl, options) {
  const window = document.defaultView;
  const strings = messages(options.locale || work.lang, options.messages?.viewer);
  const timed = timeRanges(work.groups);
  const duration = timed.at(-1).end;
  const mixes = new Map();
  const host = element(document, 'div', 'wnv-host');
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  const style = element(document, 'link');
  style.rel = 'stylesheet';
  style.href = stylesheet;

  const viewer = element(document, 'section', 'wnv');
  viewer.lang = work.lang;
  viewer.setAttribute('aria-label', work.title);
  const toolbar = element(document, 'div', 'wnv-toolbar');
  const navigation = element(document, 'nav', 'wnv-navigation');
  navigation.setAttribute('aria-label', strings.chapter);
  const buttons = work.groups.map((group) => {
    const button = element(document, 'button', 'wnv-chapter', group.title);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (!original.hidden) toggleOriginal();
      seek(group.id);
    });
    navigation.append(button);
    return button;
  });

  const controls = element(document, 'div', 'wnv-controls');
  const originalButton = element(document, 'button', 'wnv-control', strings.original);
  const effectsButton = element(document, 'button', 'wnv-control', strings.effects);
  for (const button of [originalButton, effectsButton]) {
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    controls.append(button);
  }
  iconButton(originalButton, icons.original, strings.original);
  iconButton(effectsButton, icons.effects, strings.effects);
  toolbar.append(navigation, controls);

  const playback = element(document, 'div', 'wnv-playback');
  const previousButton = element(document, 'button', 'wnv-control', strings.previous);
  const playButton = element(document, 'button', 'wnv-control wnv-play', strings.play);
  const nextButton = element(document, 'button', 'wnv-control', strings.next);
  for (const button of [previousButton, playButton, nextButton]) button.type = 'button';
  iconButton(previousButton, icons.previous, strings.previous);
  iconButton(playButton, icons.play, strings.play);
  iconButton(nextButton, icons.next, strings.next);
  toolbar.lang = playback.lang = options.locale || work.lang;
  navigation.lang = work.lang;
  const speedLabel = element(document, 'label', 'wnv-speed', strings.speed);
  const speedSelect = element(document, 'select');
  for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const option = element(document, 'option', null, `${rate}×`);
    option.value = String(rate);
    speedSelect.append(option);
  }
  speedSelect.value = '1';
  speedLabel.append(speedSelect);
  playback.append(previousButton, playButton, nextButton, speedLabel);

  const roles = new Set(work.groups.flatMap((group) => group.objects.filter(isMedia).map(({ role }) => role)));
  if (roles.size) {
    const mixer = element(document, 'details', 'wnv-mixer');
    mixer.append(element(document, 'summary', null, strings.sound));
    for (const role of roles) {
      const mix = { volume: 1, muted: false };
      mixes.set(role, mix);
      const row = element(document, 'div', 'wnv-mixer-row');
      const volume = element(document, 'label', 'wnv-volume', `${strings[role]} ${strings.volume}`);
      const range = element(document, 'input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = '100';
      range.addEventListener('input', () => {
        mix.volume = Number(range.value) / 100;
        updateMix(role);
      });
      volume.append(range);
      const mute = element(document, 'button', 'wnv-control', `${strings[role]} ${strings.mute}`);
      mute.type = 'button';
      iconButton(mute, icons.mute, mute.textContent);
      mute.setAttribute('aria-pressed', 'false');
      mute.addEventListener('click', () => {
        mix.muted = !mix.muted;
        mute.setAttribute('aria-pressed', String(mix.muted));
        updateMix(role);
      });
      row.append(volume, mute);
      mixer.append(row);
    }
    playback.append(mixer);
  }

  const meter = element(document, 'div', 'wnv-meter');
  meter.setAttribute('aria-hidden', 'true');
  const meterFill = element(document, 'div', 'wnv-meter-fill');
  meter.append(meterFill);
  const viewport = element(document, 'div', 'wnv-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', work.title);
  const track = element(document, 'div', 'wnv-track');
  const stage = element(document, 'div', 'wnv-stage');
  const scene = element(document, 'div', 'wnv-scene');
  const runway = element(document, 'div', 'wnv-runway');
  runway.setAttribute('aria-hidden', 'true');
  stage.append(scene);
  track.append(stage, runway);
  viewport.append(track);
  const original = element(document, 'article', 'wnv-original');
  original.hidden = true;
  original.tabIndex = 0;
  original.setAttribute('aria-label', `${work.title} · ${strings.original}`);
  viewer.append(toolbar, playback, meter, viewport, original);
  root.append(style, viewer);

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let effectsOff = false;
  let frame = 0;
  let playbackFrame = 0;
  let playing = false;
  let speed = 1;
  let anchorTime = 0;
  let anchorElapsed = 0;
  let expectedScroll = 0;
  let ranges = [];
  let location;
  let viewportWidth = 0;
  let entries = [];
  let observer;

  function updateMix(role) {
    for (const entry of entries) {
      if (entry.media && entry.object.role === role) entry.media.setMix(mixes.get(role));
    }
  }

  function clearScene() {
    for (const entry of entries) {
      if (entry.active) entry.media?.deactivate();
      entry.node.querySelector('img')?.removeAttribute('src');
    }
  }

  function buildScene(group) {
    clearScene();
    entries = group.objects.map((object) => {
      const node = createStoryObject(document, object, baseUrl);
      const entry = { object, node, active: false };
      if (isMedia(object)) {
        entry.media = createMedia(node, object, baseUrl, {
          strings,
          onPlay() {
            for (const other of entries) {
              if (other.active && other !== entry && (object.type === 'youtube' || other.object.type === 'youtube')) {
                other.media?.pause();
              }
            }
          },
        });
        entry.media.setMix(mixes.get(object.role));
      }
      return entry;
    });
    scene.replaceChildren(...entries.map(({ node }) => node));
  }

  function render() {
    if (!ranges.length || viewport.hidden) return;
    const offset = viewport.scrollTop;
    const position = positionAt(ranges, offset);
    if (position.group !== location?.group) {
      buildScene(position.group);
      scene.dataset.groupId = position.group.id;
      work.groups.forEach((group, index) => {
        if (group === position.group) buttons[index].setAttribute('aria-current', 'step');
        else buttons[index].removeAttribute('aria-current');
      });
      previousButton.disabled = position.group === work.groups[0];
      nextButton.disabled = position.group === work.groups.at(-1);
    }
    location = position;
    const motion = !effectsOff && !reducedMotion?.matches;
    for (const entry of entries) {
      const { object, node, media } = entry;
      const state = objectState(object, position.progress, viewportWidth, motion);
      node.hidden = !state.visible;
      if (media && entry.active !== state.visible) {
        entry.active = state.visible;
        if (state.visible) media.activate();
        else media.deactivate();
      }
      if (state.visible) {
        node.style.opacity = state.opacity;
        node.style.transform = state.translate ? `translateY(${state.translate}px)` : '';
      }
    }
    meterFill.style.transform = `scaleX(${Math.min(1, offset / ranges.at(-1).end)})`;
  }

  function scheduleRender() {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function measure() {
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height) return;
    viewportWidth = width;
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    stage.classList.toggle('wnv-compact', width < 48 * rootFontSize || height < 22.5 * rootFontSize);
    stage.style.height = `${height}px`;
    ranges = groupRanges(work.groups, height);
    runway.style.height = `${ranges.at(-1).end}px`;
    if (location) setScroll(offsetAt(ranges, location.group.id, location.progress));
    scheduleRender();
  }

  function setScroll(offset) {
    viewport.scrollTop = offset;
    expectedScroll = viewport.scrollTop;
  }

  function seek(groupId, progress = 0) {
    if (!ranges.length) measure();
    if (offsetAt(ranges, groupId, progress) === null) return false;
    pause();
    if (viewport.hidden) toggleOriginal();
    setScroll(offsetAt(ranges, groupId, progress));
    render();
    return true;
  }

  function toggleOriginal() {
    const show = original.hidden;
    if (show) {
      pause();
      for (const entry of entries) {
        if (entry.active) entry.media?.deactivate();
        entry.active = false;
      }
      if (!original.childElementCount) fillOriginal(original, work, strings, baseUrl);
    }
    original.hidden = !show;
    viewport.hidden = show;
    originalButton.setAttribute('aria-pressed', String(show));
    if (!show) measure();
  }

  function elapsedAt(time) {
    return Math.min(duration, anchorElapsed + (time - anchorTime) * speed);
  }

  function advance(time) {
    const elapsed = elapsedAt(time);
    const position = positionAt(timed, elapsed);
    setScroll(offsetAt(ranges, position.group.id, position.progress));
    render();
    if (elapsed === duration) pause();
    else playbackFrame = window.requestAnimationFrame(advance);
  }

  function play() {
    if (playing || document.hidden) return false;
    if (!original.hidden) toggleOriginal();
    if (!ranges.length) measure();
    if (!ranges.length) return false;
    const position = positionAt(ranges, viewport.scrollTop);
    anchorElapsed = offsetAt(timed, position.group.id, position.progress);
    if (anchorElapsed === duration) anchorElapsed = 0;
    anchorTime = window.performance.now();
    expectedScroll = viewport.scrollTop;
    playing = true;
    iconButton(playButton, icons.pause, strings.pause);
    playbackFrame = window.requestAnimationFrame(advance);
    return true;
  }

  function pause() {
    if (!playing) return false;
    playing = false;
    window.cancelAnimationFrame(playbackFrame);
    iconButton(playButton, icons.play, strings.play);
    return true;
  }

  function onScroll() {
    if (playing) {
      if (Math.abs(viewport.scrollTop - expectedScroll) <= 0.5) return;
      pause();
    }
    scheduleRender();
  }

  function onKeyDown(event) {
    if (event.target !== viewport) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pause();
  }

  function onVisibilityChange() {
    if (!document.hidden) return;
    pause();
    for (const entry of entries) {
      if (entry.active) entry.media?.pause();
    }
  }

  function moveScene(direction) {
    const index = work.groups.indexOf(location?.group ?? work.groups[0]) + direction;
    if (work.groups[index]) seek(work.groups[index].id);
  }

  previousButton.disabled = true;
  nextButton.disabled = work.groups.length === 1;
  previousButton.addEventListener('click', () => moveScene(-1));
  nextButton.addEventListener('click', () => moveScene(1));
  playButton.addEventListener('click', () => playing ? pause() : play());
  speedSelect.addEventListener('change', () => {
    if (playing) {
      const now = window.performance.now();
      anchorElapsed = elapsedAt(now);
      anchorTime = now;
    }
    speed = Number(speedSelect.value);
  });

  originalButton.addEventListener('click', toggleOriginal);
  effectsButton.addEventListener('click', () => {
    effectsOff = !effectsOff;
    effectsButton.setAttribute('aria-pressed', String(effectsOff));
    scheduleRender();
  });

  function start() {
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', pause, { passive: true });
    viewport.addEventListener('touchmove', pause, { passive: true });
    viewport.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('resize', measure);
    style.addEventListener('load', measure);
    if (window.ResizeObserver) {
      observer = new window.ResizeObserver(measure);
      observer.observe(viewport);
    }
    reducedMotion?.addEventListener?.('change', scheduleRender);
    measure();
  }

  function destroy() {
    pause();
    viewport.removeEventListener('scroll', onScroll);
    viewport.removeEventListener('wheel', pause);
    viewport.removeEventListener('touchmove', pause);
    viewport.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', measure);
    style.removeEventListener('load', measure);
    reducedMotion?.removeEventListener?.('change', scheduleRender);
    observer?.disconnect();
    window.cancelAnimationFrame(frame);
    clearScene();
    host.remove();
  }

  return { element: host, start, seek, play, pause, destroy };
}

export function mountViewer(container, source, options = {}) {
  if (container?.nodeType !== 1) throw new TypeError('mountViewer requires a DOM container');
  const document = container.ownerDocument;
  const strings = messages(options.locale || document.documentElement.lang, options.messages?.viewer);
  pendingMounts.get(container)?.destroy();
  const controller = new AbortController();
  const status = element(document, 'p', 'wnv-status', strings.loading);
  status.setAttribute('role', 'status');
  container.append(status);
  let view;
  const handle = {
    ready: undefined,
    seek: (groupId, progress) => view?.seek(groupId, progress) ?? false,
    play: () => view?.play() ?? false,
    pause: () => view?.pause() ?? false,
    destroy() {
      controller.abort();
      if (pendingMounts.get(container) === handle) pendingMounts.delete(container);
      if (activeMounts.get(container) === handle) activeMounts.delete(container);
      status.remove();
      view?.destroy();
      view = undefined;
    },
  };
  pendingMounts.set(container, handle);
  handle.ready = (async () => {
    try {
      const { work, baseUrl } = await readWork(source, {
        document, signal: controller.signal, assetBaseUrl: options.assetBaseUrl,
      });
      if (controller.signal.aborted) throw new DOMException('Viewer was unmounted', 'AbortError');
      view = createView(document, work, baseUrl, options);
      activeMounts.get(container)?.destroy();
      status.replaceWith(view.element);
      pendingMounts.delete(container);
      activeMounts.set(container, handle);
      view.start();
    } catch (error) {
      if (!controller.signal.aborted) {
        status.setAttribute('role', 'alert');
        status.textContent = `${strings.error} ${error.message}`;
      }
      throw error;
    }
  })();
  return handle;
}
