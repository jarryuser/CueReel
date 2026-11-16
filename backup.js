import { webUrl } from './browser.js';
import { emptyProgress, phraseKey } from './progress.js';

const format = 'own-vocatype-library';
const version = 1;
const modes = ['watch', 'typing', 'dictation'];

export function createBackup(lessons, vocabulary) {
  return { format, version, lessons, vocabulary };
}

function requireBackup(condition) {
  if (!condition) throw new Error('Invalid library backup');
}

const text = value => typeof value === 'string';
const nonnegative = value => Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;

function readTrack(track) {
  requireBackup(Array.isArray(track));
  return track.map(cue => {
    requireBackup(cue && nonnegative(cue.start) && nonnegative(cue.end) && cue.end > cue.start
      && text(cue.text) && cue.text.trim());
    return { start: cue.start, end: cue.end, text: cue.text };
  });
}

function readSource(source) {
  requireBackup(source && typeof source === 'object');
  if (source.url !== undefined) {
    const url = text(source.url) ? webUrl(source.url) : null;
    requireBackup(url);
    requireBackup(source.archiveFile === undefined || text(source.archiveFile));
    return {
      url: url.href,
      ...(source.archiveFile === undefined ? {} : { archiveFile: source.archiveFile }),
    };
  }

  const local = source.local;
  requireBackup(local && text(local.name) && local.name && count(local.size));
  return { local: { name: local.name, size: local.size } };
}

function readStats(stats, original) {
  if (stats === undefined) return emptyProgress();
  requireBackup(stats && count(stats.listeningMs) && stats.phrases && typeof stats.phrases === 'object'
    && !Array.isArray(stats.phrases));
  const phrases = {};
  for (const cue of original) {
    const key = phraseKey(cue);
    if (!Object.hasOwn(stats.phrases, key)) continue;
    const result = stats.phrases[key];
    requireBackup(result && count(result.attempts) && count(result.correct) && result.correct <= result.attempts);
    phrases[key] = { attempts: result.attempts, correct: result.correct };
  }
  return { phrases, listeningMs: stats.listeningMs };
}

function readLesson(value) {
  requireBackup(value && text(value.id) && value.id && text(value.title) && value.title.trim() && nonnegative(value.savedAt));
  const position = value.position;
  requireBackup(position && modes.includes(position.mode) && Number.isSafeInteger(position.index)
    && position.index >= -1 && nonnegative(position.time));
  const original = readTrack(value.original);
  requireBackup(original.length && position.index < original.length);
  return {
    lesson: {
      id: value.id,
      title: value.title,
      savedAt: value.savedAt,
      position: { mode: position.mode, index: position.index, time: position.time },
      progressRevision: null,
      stats: readStats(value.stats, original),
    },
    materials: { source: readSource(value.source), original, translation: readTrack(value.translation) },
  };
}

function readCard(card) {
  requireBackup(card && text(card.id) && card.id && text(card.term) && card.term.trim()
    && text(card.meaning) && card.meaning.trim() && text(card.context)
    && text(card.source) && count(card.stage) && card.stage <= 4 && nonnegative(card.due)
    && nonnegative(card.time) && (card.lessonId === undefined || text(card.lessonId)));
  return {
    id: card.id, term: card.term, meaning: card.meaning, context: card.context, source: card.source,
    stage: card.stage, due: card.due, time: card.time, lessonId: card.lessonId,
  };
}

export function parseBackup(source) {
  const backup = JSON.parse(source.replace(/^\uFEFF/u, ''));
  requireBackup(backup?.format === format && backup.version === version
    && Array.isArray(backup.lessons) && Array.isArray(backup.vocabulary));
  return { lessons: backup.lessons.map(readLesson), vocabulary: backup.vocabulary.map(readCard) };
}
