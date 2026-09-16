(() => {
  'use strict';

  const BUILD_VERSION = document.querySelector('meta[name="r5-app-version"]')?.content || 'unknown';
  const PREF_KEY = 'r5-atlas-auto-updates';
  const LAST_BUILD_KEY = 'r5-atlas-last-build';
  const CHECK_INTERVAL = 15 * 60 * 1000;
  let installPrompt = null;
  let settingsGear = null;
  let notice = null;
  let updateInProgress = false;
  let notifiedVersion = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));
  }

  function notesHtml(release) {
    const notes = Array.isArray(release?.notes) ? release.notes : [];
    if (!notes.length) return '<p>No patch notes were supplied for this release.</p>';
    return `<ul>${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`;
  }

  function injectStyles() {
    if (document.getElementById('r5-app-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'r5-app-ui-style';
    style.textContent = `
      #r5-settings-gear{width:34px;height:34px;min-width:34px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.11);color:#fff;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0;margin-right:8px;font:700 19px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:none;cursor:pointer;flex:0 0 auto}
      #r5-settings-gear:active{transform:scale(.96)} #r5-settings-gear.r5-update-ready{background:#7a3df0;border-color:#b69cff;box-shadow:0 0 0 2px rgba(122,61,240,.18)}
      #r5-settings-gear.r5-settings-gear-fallback{position:fixed;right:285px;top:12px;z-index:2147483000}
      #r5-app-overlay{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;padding:18px}
      #r5-app-modal{width:min(520px,100%);max-height:min(760px,90vh);overflow:auto;background:#171a20;color:#f7f7f8;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.5);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #r5-app-modal h2{font-size:20px;margin:0 0 8px} #r5-app-modal p{margin:8px 0;color:#d6d7db} #r5-app-modal ul{padding-left:20px;color:#e7e7ea} #r5-app-modal li{margin:7px 0}
      .r5-app-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}.r5-app-actions button{border:0;border-radius:10px;padding:10px 14px;font:700 14px system-ui;cursor:pointer;background:#333842;color:#fff}.r5-app-actions button.r5-primary{background:#7a3df0}.r5-app-actions button.r5-good{background:#237a4b}.r5-app-actions button.r5-muted{background:#292d34;color:#d4d5da}
      #r5-app-notice{position:fixed;left:12px;right:12px;bottom:64px;z-index:2147483500;margin:auto;width:min(560px,calc(100% - 24px));background:#171a20;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:14px 16px;box-shadow:0 12px 42px rgba(0,0,0,.4);font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #r5-app-notice strong{display:block;margin-bottom:4px}.r5-notice-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.r5-notice-actions button{border:0;border-radius:9px;padding:8px 11px;font:700 13px system-ui;cursor:pointer}.r5-notice-actions .r5-primary{background:#7a3df0;color:#fff}.r5-notice-actions .r5-muted{background:#30343c;color:#fff}
      .r5-setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid rgba(255,255,255,.1)}.r5-setting:first-of-type{border-top:0}.r5-small{font-size:12px;color:#aeb1b8!important}
      .r5-settings-list{margin-top:14px;border:1px solid rgba(255,255,255,.1);border-radius:13px;overflow:hidden}.r5-settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px;border-top:1px solid rgba(255,255,255,.09);background:#1d2128}.r5-settings-row:first-child{border-top:0}.r5-settings-row strong{font-size:13px}.r5-settings-row span{font-size:11px;color:#9fa4ad;text-align:right}.r5-settings-row .r5-live{color:#79d8a4}.r5-settings-section{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8f96a0;margin:16px 0 6px;font-weight:800}
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById('r5-app-overlay')?.remove();
  }

  function showModal(title, bodyHtml, actions) {
    closeModal();
    injectStyles();
    const overlay = document.createElement('div');
    overlay.id = 'r5-app-overlay';
    const modal = document.createElement('div');
    modal.id = 'r5-app-modal';
    modal.innerHTML = `<h2>${escapeHtml(title)}</h2>${bodyHtml}<div class="r5-app-actions"></div>`;
    const actionWrap = modal.querySelector('.r5-app-actions');
    actions.forEach(action => {
      const button = document.createElement('button');
      button.textContent = action.label;
      if (action.className) button.className = action.className;
      button.addEventListener('click', action.onClick);
      actionWrap.appendChild(button);
    });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return overlay;
  }

  function hideNotice() {
    notice?.remove();
    notice = null;
  }

  function showNotice(title, text, actions = []) {
    hideNotice();
    injectStyles();
    notice = document.createElement('div');
    notice.id = 'r5-app-notice';
    notice.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(text)}</div><div class="r5-notice-actions"></div>`;
    const wrap = notice.querySelector('.r5-notice-actions');
    actions.forEach(action => {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.className = action.className || 'r5-muted';
      button.addEventListener('click', action.onClick);
      wrap.appendChild(button);
    });
    document.body.appendChild(notice);
  }

  async function fetchRelease() {
    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const release = await response.json();
      return release && typeof release.version === 'string' ? release : null;
    } catch (_) {
      return null;
    }
  }

  function getPreference() {
    const value = localStorage.getItem(PREF_KEY);
    return value === 'yes' || value === 'no' ? value : null;
  }

  function setPreference(value) {
    localStorage.setItem(PREF_KEY, value);
  }

  function askPreference(afterChoice) {
    showModal(
      'Automatic app updates?',
      '<p>Choose how R5 Atlas should handle new versions.</p><p><strong>Yes:</strong> updates are installed automatically when a new version is detected. Afterward, R5 Atlas tells you the new version and shows the patch notes.</p><p><strong>No:</strong> R5 Atlas stays on your current version and notifies you that an update is available, including the patch notes and an Update now button.</p>',
      [
        { label: 'Yes — automatic updates', className: 'r5-good', onClick: () => { setPreference('yes'); closeModal(); afterChoice?.('yes'); } },
        { label: 'No — notify me first', className: 'r5-primary', onClick: () => { setPreference('no'); closeModal(); afterChoice?.('no'); } }
      ]
    );
  }

  async function waitForWaitingWorker(registration) {
    if (registration.waiting) return registration.waiting;
    const worker = registration.installing;
    if (!worker) return registration.waiting;
    if (worker.state === 'installed') return worker;
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 12000);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    return registration.waiting || (worker.state === 'installed' ? worker : null);
  }

  async function applyRelease(release) {
    if (updateInProgress || !release?.version || !('serviceWorker' in navigator)) return;
    updateInProgress = true;
    hideNotice();
    showNotice('Updating R5 Atlas', `Installing v${release.version}…`);
    try {
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      }, { once: true });

      const registration = await navigator.serviceWorker.register(
        `./sw.js?v=${encodeURIComponent(release.version)}`,
        { scope: './', updateViaCache: 'none' }
      );
      await registration.update();
      const waiting = await waitForWaitingWorker(registration);
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
      else window.location.reload();
    } catch (error) {
      updateInProgress = false;
      showNotice('Update could not be installed', 'R5 Atlas will try again when you are online.', [
        { label: 'Close', onClick: hideNotice }
      ]);
    }
  }

  function showUpdateAvailable(release) {
    if (!release || notifiedVersion === release.version) return;
    notifiedVersion = release.version;
    settingsGear?.classList.add('r5-update-ready');
    if (settingsGear) settingsGear.setAttribute('aria-label', `Settings — v${release.version} update available`);
    showModal(
      `R5 Atlas v${release.version} is available`,
      `<p>You are currently using v${escapeHtml(BUILD_VERSION)}.</p><p><strong>${escapeHtml(release.title || 'What changed')}</strong></p>${notesHtml(release)}`,
      [
        { label: 'Update now', className: 'r5-primary', onClick: () => { closeModal(); applyRelease(release); } },
        { label: 'Later', className: 'r5-muted', onClick: closeModal }
      ]
    );
  }

  async function checkForUpdates() {
    if (updateInProgress) return;
    const release = await fetchRelease();
    if (!release || release.version === BUILD_VERSION) return;
    const pref = getPreference();
    if (!pref) {
      askPreference(choice => choice === 'yes' ? applyRelease(release) : showUpdateAvailable(release));
      return;
    }
    if (pref === 'yes') await applyRelease(release);
    else showUpdateAvailable(release);
  }

  async function showUpdatedMessageIfNeeded() {
    const previous = localStorage.getItem(LAST_BUILD_KEY);
    localStorage.setItem(LAST_BUILD_KEY, BUILD_VERSION);
    if (!previous || previous === BUILD_VERSION) return;
    const release = await fetchRelease();
    const details = release?.version === BUILD_VERSION
      ? `<p><strong>${escapeHtml(release.title || 'What changed')}</strong></p>${notesHtml(release)}`
      : '<p>The app has been updated.</p>';
    showModal(
      `R5 Atlas updated to v${BUILD_VERSION}`,
      details,
      [{ label: 'Got it', className: 'r5-primary', onClick: closeModal }]
    );
  }

  async function installApp() {
    if (isStandalone()) {
      showNotice('R5 Atlas is installed', 'You are already using the installed app.', [{ label: 'Close', onClick: hideNotice }]);
      return;
    }
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      await prompt.userChoice;
      return;
    }
    showModal(
      'Install R5 Atlas',
      '<p>Use your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. On iPhone/iPad, use Share → Add to Home Screen.</p>',
      [{ label: 'Close', className: 'r5-primary', onClick: closeModal }]
    );
  }

  function openAppSettings() {
    const pref = getPreference();
    const installedText = isStandalone() ? 'Installed app' : 'Web browser';
    const autoText = pref === 'yes' ? 'On' : pref === 'no' ? 'Off — notify first' : 'Not selected';
    showModal(
      'Settings',
      `<p><strong>R5 Atlas v${escapeHtml(BUILD_VERSION)}</strong></p><p class="r5-small">${escapeHtml(installedText)}</p>
       <div class="r5-settings-section">App</div>
       <div class="r5-settings-list">
         <div class="r5-settings-row"><strong>Automatic updates</strong><span class="r5-live">${escapeHtml(autoText)}</span></div>
         <div class="r5-settings-row"><strong>Offline data</strong><span>Coming soon</span></div>
         <div class="r5-settings-row"><strong>Notifications</strong><span>Coming soon</span></div>
         <div class="r5-settings-row"><strong>Appearance</strong><span>Coming soon</span></div>
       </div>
       <div class="r5-settings-section">Map & device</div>
       <div class="r5-settings-list">
         <div class="r5-settings-row"><strong>Map preferences</strong><span>Coming soon</span></div>
         <div class="r5-settings-row"><strong>Location & GPS</strong><span>Coming soon</span></div>
         <div class="r5-settings-row"><strong>Data & storage</strong><span>Coming soon</span></div>
       </div>
       <div class="r5-settings-section">Support</div>
       <div class="r5-settings-list">
         <div class="r5-settings-row"><strong>About R5 Atlas</strong><span>Coming soon</span></div>
         <div class="r5-settings-row"><strong>Diagnostics</strong><span>Coming soon</span></div>
         <div class="r5-settings-row"><strong>Reset app data</strong><span>Coming soon</span></div>
       </div>`,
      [
        ...(isStandalone() ? [] : [{ label: 'Install app', className: 'r5-primary', onClick: () => { closeModal(); installApp(); } }]),
        { label: 'Auto updates: Yes', className: pref === 'yes' ? 'r5-good' : 'r5-muted', onClick: () => { setPreference('yes'); closeModal(); checkForUpdates(); } },
        { label: 'Auto updates: No', className: pref === 'no' ? 'r5-good' : 'r5-muted', onClick: () => { setPreference('no'); closeModal(); checkForUpdates(); } },
        { label: 'Check for updates', className: 'r5-muted', onClick: () => { closeModal(); checkForUpdates(); } },
        { label: 'Close', className: 'r5-muted', onClick: closeModal }
      ]
    );
  }

  function findVersionBadge() {
    const matches = Array.from(document.querySelectorAll('body *')).filter(el => {
      const value = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return value.includes('ST37') && value.includes(`App v${BUILD_VERSION}`) && value.length < 120;
    });
    if (!matches.length) return null;
    return matches.find(el => {
      const style = getComputedStyle(el);
      return parseFloat(style.borderTopLeftRadius || '0') >= 8 || style.borderStyle !== 'none';
    }) || matches.sort((a, b) => a.childElementCount - b.childElementCount)[0];
  }

  function mountSettingsGear() {
    document.getElementById('r5-settings-gear')?.remove();
    const gear = document.createElement('button');
    gear.id = 'r5-settings-gear';
    gear.type = 'button';
    gear.textContent = '⚙';
    gear.setAttribute('aria-label', 'R5 Atlas settings');
    gear.setAttribute('title', 'Settings');
    gear.addEventListener('click', openAppSettings);
    const versionBadge = findVersionBadge();
    if (versionBadge?.parentElement) {
      versionBadge.insertAdjacentElement('beforebegin', gear);
    } else {
      gear.classList.add('r5-settings-gear-fallback');
      document.body.appendChild(gear);
    }
    settingsGear = gear;
  }

  async function registerCurrentWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register(
        `./sw.js?v=${encodeURIComponent(BUILD_VERSION)}`,
        { scope: './', updateViaCache: 'none' }
      );
    } catch (_) {
      // The site still works normally if service workers are unavailable.
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (document.readyState !== 'loading' && !isStandalone()) {
      showNotice('Install R5 Atlas', 'You can install this web app on this device.', [
        { label: 'Install', className: 'r5-primary', onClick: () => { hideNotice(); installApp(); } },
        { label: 'Not now', onClick: hideNotice }
      ]);
    }
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showNotice('R5 Atlas installed', 'The app was added to this device.', [{ label: 'Close', onClick: hideNotice }]);
  });

  async function start() {
    injectStyles();
    mountSettingsGear();

    await registerCurrentWorker();
    await showUpdatedMessageIfNeeded();

    if (!getPreference()) askPreference();
    await checkForUpdates();

    setInterval(checkForUpdates, CHECK_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdates();
    });
    window.addEventListener('online', checkForUpdates);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
