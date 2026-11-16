(() => {
  const preference = matchMedia('(prefers-color-scheme: dark)');
  const key = 'own-vocatype-theme';
  let choice;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') choice = saved;
  } catch {}

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    const button = document.querySelector('#toggle-theme');
    if (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    }
  }

  function applyPreference() {
    apply(choice || (preference.matches ? 'dark' : 'light'));
  }

  applyPreference();
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('#toggle-theme');
    applyPreference();
    button.addEventListener('click', () => {
      choice = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(choice);
      try { localStorage.setItem(key, choice); } catch {}
    });
  });
  if (preference.addEventListener) preference.addEventListener('change', applyPreference);
  else preference.addListener(applyPreference);
})();
