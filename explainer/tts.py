"""Generate narration audio per scene with edge-tts and write durations.json."""
import asyncio, json, os, subprocess, sys, wave
import imageio_ffmpeg

ROOT = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
# --dir <folder>: build another video from that folder's narration.json (default: this folder)
HERE = ROOT
if "--dir" in args:
    i = args.index("--dir")
    HERE = os.path.abspath(os.path.join(ROOT, args[i + 1]))
    del args[i:i + 2]
AUDIO = os.path.join(HERE, "audio")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = args[0] if args else "en-US-AndrewNeural"
RATE = args[1] if len(args) > 1 else "+0%"
PAD_BEFORE = 0.6   # seconds of silence before narration in each scene
PAD_AFTER = 1.0    # seconds of silence after narration
MIN_SCENE = 4.0

os.makedirs(AUDIO, exist_ok=True)
scenes = json.load(open(os.path.join(HERE, "narration.json"), encoding="utf-8"))


async def synth(scene):
    mp3 = os.path.join(AUDIO, f"{scene['id']}.mp3")
    wav = os.path.join(AUDIO, f"{scene['id']}.wav")
    for attempt in range(4):
        r = subprocess.run([sys.executable, "-m", "edge_tts", "--voice", VOICE, f"--rate={RATE}", "--text", scene["text"],
                            "--write-media", mp3], capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(mp3) and os.path.getsize(mp3) > 1000:
            break
        print("retry", scene["id"], r.stderr[-200:])
    else:
        raise SystemExit("tts failed for " + scene["id"])
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", mp3, "-ar", "48000", "-ac", "2", wav], check=True)
    with wave.open(wav) as w:
        return w.getnframes() / w.getframerate()


async def main():
    out = []
    t = 0.0
    for s in scenes:
        d = await synth(s)
        total = max(MIN_SCENE, PAD_BEFORE + d + PAD_AFTER)
        out.append({"id": s["id"], "audio": d, "start": t, "narrationAt": PAD_BEFORE, "duration": total})
        t += total
        print(f"{s['id']:14s} audio={d:5.1f}s scene={total:5.1f}s")
    json.dump(out, open(os.path.join(HERE, "durations.json"), "w"), indent=2)
    print(f"total {t:.1f}s")

    # Build one master wav: silence + each clip at its scene start.
    with wave.open(os.path.join(AUDIO, scenes[0]["id"] + ".wav")) as w:
        params = w.getparams()
    rate, sw, ch = params.framerate, params.sampwidth, params.nchannels
    frame_bytes = sw * ch
    total_frames = int(round(t * rate))
    buf = bytearray(total_frames * frame_bytes)
    for s in out:
        with wave.open(os.path.join(AUDIO, s["id"] + ".wav")) as w:
            data = w.readframes(w.getnframes())
        off = int(round((s["start"] + s["narrationAt"]) * rate)) * frame_bytes
        buf[off:off + len(data)] = data
    with wave.open(os.path.join(AUDIO, "master.wav"), "wb") as w:
        w.setparams(params)
        w.setnframes(total_frames)
        w.writeframes(bytes(buf))


asyncio.run(main())
