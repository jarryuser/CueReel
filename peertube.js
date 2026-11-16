import { webUrl } from './browser.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const shortId = /^[a-zA-Z0-9]{22}$/u;
let apiRequest;

export function parsePeerTubeLink(value) {
  const url = new URL(value);
  const match = /^\/(?:w|videos\/(?:watch|embed))\/([^/]+)\/?$/u.exec(url.pathname);
  const id = match?.[1];
  if (url.protocol !== 'https:' || !id || (!uuid.test(id) && !shortId.test(id))) return null;

  const embed = new URL(`/videos/embed/${id}`, url.origin);
  embed.searchParams.set('api', '1');
  embed.searchParams.set('p2p', '0');
  const api = new URL(`/api/v1/videos/${id}`, url.origin);
  return { embed: embed.href, api: api.href };
}

async function requestJson(url, signal) {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok) throw new Error('PeerTube request failed');
  return response.json();
}

export async function peerTubeTracks(video, signal) {
  const [captions, info] = await Promise.allSettled([
    requestJson(`${video.api}/captions`, signal),
    requestJson(video.api, signal),
  ]);
  if (captions.status === 'rejected') throw captions.reason;
  if (!Array.isArray(captions.value?.data)) throw new Error('Invalid PeerTube captions');

  const origin = new URL(video.api).origin;
  const language = info.status === 'fulfilled' ? info.value?.language?.id : undefined;
  const tracks = captions.value.data.flatMap(caption => {
    const file = caption?.fileUrl || caption?.captionPath;
    if (typeof file !== 'string' || !file) return [];
    const url = webUrl(file, origin);
    if (url?.protocol !== 'https:') return [];
    return [{
      label: caption.language?.label || caption.language?.id || 'Subtitles',
      language: caption.language?.id,
      url: url.href,
    }];
  });
  return tracks.sort((a, b) => Number(b.language === language) - Number(a.language === language));
}

function loadPlayer() {
  if (window.PeerTubePlayer) return Promise.resolve(window.PeerTubePlayer);
  if (apiRequest) return apiRequest;

  apiRequest = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(fail, 15000);

    function fail() {
      clearTimeout(timer);
      script.remove();
      reject(new Error('PeerTube Embed API unavailable'));
    }

    script.addEventListener('load', () => {
      if (!window.PeerTubePlayer) return fail();
      clearTimeout(timer);
      resolve(window.PeerTubePlayer);
    }, { once: true });
    script.addEventListener('error', fail, { once: true });
    script.src = 'https://unpkg.com/@peertube/embed-api@0.2.0/build/player.min.js';
    document.head.append(script);
  }).catch(error => {
    apiRequest = undefined;
    throw error;
  });
  return apiRequest;
}

export function openPeerTube(container, source, callbacks) {
  let player;
  let active = true;
  let ready = false;
  let paused = true;
  let time = 0;
  const timeout = setTimeout(() => {
    if (active && !ready) callbacks.error();
  }, 18000);

  function onUpdate(state) {
    if (!active || !ready) return;
    if (typeof state?.playbackState === 'string') paused = state.playbackState !== 'playing';
    if (Number.isFinite(state?.position)) time = state.position;
    callbacks.timeupdate();
  }

  loadPlayer().then(async Player => {
    if (!active) return;
    const frame = document.createElement('iframe');
    frame.title = 'PeerTube video';
    frame.allow = 'autoplay; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.src = source.embed;
    container.replaceChildren(frame);
    player = new Player(frame);
    player.addEventListener('playbackStatusUpdate', onUpdate);
    player.addEventListener('playbackStatusChange', onUpdate);

    await player.ready;
    if (!active) return;
    clearTimeout(timeout);
    ready = true;
    callbacks.ready();
  }).catch(() => {
    clearTimeout(timeout);
    if (active) callbacks.error();
  });

  return {
    get currentTime() { return time; },
    get ready() { return ready; },
    get paused() { return paused; },
    async seek(seconds) {
      await player.seek(seconds);
      if (!active) return;
      time = seconds;
      callbacks.timeupdate();
    },
    play() { return player.play(); },
    pause() {
      paused = true;
      void player.pause().catch(() => { if (active) paused = false; });
    },
    destroy() {
      active = false;
      clearTimeout(timeout);
      if (player) {
        player.removeEventListener('playbackStatusUpdate', onUpdate);
        player.removeEventListener('playbackStatusChange', onUpdate);
        player.destroy();
      }
      container.replaceChildren();
    },
  };
}
