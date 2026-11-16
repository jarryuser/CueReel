const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
let apiRequest;

export function parseYouTubeLink(value) {
  const url = new URL(value);
  if (!hosts.has(url.hostname)) return null;

  const [, type, id] = url.pathname.split('/');
  const videoId = url.hostname === 'youtu.be' ? type
    : type === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'live', 'embed'].includes(type) ? id : null;
  return /^[\w-]{11}$/u.test(videoId ?? '') ? videoId : '';
}

function loadApi() {
  if (typeof window.YT?.Player === 'function') return Promise.resolve(window.YT);
  if (apiRequest) return apiRequest;

  apiRequest = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(fail, 15000);

    function fail() {
      clearTimeout(timeout);
      script.remove();
      delete window.onYouTubeIframeAPIReady;
      reject(new Error('YouTube IFrame API unavailable'));
    }

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      delete window.onYouTubeIframeAPIReady;
      resolve(window.YT);
    };
    script.addEventListener('error', fail, { once: true });
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  }).catch(error => {
    apiRequest = undefined;
    throw error;
  });

  return apiRequest;
}

export function openYouTube(container, id, callbacks) {
  const frame = document.createElement('iframe');
  const url = new URL(`https://www.youtube.com/embed/${id}`);
  url.search = new URLSearchParams({
    enablejsapi: '1',
    origin: location.origin,
    playsinline: '1',
    cc_load_policy: '1',
  });
  frame.title = 'YouTube video';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.src = url.href;
  container.replaceChildren(frame);
  let player;
  let active = true;
  let ready = false;
  let timer;
  let readyTimeout;
  let lastTime;

  function updateTime() {
    const time = player.getCurrentTime();
    if (time === lastTime) return;
    lastTime = time;
    callbacks.timeupdate();
  }

  function fail(code) {
    clearTimeout(readyTimeout);
    clearInterval(timer);
    ready = false;
    if (active) callbacks.error(code);
  }

  loadApi().then(YT => {
    if (!active) return;
    readyTimeout = setTimeout(() => fail('YouTubeControlsUnavailable'), 15000);
    player = new YT.Player(frame, {
      events: {
        onReady(event) {
          if (!active) return;
          clearTimeout(readyTimeout);
          ready = true;
          timer = setInterval(updateTime, 100);
          callbacks.ready();
        },
        onError(event) {
          fail(event.data);
        },
        onAutoplayBlocked() {
          if (active) callbacks.autoplayBlocked();
        },
      },
    });
  }).catch(() => fail('YouTubeControlsUnavailable'));

  return {
    get currentTime() {
      return ready ? player.getCurrentTime() || 0 : 0;
    },
    get ready() {
      return ready;
    },
    get paused() {
      return !ready || player.getPlayerState() !== 1;
    },
    seek(seconds) {
      if (ready) player.seekTo(seconds, true);
    },
    play() {
      if (ready) player.playVideo();
    },
    pause() {
      if (ready) player.pauseVideo();
    },
    destroy() {
      active = false;
      clearTimeout(readyTimeout);
      clearInterval(timer);
      player?.destroy();
      container.replaceChildren();
    },
  };
}
