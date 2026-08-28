# Landing cinematic video — encode pipeline

`nexora-hq-journey-master.mp4` is the supplied source (h264, 1280×720, 8s,
24fps, ~6.0 Mbps, with an unused audio track — the video is always
rendered muted). It is the archival master: never served to the browser
directly, kept here so renditions can be regenerated without re-supplying
the source.

The delivery renditions in `apps/web/public/media/` were produced with:

```bash
SRC=apps/web/media-source/nexora-hq-journey-master.mp4
OUT=apps/web/public/media

# Desktop — upscaled to 1920×1080 (Lanczos + a mild unsharp pass), NOT a
# 1:1 copy of the 1280×720 master — see "Desktop is upscaled" below.
ffmpeg -y -i "$SRC" -an -vf "scale=1920:1080:flags=lanczos,unsharp=5:5:0.5:5:5:0.0" \
  -c:v libx264 -profile:v high -preset slow -crf 26 \
  -g 12 -keyint_min 12 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart \
  "$OUT/nexora-hq-desktop.mp4"

ffmpeg -y -i "$SRC" -an -vf "scale=1920:1080:flags=lanczos,unsharp=5:5:0.5:5:5:0.0" \
  -c:v libvpx-vp9 -crf 40 -b:v 0 -g 12 -row-mt 1 -cpu-used 2 -pix_fmt yuv420p \
  "$OUT/nexora-hq-desktop.webm"

# Mobile — 640×360 (unchanged: a real phone viewport at typical device
# pixel ratios isn't stretching this the way desktop was — see below).
ffmpeg -y -i "$SRC" -an -vf scale=640:360 -c:v libx264 -profile:v main \
  -preset slow -crf 27 -g 12 -keyint_min 12 -sc_threshold 0 -pix_fmt yuv420p \
  -movflags +faststart "$OUT/nexora-hq-mobile.mp4"

ffmpeg -y -i "$SRC" -an -vf scale=640:360 -c:v libvpx-vp9 -crf 42 -b:v 0 \
  -g 12 -row-mt 1 -cpu-used 2 -pix_fmt yuv420p "$OUT/nexora-hq-mobile.webm"

# Posters (first frame)
ffmpeg -y -i "$OUT/nexora-hq-desktop.mp4" -vframes 1 -q:v 2 -update 1 \
  "$OUT/nexora-hq-desktop-poster.jpg"
ffmpeg -y -i "$OUT/nexora-hq-mobile.mp4" -vframes 1 -q:v 4 -update 1 \
  "$OUT/nexora-hq-mobile-poster.jpg"
```

Notes on the choices:

- **Audio stripped** (`-an`): the video is always `muted`, decorative —
  the AAC track was pure dead weight.
- **`-g 12 -keyint_min 12 -sc_threshold 0`**: a keyframe every 12 frames
  (0.5s at 24fps), uniform (no scene-cut-adaptive placement). Scroll
  scrubbing seeks to arbitrary timestamps constantly; a short, regular
  GOP keeps every seek's worst case (decode from the nearest preceding
  keyframe) cheap. The source's default ~10s keyint would have meant
  some seeks decoding most of the clip.
- **WebM/VP9 before MP4/H.264** in the `<source>` order: VP9 came out
  ~13% smaller than H.264 at a comparable quality target for this
  footage (2.57MB vs 2.96MB desktop; 755KB vs 841KB mobile) and decodes
  with less CPU than AV1 would — for a background video that's seeked
  dozens of times per second while scrolling, decode cost per seek
  matters more than shaving a further few hundred KB off the download.
  H.264 remains as the universal fallback for browsers without VP9
  support.
- **AV1 was evaluated and deliberately not used**: `libsvtav1` produces
  smaller files still, but AV1 decode is materially heavier without
  hardware acceleration, which is a real risk on exactly the
  lower-end/mobile devices this pipeline also has to serve — for a
  background video scrubbed continuously, that trade works against the
  smoothness requirement more than the extra download savings are worth.
- **Mobile is a real re-encode at 640×360**, not the desktop file scaled
  down by CSS — half the pixels to decode per seek, not just a smaller
  display size.
- **Desktop is upscaled to 1920×1080**, not served at the master's native
  1280×720. `CinematicJourney` renders the video full-bleed
  (`object-fit: cover` across `100vw × 100vh`), and desktop viewports are
  routinely wider than 1280 CSS px before even accounting for
  `devicePixelRatio` (2 on most modern laptop/desktop displays) — a
  1280×720 source was being upscaled well over 2× by the browser at
  render time, which is what read as visible blur. Encoding at 1920×1080
  with a Lanczos scaler (sharper than the browser's own runtime video
  scaler) plus a mild `unsharp` pass measurably reduces that gap — CRF is
  unchanged (still 26/40), but the same CRF spent on 2.25× the pixels
  allocates more total bits, so less is lost to quantization per unit
  area than the original 720p encode had. It cannot manufacture detail
  the 720p master never had — a genuinely
  sharp result at 4K/high-DPR displays would need a higher-resolution
  master — but it materially narrows the browser's upscale ratio for
  every viewport up to 1920 CSS px wide, and softens it beyond that.
  Desktop file sizes roughly doubled (2.96MB→5.85MB MP4, 2.57MB→4.89MB
  WebM) as the direct cost of this — an accepted trade for a page whose
  entire job is a strong first impression.
- **Mobile stays at 640×360, not upscaled**: a phone viewport (~375–430
  CSS px) at typical mobile `devicePixelRatio` (2–3) needs roughly
  750–1290 real pixels of width — 640 source pixels is close enough to
  that range that the same blur problem doesn't apply anywhere near as
  visibly, so it wasn't re-encoded.

Regenerating: replace the master file and re-run the commands above.
