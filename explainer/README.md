# Rasseed explainer video

Self-contained generator for the project explanation video (`out/rasseed-explainer.mp4`, 1920×1080, 30 fps, English voice-over).

| File | Role |
|---|---|
| `narration.json` | The script, one entry per scene. Edit the text here. |
| `tts.py` | Generates the voice-over with `edge-tts` (Microsoft neural voice, needs internet), measures each clip and writes `durations.json` + `audio/master.wav`. |
| `index.html` | The animated scenes. Every `.a` element is a paused CSS animation that the renderer scrubs; `--d` is its start time inside the scene (seconds). |
| `render.mjs` | Drives headless Chromium (Playwright's bundled build) frame by frame, screenshots to `frames/`, then muxes with ffmpeg (from `imageio-ffmpeg`) into `out/`. |

## Regenerate

```bash
cd explainer
npm install                                   # playwright-core
python -m pip install --user edge-tts imageio-ffmpeg
python tts.py                                 # optional voice name as first arg, e.g. en-US-AriaNeural
node render.mjs --stills                      # quick check: two PNGs per scene in out/stills/
node render.mjs                               # full video (~5–8 min)
```

Preview in a browser: open `index.html` served from this folder (it fetches `durations.json`), press **Space** to play, ←/→ to seek, or add `?t=60` to jump to a time.

If narration text changes, rerun `tts.py` first: scene lengths follow the audio, and the `--d` timings in `index.html` are relative to each scene's start (narration begins 0.6 s in).
