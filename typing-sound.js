export function connectTypingSound(toggle) {
  const key = 'cuereel-typing-sound';
  let context;
  try { toggle.checked = localStorage.getItem(key) === 'on'; } catch {}
  toggle.addEventListener('change', () => {
    try { localStorage.setItem(key, toggle.checked ? 'on' : 'off'); } catch {}
  });

  return async function playTypingSound(wrong) {
    if (!toggle.checked) return;
    try {
      context ??= new AudioContext();
      if (context.state === 'suspended') await context.resume();
      if (!toggle.checked || context.state !== 'running') return;
      const start = context.currentTime;
      const tone = context.createOscillator();
      const volume = context.createGain();
      const duration = wrong ? 0.12 : 0.036;
      tone.type = wrong ? 'triangle' : 'square';
      tone.frequency.setValueAtTime(wrong ? 300 : 1050, start);
      tone.frequency.exponentialRampToValueAtTime(wrong ? 155 : 240, start + duration);
      volume.gain.setValueAtTime(wrong ? 0.085 : 0.026, start);
      volume.gain.exponentialRampToValueAtTime(0.001, start + duration);
      tone.connect(volume).connect(context.destination);
      tone.start(start);
      tone.stop(start + duration);
    } catch {}
  };
}
