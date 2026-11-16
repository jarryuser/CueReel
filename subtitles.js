const timestamp = /^(?:(\d+):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/u;

export function parseTime(value) {
  const match = timestamp.exec(value.trim());
  if (!match) return NaN;
  const [, hours = 0, minutes, seconds, milliseconds] = match;
  const total = ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(milliseconds);
  return Number.isSafeInteger(total) ? total / 1000 : NaN;
}

const entities = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' };

export function formatTimestamp(seconds, separator = '.') {
  const milliseconds = Math.round(seconds * 1000);
  const parts = [Math.floor(milliseconds / 3600000), Math.floor(milliseconds / 60000) % 60,
    Math.floor(milliseconds / 1000) % 60];
  return parts.map(part => String(part).padStart(2, '0')).join(':')
    + separator + String(milliseconds % 1000).padStart(3, '0');
}

export function serializeSubtitles(cues, format) {
  const srt = format === 'srt';
  const separator = srt ? ',' : '.';
  const blocks = cues.map(({ start, end, text }, index) => {
    const number = srt ? `${index + 1}\n` : '';
    const escaped = text.replace(/[&<>]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
    return `${number}${formatTimestamp(start, separator)} --> ${formatTimestamp(end, separator)}\n${escaped}`;
  });
  return (srt ? '' : 'WEBVTT\n\n') + blocks.join('\n\n') + '\n';
}

export function shiftSubtitles(cues, milliseconds) {
  if (!Number.isSafeInteger(milliseconds)) return null;
  const shifted = cues.map(({ start, end, text }) => ({
    start: (Math.round(start * 1000) + milliseconds) / 1000,
    end: (Math.round(end * 1000) + milliseconds) / 1000,
    text,
  }));
  if (shifted.some(cue => cue.start < 0 || !Number.isSafeInteger(Math.round(cue.end * 1000)))) return null;
  return shifted;
}

export function parseSubtitles(source) {
  const cues = [];
  const blocks = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim().split(/\n[\t ]*\n+/u);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/u.test(lines[0])) continue;

    const timingIndex = lines[0].includes('-->') ? 0 : 1;
    const timing = lines[timingIndex]?.trim().match(/^(\S+)\s+-->\s+(\S+)/u);
    if (!timing) continue;

    const start = parseTime(timing[1]);
    const end = parseTime(timing[2]);
    const text = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/gu, '').replace(/&(amp|lt|gt|nbsp|lrm|rlm);/gu, (_, name) => entities[name]).trim();
    if (Number.isFinite(start) && end > start && text) cues.push({ start, end, text });
  }

  return cues;
}

export function indexCues(cues) {
  const entries = [...cues].sort((a, b) => a.start - b.start)
    .map((cue, index) => ({ ...cue, index }));
  let latestEnd = 0;
  const ends = entries.map(cue => {
    latestEnd = Math.max(latestEnd, cue.end);
    return latestEnd;
  });

  return {
    entries,
    between(start, end) {
      let low = 0;
      let high = ends.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (ends[middle] <= start) low = middle + 1;
        else high = middle;
      }

      const matches = [];
      for (let i = low; i < entries.length; i++) {
        const cue = entries[i];
        if (end === undefined ? cue.start > start : cue.start >= end) break;
        if (cue.end > start) matches.push(cue);
      }
      return matches;
    },
  };
}

export function parseYouTubeTranscript(source) {
  const timestamps = [];
  let current;
  for (const raw of source.split(/\r\n?|\n/u)) {
    const line = raw.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim();
    if (!line) continue;

    const match = /^(\d+):([0-5]\d)(?::([0-5]\d))?(?:\s+(.*))?$/u.exec(line);
    if (match) {
      const [, leading, middle, seconds, caption] = match;
      const start = seconds === undefined
        ? Number(leading) * 60 + Number(middle)
        : Number(leading) * 3600 + Number(middle) * 60 + Number(seconds);
      if (!Number.isSafeInteger(start) || (current && start < current.start)) return [];
      if (current?.start !== start) {
        current = { start, lines: [] };
        timestamps.push(current);
      }
      if (caption) current.lines.push(caption);
    } else if (current) {
      current.lines.push(line);
    }
  }

  return timestamps.flatMap(({ start, lines }, index) => lines.length ? [{
    start, end: timestamps[index + 1]?.start ?? start + 4, text: lines.join(' '),
  }] : []);
}
