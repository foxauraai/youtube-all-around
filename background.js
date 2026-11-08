// ===== YouTube All Around =====

const VIDEO_URLS = [
  "https://www.youtube.com/watch*",
  "https://www.youtube.com/shorts/*",
  "https://www.youtube.com/live/*"
];

// Pick the tab to control: the one that is playing sound (the video in Picture-in-Picture),
// otherwise the active YouTube tab, otherwise the most recently used YouTube video tab.
async function findTarget() {
  const tabs = await browser.tabs.query({ url: VIDEO_URLS });
  if (!tabs.length) return null;
  const audible = tabs.find((t) => t.audible);
  if (audible) return audible;
  const active = tabs.find((t) => t.active);
  if (active) return active;
  return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

async function control(cmd, value) {
  const target = await findTarget();
  if (!target) return { ok: false, text: "No YouTube video tab found." };
  try {
    return await browser.tabs.sendMessage(target.id, { cmd, value });
  } catch (e) {
    return { ok: false, text: "Reload the YouTube tab once, then try again." };
  }
}

// Requests from the toolbar popup
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.fromPopup) return control(msg.cmd, msg.value);
});
