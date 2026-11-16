const sampleRate = 16000;

async function decodeAudio(file) {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const audio = await context.decodeAudioData(await file.arrayBuffer());
  if (audio.numberOfChannels === 1) return new Float32Array(audio.getChannelData(0));

  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const samples = audio.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) mono[i] += samples[i] / audio.numberOfChannels;
  }
  return mono;
}

export async function transcribeFile(file, signal, showStatus) {
  showStatus('Reading the audio track…');
  let samples;
  try {
    samples = await decodeAudio(file);
  } catch {
    throw new Error('Could not decode the audio track. Try a WAV or MP3 file.');
  }
  signal.throwIfAborted();
  showStatus('Starting Whisper Base Q5…');
  const worker = new Worker(new URL('./assets/whisper/worker.js', import.meta.url), { type: 'module' });
  const duration = samples.length / sampleRate;
  let abort;
  try {
    const cues = await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }) => {
        if (data.status) showStatus(data.status);
        else if (data.error) reject(new Error(data.error));
        else resolve(data.cues);
      };
      worker.onerror = () => reject(new Error('Could not start the Whisper worker. Reload the page and try again.'));
      worker.postMessage(samples, [samples.buffer]);
    });
    return cues.map(({ start, end, text }) => ({
      start: Math.max(0, start),
      end: Math.min(end, duration),
      text: text.trim(),
    })).filter(cue => cue.text && cue.end > cue.start);
  } finally {
    signal.removeEventListener('abort', abort);
    worker.terminate();
  }
}
