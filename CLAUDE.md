# MMM-PhotoDeck — context for Claude sessions

Charles's MagicMirror² module: his photos, one at a time, for his hallway mirror, as the page
between the animation pages in a rotation of pages (so the Pi gets its rest without an empty
screen). Split out of MMM-ChaosTheory on 2026-09-28, with its history (it was the `photos` page
there).

**The photos are private: never commit them to this public repo**, nor put them in a
screenshot. Charles's curated originals live in `~/Pictures/Mirror` on the Mac;
`mac/sync-mirror-photos.sh` in the setup repo resizes them (sips, 1600 px, EXIF kept) and rsyncs
them to `~/mirror-photos` on the Pi. `screenshot.png` is still to be made, with shareable
pictures.

## What exists (v1.0.0)

- `MMM-PhotoDeck.js` — module shell: one canvas plus an HTML caption (here only an error line).
  Starts a fresh sim every `cycleSeconds` and on each `resume()`. Loop: `setTimeout` until a
  frame is due, then one `requestAnimationFrame`. `suspend()` stops it; a sim with
  `resting = true` is polled only every 500 ms. While MagicMirror fades the module out (`hidden`
  is set at the start, `suspend()` comes after), frames draw nothing. A sim with
  `preloadWhileHidden` (photos) is made and drawn in `suspend()`, so the page fades in on the
  new photo. `turns: { of, at }` lets modules on one MMM-pages page take turns (the wrapper is
  `display: none` when it's not this module's turn). The module calls `sim.dispose()` when it
  replaces a sim.
- `simulations/photos.js` (`window.PhotoSimulations.photos`, UMD so tests run in Node) — each
  photo held still with its date, the next crossfading in every `photoSeconds` (5: four to the
  20 s page, in `photoFadeSeconds`, 0.8). Each is composed once on its own canvas while the last
  is held; a fade redraws only the box around both photos. Photos got ready but not shown go
  back on the deck (`dispose()`); a new deck keeps the last ten dealt off its start and no two
  from the same day side by side. One list fetch at a time per URL (`Photos.dealing`).
- `photoFolder` (default `"~/mirror-photos"`): the default folder is at `/MMM-PhotoDeck/photos/`
  (env `MIRROR_PHOTOS` overrides the default only); any other at
  `/MMM-PhotoDeck/folders/<key>/`, key = FNV-1a hex of the folder string as written in the
  config (`Photos.folderKey`). `node_helper.js` reads the allowed folders from `global.config`
  (MagicMirror's config, set before helpers start; an implicit global in releases before 2.36)
  in `start()`, so there's no race and nothing the browser sends picks a path; unknown keys 404,
  file names go through `path.basename`.
- `photo-index.js` — lists `.jpg/.jpeg/.png/.webp` (not HEIC, not dot-files), dates from JPEG
  EXIF (`DateTimeOriginal`, else `DateTime`, first 128 KB, cached by mtime);
  `resolveFolder`, `configuredFolders`.
- `node_helper.js` — the photo routes, and the stats panel (`statsPanel`): samples Electron,
  cage, cores and temperature from `/proc` between STATS_START and STATS_STOP.
- `tests/photos.test.js` — `node --test`, no dependencies: EXIF, listing, folders and the
  helper's routes (MagicMirror stubbed), shuffling, the crossfades' timing.
- `dev/preview.html` + `dev/serve.js` — runs the module in a desktop browser; `serve.js` serves
  the module folder and photos from a folder (its first argument; by default `~/Pictures/Mirror`).

The shell (`MMM-PhotoDeck.js`, the `node_helper.js` stats panel, `dev/preview.html`) is shared
in spirit with the sibling modules split out at the same time (MMM-ChaosTheory, MMM-Atom,
MMM-FractalZoom, MMM-Chladni, MMM-SacredGeometry, MMM-Tilings, MMM-PlanetsDance, MMM-NightSky,
MMM-SnowCrystal, all in `~/dev/mirror-modules` or `~/dev`): a fix there probably belongs in the
siblings too.

## Measured cost on the Pi

900×1000, `fps: 20`: ~1% while a photo is held; a crossfade 140–170% for its 0.8 s at a steady
20 fps, then 40–80% for ~0.4 s laying out the next photo; 39% (31–56) over the 20 s page (14%
with one photo; the page change itself is ~180% for a second). Hidden: 0.3% (baseline 0.2%).

## Performance findings on the Pi (measured, from MMM-ChaosTheory)

- A frame that changes the canvas costs ~2%/fps fixed; beyond that, cost scales with the
  **bounding box of everything changed in the frame**. Full redraws of a 900² canvas at 20 fps
  saturate the pipeline (~150%). JS is never the bottleneck (<3 ms/frame).
- So: keep each frame's changes spatially compact, and rest when the picture is static.
- MagicMirror applies `electronSwitches` after app ready, so `remote-debugging-port` can't be
  set that way; use `debugStats: true` and a `grim` screenshot to see fps on the Pi (photos
  show on it: don't share such screenshots). For exact frame times without the screen: patch
  the Pi's checkout for a while to `sendSocketNotification` each frame's rAF time and have
  `node_helper.js` `console.log` it into pm2's log; restore the checkout and restart after.
- Per-page cost: `dev/cpu-trace.py` (in MMM-ChaosTheory) traces Electron + cage every 0.25 s.

## Hard constraints: the target device

- **Raspberry Pi 3 B+, 905 MB RAM, 64-bit Debian 13.** Mirror runs Electron 42 in a cage
  Wayland kiosk.
- **No GPU acceleration, and it can't be enabled**: the Pi 3's VideoCore IV only does GLES 2.0,
  Chromium needs ES 3.0 (tested). All canvas drawing is CPU. **No WebGL / three.js.**
- Screen will be **portrait 1200×1920** once mounted (Dell U2413, rotated). Design for portrait.
- Electron baseline is ~0.5% of one core. A full-screen 60 fps canvas could cost a lot more.
  **Measure, don't guess**: on the Pi, `~/.cache/mm-sample.sh 60` prints Electron CPU% and RSS
  over 60 s. Record before/after numbers in the README.
- The mirror rotates pages every 15-30 s (MMM-pages, which hides/shows modules). Verify that
  `suspend()`/`resume()` actually fire on page changes. If the loop keeps running while
  hidden, it burns CPU 24/7.

## Deploying and testing

- This repo is public (github.com/charleswest775/MMM-PhotoDeck) so the Pi can `git pull`
  without credentials.
- Pi access: `ssh fatherson@raspberrypi.local` (key auth). Module path:
  `~/MagicMirror/modules/MMM-PhotoDeck`. Restart: `pm2 restart MagicMirror`
  (pm2 is in `~/.npm-global/bin`). Logs: `pm2 logs MagicMirror`.
- The mirror's **config.js lives in a separate private repo**, `charleswest775/magicmirror-setup`
  (cloned at `~/dev/magicmirror-setup`). Add the module's config block there, then
  `./deploy.sh diff` and `./deploy.sh push` (push validates config before restarting).
  Don't hand-edit config.js on the Pi without `./deploy.sh pull` afterwards.
- On the mirror the photos page is listed four times in the rotation (chaos → photos → atom →
  photos → fractal → photos → sacred → photos → sky), 20 s each; its config has no
  `photoFolder`.
- Faster iteration: `node dev/serve.js` and `dev/preview.html` on the Mac, then confirm
  performance on the Pi.
- Commit as Charles's GitHub noreply address (see git config in this repo).
