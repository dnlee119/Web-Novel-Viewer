const apiScript = 'https://www.youtube.com/iframe_api';
const loading = new WeakMap();

function loadApi(document) {
  const window = document.defaultView;
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading.has(document)) return loading.get(document);

  const existing = [...document.scripts].find((script) => script.src === apiScript);
  const script = existing ?? document.createElement('script');
  const request = new Promise((resolve, reject) => {
    const interval = window.setInterval(() => {
      if (window.YT?.Player) {
        cleanup();
        resolve(window.YT);
      }
    }, 50);
    const timeout = window.setTimeout(fail, 12000);

    function cleanup() {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      script.removeEventListener('error', fail);
      loading.delete(document);
    }

    function fail() {
      cleanup();
      if (!existing) script.remove();
      reject(new Error('YouTube player API unavailable'));
    }

    script.addEventListener('error', fail);
    if (!existing) {
      script.src = apiScript;
      script.async = true;
      document.head.append(script);
    }
  });
  loading.set(document, request);
  return request;
}

export async function mountYouTube(holder, media, callbacks) {
  const document = holder.ownerDocument;
  const window = document.defaultView;
  const { signal } = callbacks;
  if (!window.IntersectionObserver) throw new Error('Player visibility cannot be checked');
  const YT = await loadApi(document);
  if (signal.aborted) throw new DOMException('Player was closed', 'AbortError');

  const clip = { videoId: media.videoId, startSeconds: media.loop === 'full' ? 0 : media.startS };
  if (media.loop !== 'full' && media.endS !== undefined) clip.endSeconds = media.endS;
  const url = new URL(`https://www.youtube.com/embed/${media.videoId}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('playsinline', '1');
  if (window.location.origin !== 'null') url.searchParams.set('origin', window.location.origin);
  const frame = document.createElement('iframe');
  frame.title = media.title;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = url.href;
  holder.append(frame);

  return new Promise((resolve, reject) => {
    let player;
    let initial = true;
    let visible = false;
    let disposed = false;
    let atBoundary = false;
    let timer;
    let observer;
    const timeout = window.setTimeout(() => fail(new Error('YouTube player timed out')), 12000);

    const destroy = () => {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(timeout);
      window.clearInterval(timer);
      observer?.disconnect();
      signal.removeEventListener('abort', abort);
      player?.destroy();
      frame.remove();
    };

    function fail(error) {
      destroy();
      if (initial) reject(error);
      else callbacks.onError();
    }

    function abort() {
      destroy();
      reject(new DOMException('Player was closed', 'AbortError'));
    }

    const repeatOrPause = () => {
      if (atBoundary) return;
      atBoundary = true;
      if (media.loop !== 'none' && visible && !document.hidden) player.loadVideoById(clip);
      else player.pauseVideo();
    };
    signal.addEventListener('abort', abort, { once: true });
    observer = new window.IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio > 0.5 && entry.boundingClientRect.width >= 200;
      if (!visible && !initial && !disposed) player.pauseVideo();
    }, { threshold: [0, 0.5, 0.51] });
    observer.observe(frame);

    try {
      player = new YT.Player(frame, {
        events: {
          onReady({ target }) {
            if (signal.aborted || disposed) return;
            window.clearTimeout(timeout);
            initial = false;
            callbacks.onReady();
            if (visible && !document.hidden) target.loadVideoById(clip);
            else {
              target.cueVideoById(clip);
              callbacks.onHidden();
            }
            if (!disposed && clip.endSeconds !== undefined) {
              timer = window.setInterval(() => {
                if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;
                const time = player.getCurrentTime();
                if (time < clip.endSeconds) atBoundary = false;
                else repeatOrPause();
              }, 120);
            }
            resolve({
              setMix({ volume, muted }) {
                target.setVolume(Math.round(volume * 100));
                if (muted) target.mute();
                else target.unMute();
              },
              pause: () => target.pauseVideo(),
              destroy,
            });
          },
          onStateChange({ data }) {
            if (signal.aborted || initial || disposed) return;
            if (data === YT.PlayerState.PLAYING) {
              if (!visible || document.hidden) player.pauseVideo();
              else {
                if (clip.endSeconds === undefined || player.getCurrentTime() < clip.endSeconds) atBoundary = false;
                callbacks.onReady();
                callbacks.onPlay();
              }
            } else if (data === YT.PlayerState.ENDED) {
              repeatOrPause();
            }
          },
          onAutoplayBlocked() {
            if (!signal.aborted && !disposed) callbacks.onBlocked();
          },
          onError({ data }) {
            if (!signal.aborted && !disposed) fail(new Error(`YouTube player error: ${data}`));
          },
        },
      });
    } catch (error) {
      fail(error);
    }
  });
}
