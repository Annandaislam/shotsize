const PRESETS = ['1920x1080', '1920x1920', '1440x900', '1366x768', '1280x720', '1200x1200', '390x844'];
const $ = (id) => document.getElementById(id);

function parseSize(input) {
  const m = String(input).trim().match(/^(\d{1,5})\s*[xX*]\s*(\d{1,5})$/);
  if (!m) throw new Error('Enter a size like 1920x1080');
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 1 || height < 1) throw new Error('Both sides must be at least 1px');
  if (width > 16384 || height > 16384) throw new Error('Max 16384px per side');
  return { width, height };
}

$('presets').innerHTML = PRESETS.map((p) => `<button type="button" data-size="${p}">${p}</button>`).join('');
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b) return;
  $('size').value = b.dataset.size;
  saveSettings();
});

const FIELDS = ['size', 'format', 'delay'];
const FLAGS = ['scale2', 'banners', 'full', 'autosave'];

async function loadSettings() {
  const saved = await chrome.storage.local.get('settings');
  const s = saved.settings;
  if (!s) return;
  for (const id of FIELDS) if (s[id] !== undefined) $(id).value = s[id];
  for (const id of FLAGS) if (s[id] !== undefined) $(id).checked = s[id];
}

function saveSettings() {
  const settings = {};
  for (const id of FIELDS) settings[id] = $(id).value;
  for (const id of FLAGS) settings[id] = $(id).checked;
  chrome.storage.local.set({ settings });
}

for (const id of [...FIELDS, ...FLAGS]) $(id).addEventListener('change', saveSettings);

// The download has to start from the popup, not the service worker: MV3 removed
// URL.createObjectURL from the worker scope, and a multi-megabyte data: URL is
// not a reliable download source.
async function saveToDownloads(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      chrome.downloads.download({ url: objectUrl, filename: name, saveAs: false }, (id) => {
        const err = chrome.runtime.lastError;
        if (err || id === undefined) reject(new Error(err?.message || 'download rejected'));
        else resolve(id);
      });
    });
  } finally {
    // Revoking immediately can cut the transfer short; one tick is enough for
    // Chrome to take its own reference to the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

$('go').addEventListener('click', async () => {
  const btn = $('go');
  let size;
  try {
    size = parseSize($('size').value);
  } catch (err) {
    return setStatus(err.message, true);
  }

  btn.disabled = true;
  $('result').hidden = true;
  setStatus('Resizing the page and capturing…');

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'capture',
      options: {
        width: size.width,
        height: size.height,
        scale: $('scale2').checked ? 2 : 1,
        format: $('format').value,
        quality: 92,
        fullPage: $('full').checked,
        hideBanners: $('banners').checked,
        delay: Math.min(Number($('delay').value) || 0, 10000),
      },
    });

    if (!res?.ok) throw new Error(res?.error || 'Capture failed.');

    $('preview').src = res.dataUrl;
    $('dims').textContent = `${res.width} × ${res.height} px`;
    $('save').href = res.dataUrl;
    $('save').download = res.name;
    $('result').hidden = false;

    if ($('autosave').checked) {
      try {
        await saveToDownloads(res.dataUrl, res.name);
        setStatus(`Saved ${res.name} to Downloads.`);
      } catch (err) {
        setStatus(`Captured, but auto-save failed (${err.message}). Use “Save as…”.`, true);
      }
    } else {
      setStatus(`Captured ${res.name}.`);
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

loadSettings();
