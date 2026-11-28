import { assetUrl } from './model.js';

export function isMedia(object) {
  return object.type === 'audio' || object.type === 'video' || object.type === 'youtube';
}

function create(document, tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function nativeMedia(slot, object, baseUrl, { status, strings, onPlay }) {
  const media = create(slot.ownerDocument, object.type);
  media.controls = true;
  media.preload = 'none';
  media.loop = object.loop === 'full';
  media.setAttribute('aria-label', object.title);
  if (object.type === 'video') media.playsInline = true;
  slot.append(media);

  const start = object.loop === 'full' ? 0 : object.startS;
  const end = object.loop === 'full' ? undefined : object.endS;
  let active = false;
  let rangeValid = true;
  let reachedEnd = false;

  function confirmStart() {
    if (!active) return;
    if (Number.isFinite(media.duration) && start >= media.duration) {
      rangeValid = false;
      media.pause();
      status(strings.badRange);
      return;
    }
    if (media.currentTime + 0.005 < start) media.currentTime = start;
  }

  media.addEventListener('loadedmetadata', confirmStart);
  media.addEventListener('seeked', confirmStart);
  media.addEventListener('playing', () => {
    if (!active || !rangeValid) {
      media.pause();
      return;
    }
    if (reachedEnd || (end !== undefined && media.currentTime >= end)) {
      reachedEnd = false;
      media.currentTime = start;
    }
    confirmStart();
    if (rangeValid) onPlay();
  });
  media.addEventListener('timeupdate', () => {
    if (!active || !rangeValid || media.paused || end === undefined || media.currentTime < end) return;
    if (object.loop === 'segment') {
      media.currentTime = start;
    } else {
      reachedEnd = true;
      media.pause();
      media.currentTime = end;
    }
  });
  media.addEventListener('ended', () => {
    if (!active || !rangeValid || object.loop !== 'segment') return;
    media.currentTime = start;
    media.play()?.catch(() => {
      if (active) status(strings.mediaBlocked);
    });
  });
  media.addEventListener('error', () => {
    if (active && media.error) status(strings.mediaUnavailable);
  });

  return {
    activate() {
      active = true;
      rangeValid = true;
      reachedEnd = false;
      status('');
      media.src = assetUrl(object.src, baseUrl, object.id);
      if (start) media.currentTime = start;
    },
    deactivate() {
      active = false;
      media.pause();
      media.removeAttribute('src');
      media.load();
    },
    pause: () => media.pause(),
    setMix({ volume, muted }) {
      media.volume = volume;
      media.muted = muted;
    },
  };
}

function youtubeMedia(slot, object, { status, strings, onPlay }) {
  const button = create(slot.ownerDocument, 'button', strings.youtubeLoad);
  button.type = 'button';
  const holder = create(slot.ownerDocument, 'div');
  holder.className = 'wnv-youtube-player';
  holder.hidden = true;
  const link = create(slot.ownerDocument, 'a', strings.youtubeLink);
  link.href = `https://www.youtube.com/watch?v=${object.videoId}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.hidden = true;
  slot.append(button, holder, link);

  let attempt;
  let player;
  let mix = { volume: 1, muted: false };

  const reset = () => {
    attempt?.abort();
    attempt = undefined;
    player?.destroy();
    player = undefined;
    holder.replaceChildren();
    holder.hidden = true;
    button.hidden = false;
    button.disabled = false;
  };

  button.addEventListener('click', async () => {
    link.hidden = false;
    if (slot.clientWidth < 200) {
      status(strings.youtubeNarrow);
      return;
    }
    button.disabled = true;
    status(strings.youtubeLoading);
    const controller = new AbortController();
    attempt = controller;
    try {
      const { mountYouTube } = await import('./youtube.js');
      if (controller.signal.aborted) return;
      holder.hidden = false;
      const mounted = await mountYouTube(holder, object, {
        signal: controller.signal,
        onPlay,
        onBlocked: () => status(strings.youtubeBlocked),
        onHidden: () => status(strings.youtubeNarrow),
        onError: () => {
          reset();
          status(strings.youtubeUnavailable);
        },
        onReady: () => status(''),
      });
      if (controller.signal.aborted || attempt !== controller) {
        mounted.destroy();
        return;
      }
      player = mounted;
      player.setMix(mix);
      button.hidden = true;
    } catch {
      if (!controller.signal.aborted) {
        reset();
        status(strings.youtubeUnavailable);
      }
    }
  });

  return {
    activate() { status(''); },
    deactivate() {
      reset();
      link.hidden = true;
    },
    pause() {
      if (attempt && !player) {
        reset();
        status('');
      } else {
        player?.pause();
      }
    },
    setMix(value) {
      mix = value;
      player?.setMix(mix);
    },
  };
}

export function appendTranscript(container, object, strings) {
  if (!object.transcript) return;
  const document = container.ownerDocument;
  const details = create(document, 'details');
  details.append(create(document, 'summary', strings.transcript), create(document, 'p', object.transcript));
  container.append(details);
}

export function createMedia(panel, object, baseUrl, { strings, onPlay }) {
  const document = panel.ownerDocument;
  panel.classList.add('wnv-media');
  panel.append(create(document, 'figcaption', object.title));
  const slot = create(document, 'div');
  const message = create(document, 'p');
  message.className = 'wnv-media-message';
  message.setAttribute('role', 'status');
  message.hidden = true;
  panel.append(slot, message);
  appendTranscript(panel, object, strings);
  const status = (text) => {
    message.textContent = text;
    message.hidden = !text;
  };
  return object.type === 'youtube'
    ? youtubeMedia(slot, object, { status, strings, onPlay })
    : nativeMedia(slot, object, baseUrl, { status, strings, onPlay });
}
