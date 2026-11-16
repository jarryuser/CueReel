let apiRequest;

export function parseVimeoLink(value) {
  const url = new URL(value);
  const embed = url.hostname === 'player.vimeo.com';
  if (!embed && !['vimeo.com', 'www.vimeo.com'].includes(url.hostname)) return null;

  const match = embed
    ? /^\/video\/(\d+)\/?$/u.exec(url.pathname)
    : /^\/(\d+)(?:\/([a-z0-9]+))?\/?$/iu.exec(url.pathname);
  if (!match) return '';

  const hash = match[2] ?? url.searchParams.get('h');
  if (hash && !/^[a-z0-9]+$/iu.test(hash)) return '';
  const source = new URL(`https://player.vimeo.com/video/${match[1]}`);
  if (hash) source.searchParams.set('h', hash);
  return source.href;
}

function loadApi() {
  if (window.Vimeo?.Player) return Promise.resolve(window.Vimeo.Player);
  if (apiRequest) return apiRequest;

  apiRequest = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(fail, 15000);

    function fail() {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('Vimeo Player SDK unavailable'));
    }

    script.addEventListener('load', () => {
      clearTimeout(timeout);
      if (window.Vimeo?.Player) resolve(window.Vimeo.Player);
      else fail();
    }, { once: true });
    script.addEventListener('error', fail, { once: true });
    script.src = 'https://player.vimeo.com/api/player.js';
    document.head.append(script);
  }).catch(error => {
    apiRequest = undefined;
    throw error;
  });
  return apiRequest;
}

async function playerCommand(command, name) {
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Vimeo ${name} timed out`)), 8000);
    });
    return await Promise.race([command, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function openVimeo(container, source, callbacks) {
  let active = true;
  let ready = false;
  let paused = true;
  let playbackFailed = false;
  let time = 0;
  let player;
  const timeout = setTimeout(fail, 15000);

  function fail(error) {
    clearTimeout(timeout);
    if (!active) return;
    playbackFailed = error?.name === 'PlaybackError';
    paused = true;
    ready = false;
    callbacks.error(error?.name);
  }

  loadApi().then(async Player => {
    if (!active) return;

    const frame = document.createElement('iframe');
    frame.title = 'Vimeo video';
    frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
    frame.allowFullscreen = true;
    frame.src = source;
    container.replaceChildren(frame);
    player = new Player(frame);

    function updateTime({ seconds }) {
      if (!active || !ready) return;
      time = seconds;
      callbacks.timeupdate();
    }

    player.on('play', () => { paused = false; });
    player.on('playing', event => {
      if (!active) return;
      paused = false;
      if (playbackFailed) {
        playbackFailed = false;
        ready = true;
        if (Number.isFinite(event?.seconds)) time = event.seconds;
        callbacks.ready();
      }
    });
    player.on('pause', () => { paused = true; });
    player.on('ended', () => { paused = true; });
    player.on('timeupdate', updateTime);
    player.on('seeked', updateTime);
    player.on('error', error => {
      if (!error.method || error.name === 'PlaybackError') fail(error);
    });

    await player.ready();
    clearTimeout(timeout);
    if (!active || playbackFailed) return;
    ready = true;
    callbacks.ready();
  }).catch(fail);

  return {
    get currentTime() {
      return time;
    },
    get ready() {
      return ready;
    },
    get paused() {
      return paused;
    },
    async seek(seconds) {
      const position = await playerCommand(player.setCurrentTime(seconds), 'seek');
      if (!active || !ready) return;
      time = position;
      callbacks.timeupdate();
    },
    play() {
      return playerCommand(player.play(), 'play');
    },
    pause() {
      paused = true;
      void playerCommand(player.pause(), 'pause').catch(() => { if (active && ready) paused = false; });
    },
    destroy() {
      active = false;
      clearTimeout(timeout);
      if (player) void player.destroy().catch(() => {});
      container.replaceChildren();
    },
  };
}
