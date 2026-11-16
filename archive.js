const origin = 'https://archive.org';
const mediaTypes = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

export function parseArchiveLink(value) {
  const url = new URL(value);
  if (!['archive.org', 'www.archive.org'].includes(url.hostname)) return null;
  return /^\/(?:details|download)\/([a-z\d][a-z\d_.-]*)\/?$/iu.exec(url.pathname)?.[1] ?? null;
}

function filePath(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
  return parts.map(encodeURIComponent).join('/');
}

function stem(name) {
  return name.replace(/\.[^.\/]+$/u, '').toLowerCase();
}

function markedPrivate(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

export async function loadArchiveItem(id, canPlayType, signal) {
  const response = await fetch(`${origin}/metadata/${id}`, { credentials: 'omit', signal });
  if (!response.ok) throw new Error('Internet Archive metadata unavailable');

  const item = await response.json();
  if (!Array.isArray(item?.files) || markedPrivate(item.metadata?.['access-restricted-item'])) {
    throw new Error('Internet Archive item unavailable');
  }

  const media = [];
  const captions = [];
  for (const file of item.files) {
    const path = filePath(file?.name);
    if (!path || markedPrivate(file.private)) continue;
    const extension = file.name.split('.').at(-1).toLowerCase();
    const url = `${origin}/download/${id}/${path}`;
    if (extension === 'vtt' || extension === 'srt') {
      captions.push({ label: file.name, url, stem: stem(file.name), extension });
      continue;
    }

    if (!Object.hasOwn(mediaTypes, extension)) continue;
    const type = mediaTypes[extension];
    if (!canPlayType(type)) continue;
    media.push({
      name: file.name,
      url,
      group: typeof file.original === 'string' ? file.original : file.name,
      video: type.startsWith('video/'),
    });
  }

  media.sort((a, b) => Number(b.video) - Number(a.video));
  return { title: typeof item.metadata?.title === 'string' ? item.metadata.title : id, media, captions };
}

export function archiveTracks(item, file) {
  const names = [stem(file.name), stem(file.group)];
  function match(track) {
    if (names.includes(track.stem)) return 2;
    return names.some(name => track.stem.startsWith(`${name}.`)) ? 1 : 0;
  }

  const matching = item.captions.filter(track => match(track));
  const available = matching.length || new Set(item.media.map(entry => entry.group)).size > 1
    ? matching : item.captions;
  return [...available].sort((a, b) => match(b) - match(a) || Number(b.extension === 'vtt') - Number(a.extension === 'vtt'));
}
