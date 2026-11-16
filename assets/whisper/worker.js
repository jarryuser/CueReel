import createRuntime from './whisper-runtime.js';

const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin';
const modelHash = '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898';

async function loadWeights() {
  const cache = await self.caches?.open('cuereel-whisper-v1').catch(() => undefined);
  const cached = await cache?.match(modelUrl).catch(() => undefined);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  self.postMessage({ status: 'Downloading Whisper Base Q5 (60 MB)…' });
  const response = await fetch(modelUrl, { credentials: 'omit' });
  if (!response.ok) throw new Error('Could not download Whisper Base Q5. Check your connection and try again.');
  const weights = await response.arrayBuffer();
  if (self.crypto.subtle) {
    const digest = new Uint8Array(await self.crypto.subtle.digest('SHA-256', weights));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== modelHash) throw new Error('The Whisper model download was damaged. Try again.');
  }
  await cache?.put(modelUrl, new Response(weights)).catch(() => {});
  return new Uint8Array(weights);
}

self.onmessage = async event => {
  let stage = 'Could not start Whisper WebAssembly in this browser.';
  try {
    const runtime = await createRuntime({ print: () => {}, printErr: () => {} });
    stage = 'Could not download Whisper Base Q5. Check your connection and try again.';
    const weights = await loadWeights();
    stage = 'Whisper could not transcribe this file. Try a shorter file if the device is low on memory.';
    self.postMessage({ status: 'Transcribing on this device…' });
    const cues = runtime.transcribe(weights, event.data, progress => {
      self.postMessage({ status: `Transcribing on this device… ${progress}%` });
    });
    if (!cues) throw new Error();
    self.postMessage({ cues });
  } catch (error) {
    self.postMessage({ error: error.message?.startsWith('The Whisper model') ? error.message : stage });
  }
};
