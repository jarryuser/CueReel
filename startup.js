(() => {
  const demoStatus = document.querySelector('#demo-status');
  const appStatus = document.querySelector('#app-load-status');

  function showStartupStatus(message) {
    demoStatus.textContent = message;
    appStatus.textContent = message;
  }

  if (location.protocol === 'file:') {
    showStartupStatus('This page was opened as a file. Open CueReel at its HTTP address, such as http://127.0.0.1:8000.');
    return;
  }

  const slowStartup = setTimeout(() => {
    showStartupStatus('The lesson controls are taking longer than expected. Reload the page to try again.');
  }, 8000);

  import('./app.js?v=8').then(() => {
    document.querySelector('#media-link-fields').disabled = false;
    document.querySelector('#load-demo').disabled = false;
    showStartupStatus('');
  }).catch(error => {
    console.error('Could not start CueReel', error);
    showStartupStatus('The lesson controls failed to load. Reload the page. If the error persists, check that the server is serving the project’s JavaScript files.');
  }).finally(() => clearTimeout(slowStartup));

  const fonts = document.querySelector('#web-fonts');
  fonts.media = 'print';
  fonts.addEventListener('load', () => { fonts.media = 'all'; }, { once: true });
  fonts.href = fonts.dataset.href;
})();
