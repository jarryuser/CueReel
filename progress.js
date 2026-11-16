export const emptyProgress = () => ({ phrases: {}, listeningMs: 0 });

export function phraseKey(cue) {
  return JSON.stringify([cue.start, cue.end, cue.text]);
}

export function mergeProgress(base, update) {
  const phrases = { ...base?.phrases };
  for (const [key, answer] of Object.entries(update.phrases)) {
    const previous = phrases[key];
    phrases[key] = {
      attempts: (previous?.attempts ?? 0) + answer.attempts,
      correct: (previous?.correct ?? 0) + answer.correct,
    };
  }
  return { phrases, listeningMs: (base?.listeningMs ?? 0) + update.listeningMs };
}

export function summarizeProgress(progress) {
  let completed = 0;
  let attempts = 0;
  let correct = 0;
  for (const phrase of Object.values(progress.phrases)) {
    attempts += phrase.attempts;
    correct += phrase.correct;
    if (phrase.correct) completed++;
  }
  return { completed, attempts, correct };
}

export function listenedMs(previous, current) {
  if (!previous || !current) return 0;
  const elapsed = current.wall - previous.wall;
  const advanced = (current.media - previous.media) * 1000;
  if (elapsed <= 0 || elapsed > 1500 || advanced <= 0 || advanced > elapsed * 4 + 100) return 0;
  return Math.round(elapsed);
}
