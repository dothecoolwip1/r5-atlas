import json
from pathlib import Path

app = Path('testing/app-update.js')
text = app.read_text(encoding='utf-8')

text = text.replace('  let appButton = null;\n', '  let settingsGear = null;\n', 1)

old_css = '''      #r5-app-button{position:fixed;right:14px;bottom:14px;z-index:2147483000;border:1px solid rgba(255,255,255,.22);background:#171a20;color:#fff;border-radius:999px;padding:10px 14px;font:600 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.28);cursor:pointer}
      #r5-app-button.r5-update-ready{background:#7a3df0;border-color:#a980ff}
'''
new_css = '''      #r5-settings-gear{width:34px;height:34px;min-width:34px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.11);color:#fff;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0;margin-right:8px;font:700 19px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:none;cursor:pointer;flex:0 0 auto}
      #r5-settings-gear:active{transform:scale(.96)} #r5-settings-gear.r5-update-ready{background:#7a3df0;border-color:#b69cff;box-shadow:0 0 0 2px rgba(122,61,240,.18)}
      #r5-settings-gear.r5-settings-gear-fallback{position:fixed;right:285px;top:12px;z-index:2147483000}
'''
if old_css not in text:
    raise SystemExit('Old floating app button CSS not found')
text = text.replace(old_css, new_css, 1)

old_setting_css = '      .r5-setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid rgba(255,255,255,.1)}.r5-setting:first-of-type{border-top:0}.r5-small{font-size:12px;color:#aeb1b8!important}\n'
new_setting_css = '''      .r5-setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid rgba(255,255,255,.1)}.r5-setting:first-of-type{border-top:0}.r5-small{font-size:12px;color:#aeb1b8!important}
      .r5-settings-list{margin-top:14px;border:1px solid rgba(255,255,255,.1);border-radius:13px;overflow:hidden}.r5-settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px;border-top:1px solid rgba(255,255,255,.09);background:#1d2128}.r5-settings-row:first-child{border-top:0}.r5-settings-row strong{font-size:13px}.r5-settings-row span{font-size:11px;color:#9fa4ad;text-align:right}.r5-settings-row .r5-live{color:#79d8a4}.r5-settings-section{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8f96a0;margin:16px 0 6px;font-weight:800}
'''
if old_setting_css not in text:
    raise SystemExit('Settings CSS anchor not found')
text = text.replace(old_setting_css, new_setting_css, 1)

old_update = '''    appButton?.classList.add('r5-update-ready');
    if (appButton) appButton.textContent = `App • v${release.version} ready`;
'''
new_update = '''    settingsGear?.classList.add('r5-update-ready');
    if (settingsGear) settingsGear.setAttribute('aria-label', `Settings — v${release.version} update available`);
'''
if old_update not in text:
    raise SystemExit('Update-ready app button code not found')
text = text.replace(old_update, new_update, 1)

start = text.index('  function openAppSettings() {')
end = text.index('\n  async function registerCurrentWorker()', start)
replacement = r'''  function openAppSettings() {
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
'''
text = text[:start] + replacement + text[end:]

old_start = '''    appButton = document.createElement('button');
    appButton.id = 'r5-app-button';
    appButton.type = 'button';
    appButton.textContent = 'App';
    appButton.addEventListener('click', openAppSettings);
    document.body.appendChild(appButton);
'''
if old_start not in text:
    raise SystemExit('Floating app button startup code not found')
text = text.replace(old_start, '    mountSettingsGear();\n', 1)
app.write_text(text, encoding='utf-8')

index = Path('testing/index.html')
html = index.read_text(encoding='utf-8')
if 'App v0.2.1' not in html or 'name="r5-app-version" content="0.2.1"' not in html:
    raise SystemExit('Expected v0.2.1 markers were not found')
html = html.replace('App v0.2.1', 'App v0.3.0', 1)
html = html.replace('name="r5-app-version" content="0.2.1"', 'name="r5-app-version" content="0.3.0"', 1)
index.write_text(html, encoding='utf-8')

release_path = Path('testing/version.json')
release = json.loads(release_path.read_text(encoding='utf-8'))
if release.get('version') != '0.2.1':
    raise SystemExit(f"Expected version 0.2.1, found {release.get('version')}")
release.update({
    'version': '0.3.0',
    'releasedAt': '2026-09-15',
    'title': 'Settings moved to the header',
    'notes': [
        'Restored access to the original History tab by removing the floating App button that covered it.',
        'Moved Settings to a cog beside the version badge in the top header.',
        'Added settings placeholders for Offline data, Notifications, Appearance, Map preferences, Location & GPS, Data & storage, About, Diagnostics, and Reset app data.',
        'Automatic update controls and manual update checking remain functional inside Settings.'
    ]
})
release_path.write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')
