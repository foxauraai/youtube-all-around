// Runs on YouTube pages. It controls YouTube's own player (volume, quality, speed, captions)

const QUALITY_LABELS = {
  hd2160: "2160p",
  hd1440: "1440p",
  hd1080: "1080p",
  hd720: "720p",
  large: "480p",
  medium: "360p",
  small: "240p",
  tiny: "144p",
  auto: "Auto"
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function getPlayer() {
  const el = document.getElementById("movie_player");
  // wrappedJSObject gives access to the functions that YouTube's own scripts define on the player
  return el ? el.wrappedJSObject : null;
}

function qualityLabel(q) {
  return QUALITY_LABELS[q] || q;
}

// The real CC button of the player. YouTube hides it (display:none) when a video has no captions.
function captionsButton() {
  const b = document.querySelector(".ytp-subtitles-button");
  if (!b) return null;
  const hidden = b.style.display === "none" || b.hasAttribute("hidden");
  return hidden ? null : b;
}

function captionsOn(p) {
  const b = captionsButton();
  if (b) return b.getAttribute("aria-pressed") === "true";
  try {
    if (typeof p.isSubtitlesOn === "function") return !!p.isSubtitlesOn();
  } catch (e) {}
  return null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function toggleCaptions(p) {
  // Captions are loaded lazily, so the CC button may not exist yet. Ask YouTube to load them.
  let btn = captionsButton();
  if (!btn) {
    try {
      p.loadModule("captions");
    } catch (e) {}
    await wait(500);
    btn = captionsButton();
  }

  let text;
  if (btn) {
    // Clicking the real button behaves exactly like a user click, including auto-generated captions
    btn.click();
    await wait(250);
    const on = captionsOn(p);
    text = on === null ? "Captions toggled" : on ? "Captions on" : "Captions off";
  } else {
    // Fallback: use the player API directly
    let tracks = [];
    try {
      tracks = Array.from(p.getOption("captions", "tracklist") || []);
    } catch (e) {}
    if (!tracks.length) {
      return { ok: true, text: "This video has no captions.", state: readState(p) };
    }
    try {
      p.toggleSubtitles();
    } catch (e) {}
    await wait(250);
    const on = captionsOn(p);
    text = on === null ? "Captions toggled" : on ? "Captions on" : "Captions off";
  }
  return { ok: true, text, state: readState(p) };
}

// Remember the quality the user asked for, so the popup keeps showing it while YouTube switches
let requestedQuality = null;

function videoKey() {
  return new URLSearchParams(location.search).get("v") || location.pathname;
}

function recentlyRequestedQuality() {
  if (!requestedQuality) return null;
  const fresh = Date.now() - requestedQuality.at < 120000;
  return fresh && requestedQuality.key === videoKey() ? requestedQuality.quality : null;
}

function readState(p, qualityOverride) {
  let qualities = [];
  try {
    qualities = Array.from(p.getAvailableQualityLevels());
  } catch (e) {}
  const captions = captionsOn(p);
  return {
    title: document.title.replace(/ - YouTube$/, ""),
    volume: Math.round(p.getVolume()),
    muted: !!p.isMuted(),
    quality: qualityOverride || recentlyRequestedQuality() || p.getPlaybackQuality(),
    qualities,
    rate: p.getPlaybackRate(),
    captions
  };
}

function nearestSpeedIndex(rate) {
  let best = 0;
  for (let i = 0; i < SPEEDS.length; i++) {
    if (Math.abs(SPEEDS[i] - rate) < Math.abs(SPEEDS[best] - rate)) best = i;
  }
  return best;
}

function setQuality(p, q) {
  try {
    p.setPlaybackQualityRange(q, q);
  } catch (e) {}
  try {
    p.setPlaybackQuality(q);
  } catch (e) {}
}

const QUALITY_HEIGHTS = {
  hd2160: 2160,
  hd1440: 1440,
  hd1080: 1080,
  hd720: 720,
  large: 480,
  medium: 360,
  small: 240,
  tiny: 144
};

// Fallback: choose the quality through the player's real settings menu (gear > Quality),
// hidden from view while it runs. YouTube sometimes ignores the player API request.
async function setQualityViaMenu(q) {
  const hiddenStyle = document.createElement("style");
  hiddenStyle.textContent = ".ytp-popup, .ytp-settings-menu { opacity: 0 !important; pointer-events: none !important; }";
  document.head.appendChild(hiddenStyle);
  const gear = document.querySelector(".ytp-settings-button");
  let done = false;
  try {
    if (!gear) return false;
    gear.click();
    await wait(300);
    const items = document.querySelectorAll(".ytp-settings-menu .ytp-menuitem");
    if (!items.length) return false;
    // "Quality" is the last row of the settings menu (the text is translated, so we use the position)
    items[items.length - 1].click();
    await wait(300);
    const options = Array.from(document.querySelectorAll(".ytp-quality-menu .ytp-menuitem"));
    let target = null;
    if (q === "auto") {
      target = options[options.length - 1];
    } else {
      const height = QUALITY_HEIGHTS[q];
      const re = new RegExp(`(^|\\D)${height}p?(\\D|$)`);
      target = options.find((o) => re.test(o.textContent));
    }
    if (target) {
      target.click();
      done = true;
      await wait(200);
    }
  } finally {
    // Close the menu if it is still open, then show menus normally again
    if (gear && gear.getAttribute("aria-expanded") === "true") gear.click();
    setTimeout(() => hiddenStyle.remove(), 400);
  }
  return done;
}

async function waitForQuality(p, q, tries) {
  for (let i = 0; i < tries; i++) {
    await wait(400);
    try {
      if (p.getPlaybackQuality() === q) return true;
    } catch (e) {}
  }
  return false;
}

// Request a quality, wait until YouTube really switches, and use the settings menu if it does not
// YouTube keeps playing the already-buffered low quality video until the buffer runs out,
// so a quality change can look like it did nothing. Seeking to the current position
// throws the buffer away and makes the player load the new quality right away.
function flushBuffer(p) {
  try {
    p.seekTo(p.getCurrentTime(), true);
  } catch (e) {}
}

async function applyQuality(p, q) {
  requestedQuality = { key: videoKey(), quality: q, at: Date.now() };
  setQuality(p, q);
  flushBuffer(p);
  let applied = await waitForQuality(p, q, 4);
  if (!applied) {
    await setQualityViaMenu(q);
    flushBuffer(p);
    applied = await waitForQuality(p, q, 5);
  }
  const text = applied ? `Quality: ${qualityLabel(q)}` : `Quality: ${qualityLabel(q)} (YouTube is still switching)`;
  return { ok: true, text, state: readState(p, q) };
}

function handle(msg) {
  const p = getPlayer();
  if (!p || typeof p.getVolume !== "function") {
    return { ok: false, text: "The YouTube player is not ready on this tab." };
  }

  let text = "";
  try {
    switch (msg.cmd) {
      case "state":
        break;

      case "volume-up":
      case "volume-down":
      case "set-volume": {
        const current = p.getVolume();
        let next = msg.cmd === "set-volume" ? Number(msg.value) : current + (msg.cmd === "volume-up" ? 10 : -10);
        next = Math.max(0, Math.min(100, Math.round(next)));
        if (p.isMuted() && next > 0) p.unMute();
        p.setVolume(next);
        text = `Volume: ${next}%`;
        break;
      }

      case "toggle-mute":
        if (p.isMuted()) {
          p.unMute();
          text = "Sound on";
        } else {
          p.mute();
          text = "Muted";
        }
        break;

      case "quality-up":
      case "quality-down": {
        const levels = Array.from(p.getAvailableQualityLevels()).filter((q) => q !== "auto");
        if (!levels.length) {
          text = "No quality options available.";
          break;
        }
        // The list is ordered from the highest quality to the lowest
        const idx = levels.indexOf(recentlyRequestedQuality() || p.getPlaybackQuality());
        let next;
        if (idx === -1) next = 0;
        else next = msg.cmd === "quality-up" ? Math.max(0, idx - 1) : Math.min(levels.length - 1, idx + 1);
        // Asynchronous: returns a promise that resolves to the full result
        return applyQuality(p, levels[next]);
      }

      case "set-quality":
        return applyQuality(p, msg.value);

      case "speed-up":
      case "speed-down": {
        const idx = nearestSpeedIndex(p.getPlaybackRate());
        const next = msg.cmd === "speed-up" ? Math.min(SPEEDS.length - 1, idx + 1) : Math.max(0, idx - 1);
        p.setPlaybackRate(SPEEDS[next]);
        text = `Speed: ${SPEEDS[next]}x`;
        break;
      }

      case "set-speed":
        p.setPlaybackRate(Number(msg.value));
        text = `Speed: ${Number(msg.value)}x`;
        break;

      case "toggle-captions":
        // Asynchronous: returns a promise that resolves to the full result
        return toggleCaptions(p);

      default:
        return { ok: false, text: "Unknown command." };
    }
  } catch (e) {
    return { ok: false, text: "Could not control the player." };
  }

  return { ok: true, text, state: readState(p) };
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.cmd) return;
  return Promise.resolve(handle(msg));
});
