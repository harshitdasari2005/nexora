# Landing cinematic video — encode pipeline

`nexora-hq-journey-master.mp4` is the archival master (h264, **2560×1440**,
8s, 24fps, ~21.6 Mbps, with an unused audio track — the video is always
rendered muted). It is never served to the browser directly; it is kept
here so renditions can be regenerated without re-supplying the source.
It carries a small generative-tool watermark in the bottom-right corner
that the encode below removes with `delogo` before anything is shipped.

The delivery renditions in `apps/web/public/media/` were produced with:

```bash
SRC=apps/web/media-source/nexora-hq-journey-master.mp4
OUT=apps/web/public/media

# Strip the bottom-right corner watermark from the 2560×1440 master. The
# region sits over a smooth sky/wall gradient, so delogo interpolates it
# away with no visible smear. Prepended to every rendition's filter chain.
DL="delogo=x=2450:y=1360:w=100:h=60"

# Desktop — a genuine DOWNSCALE 1440p → 1920×1080 (Lanczos). No unsharp:
# downscaling already yields a crisp result, unlike the previous 720p
# master which had to be upscaled. bt709 tagging since the master is
# untagged and the target is web SDR.
ffmpeg -y -i "$SRC" -an -vf "$DL,scale=1920:1080:flags=lanczos" \
  -c:v libx264 -profile:v high -preset slow -crf 25 \
  -g 12 -keyint_min 12 -sc_threshold 0 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart \
  "$OUT/nexora-hq-desktop.mp4"

ffmpeg -y -i "$SRC" -an -vf "$DL,scale=1920:1080:flags=lanczos" \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -g 12 -keyint_min 12 -row-mt 1 -cpu-used 2 \
  -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  "$OUT/nexora-hq-desktop.webm"

# Mobile — 640×360, a real re-encode (huge downscale from 1440p, very clean).
ffmpeg -y -i "$SRC" -an -vf "$DL,scale=640:360:flags=lanczos" \
  -c:v libx264 -profile:v main -preset slow -crf 27 \
  -g 12 -keyint_min 12 -sc_threshold 0 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart \
  "$OUT/nexora-hq-mobile.mp4"

ffmpeg -y -i "$SRC" -an -vf "$DL,scale=640:360:flags=lanczos" \
  -c:v libvpx-vp9 -crf 42 -b:v 0 -g 12 -keyint_min 12 -row-mt 1 -cpu-used 2 \
  -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  "$OUT/nexora-hq-mobile.webm"

# Posters (first frame)
ffmpeg -y -i "$OUT/nexora-hq-desktop.mp4" -vframes 1 -q:v 2 -update 1 \
  "$OUT/nexora-hq-desktop-poster.jpg"
ffmpeg -y -i "$OUT/nexora-hq-mobile.mp4" -vframes 1 -q:v 4 -update 1 \
  "$OUT/nexora-hq-mobile-poster.jpg"
```

Notes on the choices:

- **Watermark removal** (`delogo`): the master carries a small corner
  watermark from the generative tool. It is over a near-flat gradient, so
  a single static delogo box (the watermark never moves) removes it
  cleanly for the whole clip. Done at encode time so the shipped assets
  are clean and nothing changes at runtime.
- **Audio stripped** (`-an`): the video is always `muted`, decorative —
  the AAC track was pure dead weight.
- **`-g 12 -keyint_min 12 -sc_threshold 0`**: a keyframe every 12 frames
  (0.5s at 24fps), uniform (no scene-cut-adaptive placement). Scroll
  scrubbing seeks to arbitrary timestamps constantly; a short, regular
  GOP keeps every seek's worst case (decode from the nearest preceding
  keyframe) cheap.
- **WebM/VP9 before MP4/H.264** in the `<source>` order: VP9 is smaller at
  a comparable quality target and decodes with less CPU than AV1 — for a
  background video seeked dozens of times per second while scrolling,
  decode cost per seek matters more than shaving a few hundred KB off the
  download. H.264 remains the universal fallback.
- **AV1 was evaluated and deliberately not used**: `libsvtav1` produces
  smaller files, but AV1 decode is materially heavier without hardware
  acceleration — a real risk on the lower-end/mobile devices this
  pipeline also serves. For a continuously-scrubbed background video that
  trade works against the smoothness requirement.
- **Desktop is now a real 2560×1440 → 1920×1080 downscale.** The previous
  master was 1280×720 and had to be _upscaled_ to 1080p (Lanczos +
  unsharp) just to narrow the browser's runtime upscale ratio — it could
  never add detail the 720p source lacked. This master is genuine 2K, so
  1080p delivery is a downscale: it preserves real high-frequency detail
  and needs no sharpening pass. Quality vs. the 1440p master at the
  chosen CRFs measures VMAF ~98 (mean). Desktop renditions land ~6.5MB
  each (up from ~5MB) — the cost of real detail, still inside a sane
  budget for a landing hero whose entire job is first impression.
- **Mobile is a real re-encode at 640×360**, not the desktop file scaled
  down by CSS — far fewer pixels to decode per seek. Downscaling from
  1440p makes this tier cleaner than before at the same size.

Regenerating: replace the master file and re-run the commands above.
