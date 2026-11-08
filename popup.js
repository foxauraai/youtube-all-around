const $ = (id) => document.getElementById(id);

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

async function send(cmd, value) {
  try {
    return await browser.runtime.sendMessage({ fromPopup: true, cmd, value });
  } catch (e) {
    return { ok: false, text: "Extension error. Try reloading the YouTube tab." };
  }
}

function setEnabled(enabled) {
  for (const id of ["volume", "mute", "quality", "speed", "captions"]) $(id).disabled = !enabled;
}

function render(res) {
  if (!res || !res.ok) {
    $("status").textContent = (res && res.text) || "No response from the YouTube tab.";
    setEnabled(false);
    return;
  }
  const s = res.state;
  setEnabled(true);
  $("status").textContent = res.text ? `${s.title}  •  ${res.text}` : s.title;

  if (document.activeElement !== $("volume")) $("volume").value = s.muted ? 0 : s.volume;
  $("mute").textContent = s.muted ? "Unmute" : "Mute";

  const quality = $("quality");
  quality.innerHTML = "";
  for (const q of s.qualities) {
    const opt = document.createElement("option");
    opt.value = q;
    opt.textContent = QUALITY_LABELS[q] || q;
    if (q === s.quality) opt.selected = true;
    quality.appendChild(opt);
  }

  const speed = $("speed");
  if (!speed.options.length) {
    for (const r of SPEEDS) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r === 1 ? "Normal" : `${r}x`;
      speed.appendChild(opt);
    }
  }
  speed.value = String(s.rate);
  if (speed.value !== String(s.rate)) {
    const opt = document.createElement("option");
    opt.value = s.rate;
    opt.textContent = `${s.rate}x`;
    speed.appendChild(opt);
    speed.value = String(s.rate);
  }

  $("captions").textContent = s.captions === null ? "Toggle captions" : s.captions ? "Captions: on (turn off)" : "Captions: off (turn on)";
}

$("volume").addEventListener("input", async (e) => render(await send("set-volume", Number(e.target.value))));
$("mute").addEventListener("click", async () => render(await send("toggle-mute")));
$("quality").addEventListener("change", async (e) => {
  $("status").textContent = "Changing quality...";
  $("quality").disabled = true;
  render(await send("set-quality", e.target.value));
});
$("speed").addEventListener("change", async (e) => render(await send("set-speed", Number(e.target.value))));
$("captions").addEventListener("click", async () => render(await send("toggle-captions")));

send("state").then(render);
