import { formatTimestamp, parseTime, serializeSubtitles, shiftSubtitles } from './subtitles.js';

export function connectSubtitleEditor(readTracks, applyTrack) {
  const dialog = document.querySelector('#subtitle-editor');
  const form = document.querySelector('#edit-cue');
  const track = document.querySelector('#edit-track');
  const line = document.querySelector('#edit-line');
  const message = document.querySelector('#editor-status');
  const start = form.elements.namedItem('start');
  const end = form.elements.namedItem('end');
  const text = form.elements.namedItem('text');
  let tracks;

  function selectLine(index) {
    const cue = tracks[track.value][index];
    line.value = String(index);
    start.value = formatTimestamp(cue.start);
    end.value = formatTimestamp(cue.end);
    text.value = cue.text;
  }

  function selectTrack(index = 0) {
    const options = tracks[track.value].map((cue, i) =>
      new Option(`${formatTimestamp(cue.start)} · ${cue.text.slice(0, 75)}`, String(i)));
    const items = document.createDocumentFragment();
    for (const option of options) items.append(option);
    line.replaceChildren(items);
    selectLine(Math.min(Math.max(index, 0), options.length - 1));
  }

  function apply(entries, selected) {
    tracks[track.value] = entries.sort((a, b) => a.start - b.start);
    applyTrack(track.value, tracks[track.value]);
    selectTrack(selected ? entries.indexOf(selected) : Number(line.value));
  }

  document.querySelector('#open-editor').addEventListener('click', () => {
    const current = readTracks();
    if (!current.original.length) return;

    tracks = { original: current.original, translation: current.translation };
    track.replaceChildren(new Option('Original', 'original'));
    if (tracks.translation.length) track.add(new Option('Translation', 'translation'));
    selectTrack(current.index);
    message.textContent = '';
    dialog.showModal();
  });

  track.addEventListener('change', () => selectTrack());
  line.addEventListener('change', () => selectLine(Number(line.value)));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = { start: parseTime(start.value), end: parseTime(end.value), text: text.value.trim().replace(/\s+/gu, ' ') };
    if (!Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start || !value.text) {
      message.textContent = 'Enter phrase text and times in HH:MM:SS.mmm format. The end must be after the start.';
      return;
    }

    const entries = [...tracks[track.value]];
    entries[Number(line.value)] = value;
    apply(entries, value);
    message.textContent = 'Phrase updated';
  });

  const shift = document.querySelector('#shift-track');
  shift.addEventListener('submit', event => {
    event.preventDefault();
    const amount = shift.elements.namedItem('milliseconds').valueAsNumber;
    const shifted = shiftSubtitles(tracks[track.value], amount);
    if (!shifted) {
      message.textContent = 'The shift would put a timestamp out of range';
      return;
    }

    apply(shifted);
    message.textContent = 'Track shifted';
  });

  for (const button of dialog.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => {
      const format = button.dataset.export;
      const content = serializeSubtitles(tracks[track.value], format);
      const blob = new Blob([content], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${track.value}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.textContent = 'Subtitle file ready';
    });
  }
}
