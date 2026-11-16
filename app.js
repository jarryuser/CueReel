import { newId, webUrl } from './browser.js';
import { createBackup, parseBackup } from './backup.js';
import { archiveTracks, loadArchiveItem, parseArchiveLink } from './archive.js';
import { connectSubtitleEditor } from './editor.js';
import { deleteLesson, exportLibrary, importLibrary, listLessons, loadLesson, loadWorkspace, reconnectMedia, saveLesson, savePosition, saveWorkspace } from './library.js?v=4';
import { emptyProgress, listenedMs, mergeProgress, phraseKey, summarizeProgress } from './progress.js';
import { indexCues, parseSubtitles, parseYouTubeTranscript } from './subtitles.js';
import { transcribeFile } from './transcription.js';
import { connectTypingSound } from './typing-sound.js';
import { connectVocabulary } from './vocabulary.js?v=3';
import { openPeerTube, parsePeerTubeLink, peerTubeTracks } from './peertube.js';
import { openVimeo, parseVimeoLink } from './vimeo.js';
import { openYouTube, parseYouTubeLink } from './youtube.js?v=3';

const player = document.querySelector('#player');
const demoAudio = document.querySelector('#preview-audio');
const embedContainer = document.querySelector('#embed-player');
const openSourceVideo = document.querySelector('#open-source-video');
const media = document.querySelector('#media');
const whisperOptions = document.querySelector('#whisper-options');
const generateSubtitles = document.querySelector('#generate-subtitles');
const cancelTranscriptionButton = document.querySelector('#cancel-transcription');
const whisperStatus = document.querySelector('#whisper-status');
const embedded = document.querySelector('#embedded');
const trackSelect = document.querySelector('#track');
const status = document.querySelector('#status');
const mediaLink = document.querySelector('#media-link');
const youtubeTranscript = document.querySelector('#youtube-transcript');
const youtubeWatch = document.querySelector('#youtube-watch');
const youtubeTranscriptForm = document.querySelector('#import-youtube-transcript');
const lesson = document.querySelector('#lesson');
const practiceTitle = document.querySelector('#practice-title');
const mode = document.querySelector('#mode');
const cueText = document.querySelector('#cue');
const translationText = document.querySelector('#translation-cue');
const clearTranslation = document.querySelector('#clear-translation');
const exercise = document.querySelector('#exercise');
const answerHelp = document.querySelector('#answer-help');
const practiceMediaStatus = document.querySelector('#practice-media-status');
const answer = document.querySelector('#answer');
const hint = document.querySelector('#hint');
const repeat = document.querySelector('#repeat');
const next = document.querySelector('#next');
const feedback = document.querySelector('#feedback');
const transcript = document.querySelector('#transcript');
const platformCaptionForm = document.querySelector('#platform-captions');
const platformTrack = document.querySelector('#platform-track');
const platformTrackFile = document.querySelector('#platform-track-file');
const platformTrackLabel = document.querySelector('#platform-track-label');
const archiveForm = document.querySelector('#archive-media');
const archiveSelect = document.querySelector('#archive-file');
const platformCaptionStatus = document.querySelector('#platform-caption-status');
const addVocabularyButton = document.querySelector('#add-vocabulary');
const phraseProgress = document.querySelector('#progress-phrases');
const accuracyProgress = document.querySelector('#progress-accuracy');
const listeningProgress = document.querySelector('#progress-listening');
const saveForm = document.querySelector('#save-lesson');
const lessonTitle = saveForm.elements.namedItem('title');
const saveButton = saveForm.querySelector('button');
const savedLessons = document.querySelector('#saved-lessons');
const libraryStatus = document.querySelector('#library-status');
const reconnectForm = document.querySelector('#reconnect-media');
const reconnectFile = document.querySelector('#reconnect-file');
const reconnectLabel = document.querySelector('#reconnect-label');
const backupFile = document.querySelector('#library-backup-file');
const resumeButton = document.querySelector('#resume-position');
const playTypingSound = connectTypingSound(document.querySelector('#typing-sound'));
const workspacePositionKey = 'cuereel-workspace-position';
const graphemes = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const punctuation = /[\p{P}\u02BC]/gu;

let mediaUrl;
let mediaSource;
let transcriptionJob;
let sampleSource = null;
let platformRequest;
let archiveItem;
let archiveFallback = [];
let platformOriginal = false;
let platformTranslation = false;
let savedId;
let materialsChanged = false;
let libraryBusy = false;
let pendingReconnect;
let restorePosition;
let checkpointTimer;
let progress = emptyProgress();
let pendingProgress = emptyProgress();
let progressRevision = null;
let listeningSample;
let checkpointWrite = Promise.resolve();
let workspaceWrite = Promise.resolve();
let workspaceMaterials;
let restoringWorkspace = false;
let workspaceTouched = false;
let workspaceSession = newId();
let restoredAnswer;
let embeddedPlayback;
let pendingClip;
let mediaError = '';
let clipEnd;
const nativePlayback = {
  get currentTime() {
    return player.currentTime;
  },
  get ready() {
    return player.readyState > 0 && !player.error;
  },
  get paused() {
    return player.paused;
  },
  seek(seconds) {
    player.currentTime = seconds;
  },
  play() {
    return player.play();
  },
  pause() {
    player.pause();
  },
};
let playback = nativePlayback;
let cues = [];
let current = -1;
let hintLength = 0;
let answerAccepted = false;
let advanceTimer;
let composingAnswer = false;
let original = indexCues([]);
let translation = indexCues([]);
let selectedTrack;
let embeddedTracks = [];
let removeTrackListener;

function showTranslation() {
  const cue = cues[current];
  let text = '';
  if (mode.value === 'watch') {
    text = translation.between(playback.currentTime).map(cue => cue.text).join(' ');
  } else if (mode.value === 'typing' && cue) {
    text = translation.between(cue.start, cue.end).map(cue => cue.text).join(' ');
  }
  if (translationText.textContent !== text) translationText.textContent = text;
  translationText.hidden = !text;
}

function showCue(index) {
  transcript.children[current]?.removeAttribute('aria-current');
  current = index;
  const active = transcript.children[current];
  if (active) {
    active.setAttribute('aria-current', 'true');
    const top = active.offsetTop;
    if (top < transcript.scrollTop || top + active.offsetHeight > transcript.scrollTop + transcript.clientHeight) {
      transcript.scrollTop = top;
    }
  }

  clearTimeout(advanceTimer);
  answerAccepted = false;
  answer.readOnly = false;
  answer.value = '';
  answer.removeAttribute('aria-invalid');
  delete answer.dataset.match;
  feedback.textContent = '';
  hintLength = 0;
  cueText.textContent = mode.value === 'dictation' ? '' : cues[current]?.text ?? '';
  next.disabled = current >= cues.length - 1;
  addVocabularyButton.disabled = !cues[current] || mode.value === 'dictation';
  showTranslation();
  queueCheckpoint();
}

function syncPlayback() {
  const sample = !lesson.hidden && mode.value !== 'watch' && !document.hidden && !playback.paused && !pendingClip
    ? { wall: performance.now(), media: playback.currentTime } : undefined;
  const heard = listenedMs(listeningSample, sample);
  listeningSample = sample;
  if (heard) {
    progress.listeningMs += heard;
    pendingProgress.listeningMs += heard;
    listeningProgress.textContent = formatCueTime(progress.listeningMs / 1000);
  }
  queueCheckpoint();
  if (restorePosition && !playback.paused) clearRestorePosition();
  if (mode.value !== 'watch') {
    const end = clipEnd ?? cues[current]?.end;
    if (!pendingClip && end !== undefined && !playback.paused && playback.currentTime >= end) playback.pause();
    return;
  }

  const active = original.between(playback.currentTime).at(-1);
  const index = active?.index ?? -1;
  if (current !== index) showCue(index);
  else showTranslation();
}

function updateMode() {
  listeningSample = undefined;
  clipEnd = undefined;
  pendingClip = undefined;
  exercise.hidden = mode.value === 'watch';
  answerHelp.textContent = mode.value === 'typing'
    ? 'Type the subtitle. Punctuation is optional. A correct answer plays the next phrase.'
    : 'Type what you hear. Punctuation is optional. A correct answer plays the next phrase.';
  transcript.hidden = mode.value === 'dictation';
  hint.hidden = mode.value !== 'dictation';
  if (mode.value === 'watch') {
    showCue(-1);
    syncPlayback();
    return;
  }

  if (!playback.paused) playback.pause();
  showCue(Math.max(0, current));
  if (!embeddedPlayback && playback.ready && cues[current]) playback.seek(cues[current].start);
}

function updateLesson() {
  lesson.hidden = (!playback.ready && mediaSource !== sampleSource) || !cues.length;
  updateSaveButton();
  if (lesson.hidden) {
    if (restorePosition && playback.ready && !embeddedPlayback && !cues.length) {
      playback.seek(restorePosition.time);
      clearRestorePosition();
    }
    return;
  }

  updateMode();
  if (!restorePosition) return;
  if (mode.value !== 'watch') {
    const index = Math.min(Math.max(restorePosition.index, 0), cues.length - 1);
    showCue(index);
    if (!embeddedPlayback) playback.seek(cues[index].start);
    clearRestorePosition();
    if (restoredAnswer?.index === index) {
      answer.value = restoredAnswer.text;
      checkAnswer(false, true);
      answerAccepted = restoredAnswer.accepted;
      answer.readOnly = answerAccepted;
      if (answerAccepted) feedback.textContent = 'Correct';
    }
    restoredAnswer = undefined;
  } else if (!embeddedPlayback) {
    playback.seek(restorePosition.time);
    clearRestorePosition();
    syncPlayback();
  } else {
    resumeButton.hidden = !restorePosition.time;
    const index = original.between(restorePosition.time).at(-1)?.index ?? -1;
    if (index !== -1) showCue(index);
  }
}

async function playCue(index) {
  if (!cues[index]) return;
  clearRestorePosition();
  if (current !== index) showCue(index);
  rememberWorkspace();
  if (!playback.ready) return;

  listeningSample = undefined;
  const source = playback;
  const intent = {};
  pendingClip = intent;
  clipEnd = cues[index].end;
  try {
    const seek = source.seek(cues[index].start);
    if (seek) await seek;
    if (pendingClip !== intent) return;
    pendingClip = undefined;
    await source.play();
  } catch {
    if (pendingClip === intent) pendingClip = undefined;
    if (playback === source && current === index && mode.value !== 'watch') {
      feedback.textContent = 'Could not play the phrase. Try starting playback in the player.';
    }
  }
}

function normalize(text) {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function showMediaStatus() {
  repeat.disabled = mediaSource === sampleSource && !playback.ready;
  practiceMediaStatus.textContent = mediaSource === sampleSource && !playback.ready
    ? mediaError ? 'Sample audio is unavailable. You can still type the subtitles.' : 'Loading sample audio…'
    : '';
  if (mediaError) status.textContent = mediaError;
  else if (mediaSource === sampleSource && !playback.ready) status.textContent = 'Loading media';
  else if (!mediaUrl && !embeddedPlayback) status.textContent = 'Choose video or audio';
  else if (!playback.ready) status.textContent = 'Loading media';
  else if (!cues.length) {
    if (!youtubeTranscript.hidden) status.textContent = 'For typing practice, paste the YouTube transcript or add an SRT or VTT file.';
    else if (embeddedPlayback) status.textContent = 'Add original subtitles to start the lesson';
    else status.textContent = 'Select an embedded track or add an SRT or WebVTT file';
  }
  else status.textContent = '';
}

function formatCueTime(seconds) {
  const total = Math.floor(seconds);
  const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  if (!parts[0]) parts.shift();
  return parts.map(part => String(part).padStart(2, '0')).join(':');
}

function setCues(entries) {
  if (transcriptionJob) cancelTranscription('Transcription stopped because the original subtitles changed.');
  original = indexCues(entries);
  cues = original.entries;
  current = -1;
  const items = document.createDocumentFragment();
  cues.forEach((cue, index) => {
    const button = document.createElement('button');
    button.dataset.index = index;
    const time = document.createElement('span');
    time.className = 'cue-time';
    time.textContent = formatCueTime(cue.start);
    const text = document.createElement('span');
    text.dir = 'auto';
    text.textContent = cue.text;
    button.append(time, text);
    items.append(button);
  });
  transcript.replaceChildren(items);
  renderProgress();
  showMediaStatus();
  updateLesson();
  rememberWorkspace();
}

function releaseTrack() {
  removeTrackListener?.();
  if (selectedTrack) selectedTrack.mode = 'disabled';
  selectedTrack = undefined;
}

function listTracks() {
  const tracks = embeddedPlayback ? [] : Array.from(player.textTracks).filter(track => ['subtitles', 'captions'].includes(track.kind));
  if (selectedTrack && !tracks.includes(selectedTrack)) {
    releaseTrack();
    setCues([]);
  }

  embeddedTracks = tracks;
  trackSelect.replaceChildren(new Option('Choose a track', ''));
  tracks.forEach((track, index) => {
    const label = track.label || track.language || `Track ${index + 1}`;
    trackSelect.add(new Option(label, String(index)));
  });
  trackSelect.value = selectedTrack ? String(tracks.indexOf(selectedTrack)) : '';
  embedded.hidden = !tracks.length;
}

trackSelect.addEventListener('change', () => {
  flushCheckpoint();
  platformOriginal = false;
  resetProgress();
  materialsChanged = true;
  originalImport.clear();
  releaseTrack();
  selectedTrack = embeddedTracks[trackSelect.value];
  if (!selectedTrack) {
    setCues([]);
    return;
  }

  const track = selectedTrack;
  let previousLength = 0;
  function readTrack() {
    const trackCues = track.cues;
    if (!trackCues?.length || trackCues.length === previousLength) return;
    previousLength = trackCues.length;
    const entries = Array.from(trackCues, cue => ({
      start: cue.startTime,
      end: cue.endTime,
      text: cue.getCueAsHTML?.().textContent?.trim() ?? '',
    })).filter(cue => cue.text && cue.end > cue.start);
    setCues(entries);
  }

  setCues([]);
  track.mode = 'hidden';
  track.addEventListener('cuechange', readTrack);
  player.addEventListener('timeupdate', readTrack);
  removeTrackListener = () => {
    track.removeEventListener('cuechange', readTrack);
    player.removeEventListener('timeupdate', readTrack);
    removeTrackListener = undefined;
  };
  readTrack();
});

player.textTracks.addEventListener('addtrack', listTracks);
player.textTracks.addEventListener('removetrack', listTracks);

function resetMedia() {
  if (selectedTrack) {
    releaseTrack();
    setCues([]);
  }
  embeddedPlayback?.destroy();
  embeddedPlayback = undefined;
  playback = nativePlayback;
  embedContainer.hidden = true;
  openSourceVideo.hidden = true;
  openSourceVideo.removeAttribute('href');
  if (mediaUrl?.startsWith('blob:')) URL.revokeObjectURL(mediaUrl);
  mediaUrl = undefined;
  mediaError = '';
  clipEnd = undefined;
  pendingClip = undefined;
  lesson.hidden = true;
  clearTimeout(advanceTimer);
}

function openMedia(url) {
  resetMedia();
  setNativeMedia(url);
}

function setNativeMedia(url) {
  mediaUrl = url;
  player.hidden = false;
  player.classList.remove('audio-only');
  player.src = url;
  status.textContent = 'Loading media';
}

function openEmbeddedMedia(open, source, platform) {
  resetMedia();
  player.pause();
  player.removeAttribute('src');
  player.load();
  player.hidden = true;
  embedContainer.hidden = false;
  embeddedPlayback = open(embedContainer, source, {
    ready() {
      mediaError = '';
      openSourceVideo.hidden = platform !== 'YouTube';
      showMediaStatus();
      updateLesson();
    },
    timeupdate: syncPlayback,
    error(code) {
      mediaError = code === 153 && platform === 'YouTube'
        ? 'YouTube could not identify this page (error 153). Open the video on YouTube.'
        : code === 100 && platform === 'YouTube'
        ? 'YouTube reports that this video is private, removed, or unavailable.'
        : code === 'YouTubeControlsUnavailable'
        ? 'Could not connect to YouTube playback controls. Try the embedded player or open the video on YouTube.'
        : code === 'PlaybackError'
        ? `The ${platform} player could not play this video. Try again in the player or open it on ${platform}.`
        : [101, 150, 'PrivacyError', 'PasswordError'].includes(code)
        ? 'This video cannot be embedded. Choose another video.'
        : `Could not open the ${platform} video. Check the link and video availability.`;
      openSourceVideo.href = mediaSource.url;
      openSourceVideo.hidden = false;
      showMediaStatus();
      updateLesson();
    },
    autoplayBlocked() {
      feedback.textContent = `Start playback using the play button in the ${platform} player`;
    },
  });
  playback = embeddedPlayback;
  listTracks();
  showMediaStatus();
}

function readLink(form) {
  const field = form.elements.namedItem('url');
  const url = webUrl(field.value.trim());
  if (url) return url.href;
  field.setCustomValidity('Enter an HTTP or HTTPS URL without a username or password');
  field.reportValidity();
}

function allowLinkEdits(form) {
  const field = form.elements.namedItem('url');
  field.addEventListener('input', () => field.setCustomValidity(''));
}

allowLinkEdits(mediaLink);

media.addEventListener('change', () => {
  const file = media.files[0];
  if (file) openSource({ file });
});

mediaLink.addEventListener('submit', event => {
  event.preventDefault();
  const url = readLink(mediaLink);
  if (!url) return;
  if (!openSource({ url })) {
    const field = mediaLink.elements.namedItem('url');
    field.setCustomValidity('Enter a link to a specific YouTube or Vimeo video');
    field.reportValidity();
    return;
  }
  media.value = '';
  document.querySelector('.playback').scrollIntoView({ block: 'start' });
});

function openSource(source, record) {
  const youtubeId = source.url ? parseYouTubeLink(source.url) : null;
  const vimeoUrl = source.url ? parseVimeoLink(source.url) : null;
  const peerTube = source.url ? parsePeerTubeLink(source.url) : null;
  const archiveId = source.url ? parseArchiveLink(source.url) : null;
  if (youtubeId === '' || vimeoUrl === '') return false;

  closeReconnect();
  flushCheckpoint();
  clearRestorePosition();
  platformRequest?.abort();
  platformRequest = undefined;
  platformCaptionForm.hidden = true;
  archiveForm.hidden = true;
  youtubeTranscript.hidden = !youtubeId;
  youtubeTranscript.open = false;
  youtubeTranscriptForm.reset();
  if (youtubeId) youtubeWatch.href = `https://www.youtube.com/watch?v=${youtubeId}`;
  else youtubeWatch.removeAttribute('href');
  archiveItem = undefined;
  archiveFallback = [];
  platformCaptionStatus.textContent = '';
  originalImport.cancelPlatform();
  translationImport.cancelPlatform();
  const clearOriginal = platformOriginal;
  const clearTranslationTrack = platformTranslation;
  if (clearOriginal) originalImport.clear();
  if (clearTranslationTrack) translationImport.clear();
  platformOriginal = false;
  platformTranslation = false;
  savedId = record?.id;
  restoredAnswer = undefined;
  materialsChanged = false;
  if (source !== sampleSource) sampleSource = null;
  mediaSource = source;
  workspaceSession = record?.workspaceSession ?? newId();
  cancelTranscription();
  whisperOptions.hidden = !source.file || source === sampleSource;
  resetProgress(record);
  lessonTitle.value = record?.title ?? source.file?.name ?? '';
  if (youtubeId) {
    openEmbeddedMedia(openYouTube, youtubeId, 'YouTube');
    openSourceVideo.href = youtubeWatch.href;
    openSourceVideo.hidden = false;
  } else if (vimeoUrl) openEmbeddedMedia(openVimeo, vimeoUrl, 'Vimeo');
  else if (peerTube) openEmbeddedMedia(openPeerTube, peerTube, 'PeerTube');
  else if (archiveId || source === sampleSource) {
    resetMedia();
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.hidden = true;
  } else openMedia(source.file ? URL.createObjectURL(source.file) : source.url);
  if (clearOriginal) setCues([]);
  if (youtubeId && !record && !cues.length) youtubeTranscript.open = true;
  if (clearTranslationTrack) {
    translation = indexCues([]);
    clearTranslation.hidden = true;
    showTranslation();
  }
  if (peerTube) void loadPlatformTracks(peerTube, !record);
  if (archiveId) void openArchive(archiveId, source, record);
  updateSaveButton();
  if (!record) rememberWorkspace();
  return true;
}

player.addEventListener('loadedmetadata', () => {
  if (embeddedPlayback || !mediaUrl) return;
  player.classList.toggle('audio-only', !player.videoWidth);
  listTracks();
  showMediaStatus();
  if (mediaSource !== sampleSource || lesson.hidden) updateLesson();
});

player.addEventListener('error', () => {
  if (embeddedPlayback || !mediaUrl) return;
  if (mediaSource !== sampleSource) lesson.hidden = true;
  updateSaveButton();
  if (archiveItem) {
    const alternative = archiveFallback.shift();
    if (alternative) {
      playArchiveFile(alternative);
      return;
    }
    showArchiveError('Could not play this Internet Archive file. Choose another file or open the item on Internet Archive.');
    return;
  }

  mediaError = mediaUrl.startsWith('blob:')
    ? 'This browser could not open the media file. Try another format.'
    : 'Could not open the media. Check that the URL points directly to a playable audio or video file.';
  showMediaStatus();
});

function connectSubtitleImport(fileInput, form, message, apply) {
  let load = 0;
  let request;
  let requestIsPlatform = false;

  function showStatus(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  async function loadCaptions(readText, errorMessage, remoteTrack = false, parse = parseSubtitles) {
    const revision = ++load;
    showStatus('Loading subtitles');
    try {
      const text = await readText();
      if (revision !== load) return;
      const parsed = parse(text);
      if (!parsed.length) throw new Error('Empty subtitles');
      apply(parsed, remoteTrack);
      showStatus('');
      return true;
    } catch {
      if (revision === load) showStatus(errorMessage);
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    request?.abort();
    request = undefined;
    requestIsPlatform = false;
    void loadCaptions(() => file.text(), 'Could not read subtitles. Choose an SRT or WebVTT file.');
  });

  async function loadFromUrl(url, remoteTrack = false) {
    request?.abort();
    const pending = new AbortController();
    request = pending;
    requestIsPlatform = remoteTrack;
    const loaded = await loadCaptions(async () => {
      const response = await fetch(url, { signal: pending.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Subtitle request failed');
      return response.text();
    }, 'Could not load subtitles from this URL. Check the link or open an SRT or WebVTT file from your device.', remoteTrack);
    if (loaded) fileInput.value = '';
    if (request === pending) {
      request = undefined;
      requestIsPlatform = false;
    }
  }

  allowLinkEdits(form);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const url = readLink(form);
    if (url) void loadFromUrl(url);
  });

  return {
    get revision() { return load; },
    loadFromUrl,
    loadTranscript(transcriptText) {
      request?.abort();
      request = undefined;
      requestIsPlatform = false;
      void loadCaptions(() => transcriptText, 'Paste transcript lines with timestamps in chronological order, such as 0:35.', false, parseYouTubeTranscript);
    },
    cancelPlatform() {
      if (!requestIsPlatform) return;
      load++;
      request?.abort();
      request = undefined;
      requestIsPlatform = false;
      showStatus('');
    },
    clear() {
      load++;
      request?.abort();
      request = undefined;
      requestIsPlatform = false;
      fileInput.value = '';
      showStatus('');
    },
  };
}

function applyOriginalSubtitles(entries, remoteTrack = false) {
  flushCheckpoint();
  platformOriginal = remoteTrack;
  resetProgress();
  materialsChanged = true;
  trackSelect.value = '';
  releaseTrack();
  setCues(entries);
}

const originalImport = connectSubtitleImport(
  document.querySelector('#captions'),
  document.querySelector('#caption-link'),
  document.querySelector('#caption-status'),
  applyOriginalSubtitles,
);

function showWhisperStatus(message) {
  whisperStatus.hidden = !message;
  whisperStatus.textContent = message;
}

function cancelTranscription(message = '') {
  transcriptionJob?.abort();
  transcriptionJob = undefined;
  generateSubtitles.disabled = false;
  cancelTranscriptionButton.hidden = true;
  showWhisperStatus(message);
}

cancelTranscriptionButton.addEventListener('click', () => {
  cancelTranscription('Transcription cancelled.');
  generateSubtitles.focus();
});

generateSubtitles.addEventListener('click', async () => {
  const file = mediaSource?.file;
  if (!file || transcriptionJob) return;
  if (cues.length && !confirm('Replace the original subtitles with a new transcription?')) return;

  const job = new AbortController();
  const revision = originalImport.revision;
  transcriptionJob = job;
  generateSubtitles.disabled = true;
  cancelTranscriptionButton.hidden = false;
  try {
    const entries = await transcribeFile(file, job.signal, message => {
      if (transcriptionJob === job) showWhisperStatus(message);
    });
    if (transcriptionJob !== job) return;
    if (originalImport.revision !== revision) {
      cancelTranscription('Transcription discarded because another subtitle import was started.');
      return;
    }
    if (!entries.length) {
      cancelTranscription('Whisper found no speech in this file.');
      return;
    }
    cancelTranscription('Subtitles generated. Open Edit subtitles to review them.');
    originalImport.clear();
    applyOriginalSubtitles(entries);
  } catch (error) {
    if (transcriptionJob === job) cancelTranscription(error.message);
  }
});

const translationImport = connectSubtitleImport(
  document.querySelector('#translation'),
  document.querySelector('#translation-link'),
  document.querySelector('#translation-status'),
  (entries, remoteTrack) => {
    flushCheckpoint();
    platformTranslation = remoteTrack;
    materialsChanged = true;
    translation = indexCues(entries);
    clearTranslation.hidden = false;
    showTranslation();
    rememberWorkspace();
  },
);

youtubeTranscriptForm.addEventListener('submit', event => {
  event.preventDefault();
  if (youtubeTranscript.hidden) return;
  const importer = event.submitter?.value === 'translation' ? translationImport : originalImport;
  importer.loadTranscript(youtubeTranscriptForm.elements.namedItem('text').value);
});

function showPlatformTracks(platform, tracks, autoSelect, revision) {
  platformTrackLabel.textContent = `${platform} subtitles`;
  const options = document.createDocumentFragment();
  for (const track of tracks) options.append(new Option(track.label, track.url));
  platformTrack.replaceChildren(options);
  platformCaptionForm.hidden = !tracks.length;
  updatePlatformTrackFile();
  platformCaptionStatus.textContent = tracks.length ? '' : `No ${platform} subtitle tracks are available for this recording`;
  if (autoSelect && tracks.length && !cues.length && originalImport.revision === revision) {
    void originalImport.loadFromUrl(tracks[0].url, true);
  }
}

async function loadPlatformTracks(video, autoSelect) {
  const request = new AbortController();
  platformRequest = request;
  const revision = originalImport.revision;
  platformCaptionStatus.textContent = 'Finding PeerTube subtitles';
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    const tracks = await peerTubeTracks(video, request.signal);
    if (platformRequest === request) showPlatformTracks('PeerTube', tracks, autoSelect, revision);
  } catch {
    if (platformRequest === request) platformCaptionStatus.textContent = 'Could not list PeerTube subtitle tracks';
  } finally {
    clearTimeout(timeout);
    if (platformRequest === request) platformRequest = undefined;
  }
}

function showArchiveError(message) {
  mediaError = message;
  openSourceVideo.href = mediaSource.url;
  openSourceVideo.hidden = false;
  showMediaStatus();
}

function playArchiveFile(file) {
  archiveSelect.value = file.name;
  mediaSource = { ...mediaSource, archiveFile: file.name };
  openMedia(file.url);
  rememberWorkspace();
}

async function openArchive(id, source, record) {
  const request = new AbortController();
  platformRequest = request;
  const revision = originalImport.revision;
  status.textContent = 'Loading files from Internet Archive';
  const timeout = setTimeout(() => request.abort(), 12000);
  try {
    const item = await loadArchiveItem(id, type => player.canPlayType(type), request.signal);
    if (platformRequest !== request) return;
    archiveItem = item;
    const options = document.createDocumentFragment();
    for (const file of item.media) options.append(new Option(file.name, file.name));
    archiveSelect.replaceChildren(options);
    archiveForm.hidden = item.media.length < 2;
    if (!item.media.length) {
      showArchiveError('This Internet Archive item has no media files supported by your browser');
      return;
    }

    const file = source.archiveFile ? item.media.find(entry => entry.name === source.archiveFile) : item.media[0];
    if (!file) {
      showArchiveError('The saved Internet Archive file is unavailable. Open the item and choose another file.');
      return;
    }

    if (!source.archiveFile) archiveFallback = item.media.filter(entry => entry.group === file.group && entry !== file);
    if (!record && !lessonTitle.value) lessonTitle.value = item.title;
    playArchiveFile(file);
    showPlatformTracks('Internet Archive', archiveTracks(item, file), !record, revision);
  } catch {
    if (platformRequest === request) showArchiveError('Could not open this Internet Archive item. Check its link and availability.');
  } finally {
    clearTimeout(timeout);
    if (platformRequest === request) platformRequest = undefined;
  }
}

archiveForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!archiveItem || mediaSource.archiveFile === archiveSelect.value) return;
  const file = archiveItem.media.find(entry => entry.name === archiveSelect.value);
  if (!file) return;

  flushCheckpoint();
  const previous = archiveItem.media.find(entry => entry.name === mediaSource.archiveFile);
  const sameRecording = previous?.group === file.group;
  if (sameRecording) {
    restorePosition = currentPosition();
    materialsChanged = true;
  } else {
    clearRestorePosition();
    savedId = undefined;
    originalImport.clear();
    translationImport.clear();
    platformOriginal = false;
    platformTranslation = false;
    resetProgress();
    translation = indexCues([]);
    clearTranslation.hidden = true;
    setCues([]);
  }

  archiveFallback = [];
  playArchiveFile(file);
  showPlatformTracks('Internet Archive', archiveTracks(archiveItem, file), true, originalImport.revision);
});

function updatePlatformTrackFile() {
  platformTrackFile.hidden = !platformTrack.value;
  if (platformTrack.value) platformTrackFile.href = platformTrack.value;
  else platformTrackFile.removeAttribute('href');
}

platformTrack.addEventListener('change', updatePlatformTrackFile);

platformCaptionForm.addEventListener('submit', event => {
  event.preventDefault();
  const importer = event.submitter?.value === 'translation' ? translationImport : originalImport;
  if (!platformCaptionForm.hidden && platformTrack.value) void importer.loadFromUrl(platformTrack.value, true);
});

clearTranslation.addEventListener('click', () => {
  flushCheckpoint();
  platformTranslation = false;
  materialsChanged = true;
  translationImport.clear();
  translation = indexCues([]);
  clearTranslation.hidden = true;
  showTranslation();
  rememberWorkspace();
});

mode.addEventListener('change', () => {
  restoredAnswer = undefined;
  if (restorePosition) {
    const index = restorePosition.index;
    clearRestorePosition();
    if (mode.value !== 'watch' && cues[index]) showCue(index);
  }
  updateMode();
  rememberWorkspace();
});
player.addEventListener('timeupdate', () => {
  if (!embeddedPlayback) syncPlayback();
});
for (const event of ['pause', 'seeking']) {
  player.addEventListener(event, () => { listeningSample = undefined; });
}
player.addEventListener('seeked', () => {
  if (!embeddedPlayback) rememberWorkspace();
});
transcript.addEventListener('click', event => {
  const button = event.target.closest('button[data-index]');
  if (!button) return;
  clearRestorePosition();
  const index = Number(button.dataset.index);
  if (mode.value === 'watch') {
    const source = playback;
    const seek = source.seek(cues[index].start);
    if (seek) {
      void seek.catch(() => {
        if (source === playback) status.textContent = 'Could not jump to this phrase. Check whether the media supports seeking.';
      });
    } else {
      showCue(index);
    }
  } else {
    void playCue(index);
  }
});

repeat.addEventListener('click', () => {
  if (answerAccepted) showCue(current);
  void playCue(current);
});
next.addEventListener('click', () => void playCue(current + 1));
hint.addEventListener('click', () => {
  const text = cues[current]?.text;
  if (!text) return;
  const parts = graphemes ? Array.from(graphemes.segment(text), part => part.segment) : Array.from(text);
  hintLength = Math.min(hintLength + 1, parts.length);
  cueText.textContent = parts.slice(0, hintLength).join('');
});

function renderProgress() {
  const stats = summarizeProgress(progress);
  phraseProgress.textContent = `${stats.completed} / ${cues.length}`;
  accuracyProgress.textContent = stats.attempts
    ? `${Math.round(stats.correct / stats.attempts * 100)}% (${stats.correct}/${stats.attempts})`
    : '—';
  listeningProgress.textContent = formatCueTime(progress.listeningMs / 1000);
}

function resetProgress(record) {
  progress = record?.stats ?? emptyProgress();
  progressRevision = record ? record.progressRevision ?? null : newId();
  pendingProgress = emptyProgress();
  listeningSample = undefined;
  renderProgress();
}

function splitAnswer(text) {
  return graphemes ? Array.from(graphemes.segment(text), part => part.segment) : Array.from(text);
}

function exerciseAnswer(text) {
  return normalize(text.replace(punctuation, ''));
}

function showTypingMatch(expected, typed) {
  if (mode.value !== 'typing') return;
  const items = document.createDocumentFragment();
  let index = 0;
  let spacePending = false;
  let group;
  for (const character of splitAnswer(expected)) {
    let match = 'optional';
    const significant = character.replace(punctuation, '');
    if (significant === ' ') {
      spacePending = index > 0;
    } else if (significant) {
      if (spacePending) index++;
      spacePending = false;
      match = index >= typed.length ? 'pending'
        : significant === typed[index] ? 'correct' : 'incorrect';
      index++;
    }
    if (group?.dataset.match !== match) {
      group = document.createElement('span');
      group.dataset.match = match;
      items.append(group);
    }
    group.textContent += character;
  }
  cueText.replaceChildren(items);
}

function checkAnswer(manual = false, preview = false) {
  const cue = cues[current];
  if (!cue || lesson.hidden || mode.value === 'watch' || composingAnswer || answerAccepted) return;

  const display = normalize(cue.text);
  const expected = exerciseAnswer(display);
  const response = exerciseAnswer(answer.value);
  const correct = Boolean(response) && response === expected;
  const mismatch = !expected.startsWith(response);
  showTypingMatch(display, splitAnswer(response));
  if (response) answer.dataset.match = mismatch ? 'incorrect' : correct ? 'correct' : 'pending';
  else delete answer.dataset.match;
  answer.setAttribute('aria-invalid', String(mismatch));

  if (preview) return;
  if (!response || (!correct && !manual)) {
    rememberWorkspace();
    return;
  }
  answerAccepted = correct;
  if (correct) answer.readOnly = true;
  feedback.textContent = correct ? 'Correct' : 'Some text differs. Try again.';
  const key = phraseKey(cue);
  for (const target of [progress, pendingProgress]) {
    const result = target.phrases[key] ??= { attempts: 0, correct: 0 };
    result.attempts++;
    if (correct) result.correct++;
  }
  renderProgress();
  flushCheckpoint();

  if (!correct) return;
  if (current >= cues.length - 1) {
    feedback.textContent = 'Correct. Last phrase completed.';
    return;
  }

  const nextIndex = current + 1;
  advanceTimer = setTimeout(() => {
    if (!lesson.hidden && mode.value !== 'watch') void playCue(nextIndex);
  }, 400);
}

function soundForInput(data) {
  if (!data || answerAccepted || !cues[current]) return;
  const expected = exerciseAnswer(cues[current].text);
  const prefix = exerciseAnswer(answer.value.slice(0, answer.selectionStart));
  const insertedLength = exerciseAnswer(data).length;
  const start = Math.max(0, prefix.length - insertedLength);
  void playTypingSound(prefix.slice(start) !== expected.slice(start, prefix.length));
}

answer.addEventListener('compositionstart', () => { composingAnswer = true; });
answer.addEventListener('compositionend', event => {
  composingAnswer = false;
  soundForInput(event.data);
  checkAnswer();
});
answer.addEventListener('input', event => {
  if (event.isComposing || composingAnswer) return;
  if (!answerAccepted) feedback.textContent = '';
  if (event.inputType === 'insertText') soundForInput(event.data);
  checkAnswer();
});
answer.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composingAnswer) return;
  event.preventDefault();
  checkAnswer(true);
});

document.querySelector('#check').addEventListener('click', () => checkAnswer(true));

function currentPosition() {
  if (restorePosition) return restorePosition;
  return { mode: mode.value, index: current, time: playback.currentTime };
}

function clearRestorePosition() {
  restorePosition = undefined;
  resumeButton.hidden = true;
}

function rememberWorkspace() {
  if (restoringWorkspace || (!mediaSource && !cues.length && !translation.entries.length && !workspaceTouched)) return;
  workspaceTouched = true;
  const materials = { source: mediaSource, file: mediaSource?.file, original: cues, translation: translation.entries };
  const position = currentPosition();
  try {
    localStorage.setItem(workspacePositionKey, JSON.stringify({ workspaceSession, position }));
  } catch {}
  const state = {
    id: savedId,
    workspaceSession,
    title: lessonTitle.value,
    position,
    stats: structuredClone(progress),
    progressRevision,
    materialsChanged,
    answer: restoredAnswer ?? { index: current, text: answer.value, accepted: answerAccepted },
  };
  const source = mediaSource ? { ...mediaSource } : null;
  workspaceWrite = workspaceWrite.then(async () => {
    const previous = workspaceMaterials;
    const sourceChanged = !previous || previous.source !== materials.source || previous.file !== materials.file;
    const tracksChanged = !previous || previous.original !== materials.original || previous.translation !== materials.translation;
    await saveWorkspace(state, sourceChanged ? source : undefined, tracksChanged ? {
      original: materials.original, translation: materials.translation,
    } : undefined);
    workspaceMaterials = materials;
  }).catch(() => {
    libraryStatus.textContent = 'Could not save the current workspace in this browser';
  });
}

function queueCheckpoint() {
  if ((!mediaSource && lesson.hidden) || checkpointTimer) return;
  checkpointTimer = setTimeout(flushCheckpoint, 1000);
}

function flushCheckpoint() {
  if (checkpointTimer) clearTimeout(checkpointTimer);
  checkpointTimer = undefined;
  rememberWorkspace();
  if (!savedId || materialsChanged || lesson.hidden) return;
  const id = savedId;
  const revision = progressRevision;
  const position = currentPosition();
  const pending = pendingProgress;
  pendingProgress = emptyProgress();
  checkpointWrite = checkpointWrite.then(() => savePosition(id, position, revision, pending)).catch(() => {
    if (savedId === id && progressRevision === revision) pendingProgress = mergeProgress(pending, pendingProgress);
    libraryStatus.textContent = 'Could not save the lesson position and progress';
  });
}

function updateSaveButton() {
  saveButton.disabled = libraryBusy || lesson.hidden || !mediaSource;
}

async function renderLibrary() {
  const records = await listLessons();
  const items = records.map(record => {
    const item = document.createElement('li');
    const open = document.createElement('button');
    open.textContent = record.title;
    open.addEventListener('click', () => void openSavedLesson(record.id));
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete the lesson “${record.title}”`);
    remove.addEventListener('click', () => {
      if (confirm(`Delete the lesson “${record.title}”?`)) {
        void libraryAction(async () => {
          await deleteLesson(record.id);
          if (savedId === record.id) {
            savedId = undefined;
            rememberWorkspace();
          }
          if (pendingReconnect?.id === record.id) closeReconnect();
          await renderLibrary();
        }, 'Could not delete the lesson');
      }
    });
    item.append(open, remove);
    return item;
  });
  savedLessons.replaceChildren(...items);
}

async function libraryAction(action, errorMessage) {
  if (libraryBusy) return;
  libraryBusy = true;
  libraryStatus.textContent = '';
  updateSaveButton();
  try {
    await action();
  } catch (error) {
    libraryStatus.textContent = error?.name === 'QuotaExceededError'
      ? 'Your browser storage is full' : errorMessage;
  } finally {
    libraryBusy = false;
    updateSaveButton();
  }
}

function closeReconnect() {
  pendingReconnect = undefined;
  reconnectFile.value = '';
  reconnectForm.hidden = true;
}

function showReconnect(record, time) {
  pendingReconnect = { id: record.id, local: record.source.local, time };
  reconnectFile.value = '';
  reconnectLabel.textContent = `Source file: ${record.source.local.name}`;
  reconnectForm.hidden = false;
  reconnectFile.focus();
}

function applySavedLesson(record, time) {
  if (!record || !openSource(record.source, record)) throw new Error('Missing lesson');
  media.value = '';
  originalImport.clear();
  translationImport.clear();
  restorePosition = time === undefined ? record.position : { mode: 'watch', index: -1, time };
  mode.value = restorePosition.mode;
  translation = indexCues(record.translation);
  clearTranslation.hidden = !record.translation.length;
  setCues(record.original);
  if (time !== undefined) document.querySelector('.playback').scrollIntoView();
}

async function openSavedLesson(id, time) {
  await libraryAction(async () => {
    flushCheckpoint();
    const source = mediaSource;
    await checkpointWrite;
    const record = await loadLesson(id);
    if (mediaSource !== source) return;
    if (record?.source.local) {
      showReconnect(record, time);
      return;
    }
    applySavedLesson(record, time);
  }, 'Could not open the saved lesson');
}

document.querySelector('#cancel-reconnect').addEventListener('click', closeReconnect);
reconnectForm.addEventListener('submit', event => {
  event.preventDefault();
  const target = pendingReconnect;
  const file = reconnectFile.files[0];
  if (!target || !file) return;
  if (file.size !== target.local.size) {
    libraryStatus.textContent = 'This file is a different size. Choose the original media file used in the lesson.';
    return;
  }

  void libraryAction(async () => {
    if (!await reconnectMedia(target.id, file)) throw new Error('Missing source file');
    const record = await loadLesson(target.id);
    if (pendingReconnect !== target) return;
    applySavedLesson(record, target.time);
    libraryStatus.textContent = 'Source file reconnected';
  }, 'Could not reconnect the file');
});

lessonTitle.addEventListener('input', rememberWorkspace);

document.querySelector('#export-library').addEventListener('click', () => {
  void libraryAction(async () => {
    flushCheckpoint();
    await checkpointWrite;
    const { lessons, vocabulary } = await exportLibrary();
    const blob = new Blob([JSON.stringify(createBackup(lessons, vocabulary))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cuereel-library.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    libraryStatus.textContent = 'Library backup ready';
  }, 'Could not create the library backup');
});

document.querySelector('#import-library').addEventListener('submit', event => {
  event.preventDefault();
  const file = backupFile.files[0];
  if (!file) return;

  void libraryAction(async () => {
    let backup;
    try {
      backup = parseBackup(await file.text());
    } catch {
      libraryStatus.textContent = 'This file is not a supported library backup';
      return;
    }
    const counts = await importLibrary(backup);
    await renderLibrary();
    void refreshVocabulary();
    backupFile.value = '';
    libraryStatus.textContent = `Imported lessons: ${counts.lessons}, cards: ${counts.cards}. Already in the library: ${counts.skipped}.`;
  }, 'Could not import the library backup');
});

saveForm.addEventListener('submit', event => {
  event.preventDefault();
  const title = lessonTitle.value.trim();
  if (saveButton.disabled || !title) return;
  void libraryAction(async () => {
    const source = mediaSource;
    const original = cues;
    const translated = translation.entries;
    const id = savedId ?? newId();
    const revision = progressRevision;
    const position = currentPosition();
    const snapshot = structuredClone(progress);
    const pending = pendingProgress;
    pendingProgress = emptyProgress();
    try {
      const write = checkpointWrite.then(() => saveLesson(
        { id, title, savedAt: Date.now(), position, progressRevision: revision },
        { source, original, translation: translated },
        snapshot,
        pending,
      ));
      checkpointWrite = write.catch(() => {});
      await write;
    } catch (error) {
      if (progressRevision === revision) pendingProgress = mergeProgress(pending, pendingProgress);
      throw error;
    }
    if (mediaSource === source && progressRevision === revision && cues === original && translation.entries === translated) {
      savedId = id;
      materialsChanged = false;
      rememberWorkspace();
      queueCheckpoint();
    }
    await renderLibrary();
    libraryStatus.textContent = 'Lesson saved';
  }, 'Could not save the lesson');
});

resumeButton.addEventListener('click', async () => {
  const position = restorePosition;
  if (!position) return;
  const source = playback;
  try {
    await source.seek(position.time);
    if (source !== playback) return;
    clearRestorePosition();
    syncPlayback();
  } catch {
    if (source === playback) libraryStatus.textContent = 'Could not restore the position. Start the video and try again.';
  }
});

window.addEventListener('pagehide', flushCheckpoint);
document.addEventListener('visibilitychange', () => {
  listeningSample = undefined;
  if (document.hidden) flushCheckpoint();
});
void renderLibrary().catch(() => {
  libraryStatus.textContent = 'Lesson storage is unavailable in this browser';
});

const previewOriginal = document.querySelector('#preview-original');
const previewTranslation = document.querySelector('#preview-translation');
const previewBars = document.querySelectorAll('.preview-wave i');
const demoButton = document.querySelector('#load-demo');
const demoOriginal = [
  { start: 0, end: 3, text: 'Then let’s meet at the station.' },
  { start: 3, end: 6, text: 'I’ll be there a little early.' },
];
const demoTranslation = [
  { start: 0, end: 3, text: 'Тогда встретимся у вокзала.' },
  { start: 3, end: 6, text: 'Я приду чуть раньше.' },
];

function updatePreview() {
  const time = demoAudio.currentTime;
  const index = time < demoOriginal[1].start ? 0 : 1;
  previewOriginal.textContent = demoOriginal[index].text;
  previewTranslation.textContent = demoTranslation[index].text;
  previewBars.forEach((bar, i) => bar.classList.toggle('is-played', i / previewBars.length < time / 6));
}

for (const event of ['timeupdate', 'play', 'pause', 'ended']) {
  demoAudio.addEventListener(event, updatePreview);
}

demoButton.addEventListener('click', async () => {
  demoAudio.pause();
  const source = { url: demoAudio.src };
  sampleSource = source;
  openSource(source);
  media.value = '';
  originalImport.clear();
  translationImport.clear();
  lessonTitle.value = 'At the station';
  mode.value = 'typing';
  translation = indexCues(demoTranslation);
  clearTranslation.hidden = false;
  setCues(demoOriginal);
  practiceTitle.focus({ preventScroll: true });
  lesson.scrollIntoView({ block: 'start' });

  try {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error('Sample audio unavailable');
    const audio = await response.blob();
    if (mediaSource !== source) return;
    source.file = new File([audio], 'At the station.mp3', { type: 'audio/mpeg' });
    setNativeMedia(URL.createObjectURL(source.file));
    rememberWorkspace();
  } catch {
    if (mediaSource !== source) return;
    mediaError = 'Could not load the sample audio';
    showMediaStatus();
  }
});

connectSubtitleEditor(
  () => ({ original: cues, translation: translation.entries, index: current }),
  (track, entries) => {
    flushCheckpoint();
    materialsChanged = true;
    if (track === 'translation') {
      platformTranslation = false;
      translationImport.clear();
      translation = indexCues(entries);
      showTranslation();
      rememberWorkspace();
      return;
    }

    platformOriginal = false;
    originalImport.clear();
    trackSelect.value = '';
    releaseTrack();
    const revised = emptyProgress();
    revised.listeningMs = progress.listeningMs;
    for (const cue of entries) {
      const key = phraseKey(cue);
      if (progress.phrases[key]) revised.phrases[key] = progress.phrases[key];
    }
    progress = revised;
    progressRevision = newId();
    pendingProgress = emptyProgress();
    setCues(entries);
  },
);

const refreshVocabulary = connectVocabulary(() => {
  const cue = cues[current];
  if (!cue || mode.value === 'dictation') return null;

  return {
    context: cue.text,
    translation: translation.between(cue.start, cue.end).map(line => line.text).join(' '),
    source: [lessonTitle.value.trim(), formatCueTime(cue.start)].filter(Boolean).join(' · '),
    lessonId: savedId,
    time: cue.start,
  };
}, openSavedLesson);

void loadWorkspace().then(workspace => {
  if (!workspace || workspaceTouched) return;
  restoringWorkspace = true;
  try {
    if (workspace.source && !openSource(workspace.source, workspace)) return;
    if (!workspace.source) {
      resetProgress(workspace);
      workspaceSession = workspace.workspaceSession ?? workspaceSession;
    }
    materialsChanged = workspace.materialsChanged;
    lessonTitle.value = workspace.title;
    restorePosition = workspace.source ? workspace.position : undefined;
    try {
      const latest = JSON.parse(localStorage.getItem(workspacePositionKey));
      if (restorePosition && latest?.workspaceSession === workspaceSession) {
        restorePosition = latest.position;
      }
    } catch {}
    restoredAnswer = workspace.answer;
    mode.value = restorePosition?.mode ?? workspace.position.mode;
    translation = indexCues(workspace.translation);
    clearTranslation.hidden = !workspace.translation.length;
    setCues(workspace.original);
    if (workspace.sourceStored) {
      workspaceMaterials = { source: mediaSource, file: mediaSource?.file, original: cues, translation: translation.entries };
    }
    workspaceTouched = true;
  } finally {
    restoringWorkspace = false;
  }
}).catch(() => {
  libraryStatus.textContent = 'Could not restore the current workspace';
});
