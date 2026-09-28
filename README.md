# MMM-PhotoDeck

A [MagicMirror²](https://magicmirror.builders/) module that shows your photos one at a time, each held still on a canvas with the date it was taken, crossfading to the next, all of them before any repeats, at next to no cost to a Raspberry Pi while a photo is held.

![A photo held on the mirror, with the date it was taken under it](screenshot.png)

**Photos.** Your own pictures, each held still with the date it was taken, the next one
crossfading in every 5 s: four to a 20 s page. They're dealt from a shuffled deck, so every
photo is shown once before any repeats.

Made for a page between animations in an [MMM-pages](https://github.com/edward-shen/MMM-pages)
rotation: after an animation the Pi gets a rest, without the screen going empty. While a photo is
held the module rests: measured on a Raspberry Pi 3, ~1% of a core, against 75–330% for the
animated pages around it. It is built for a **Raspberry Pi 3 without GPU acceleration**:
everything is drawn by the CPU, so the drawing is designed around what that costs (see
[Performance](#performance)), and the module stops completely while it is hidden.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/charleswest775/MMM-PhotoDeck
```

No npm dependencies: there is nothing to install. Then put your photos in `~/mirror-photos`
(or set `photoFolder`), resized: see [Photos](#photos).

## Update

```bash
cd ~/MagicMirror/modules/MMM-PhotoDeck
git pull
```

## Configuration

```js
{
	module: "MMM-PhotoDeck",
	position: "middle_center",
	config: {
		photoFolder: "~/mirror-photos",
		cycleSeconds: 3600,  // new photos each time the module is shown
		photoSeconds: 5,     // four to a 20 s page
		width: 900,          // on a landscape screen, wider photos reach the clock in the corner
		height: 1000,
		fps: 20              // for the crossfades; in between, the module rests
	}
},
```

| Option | Default | Description |
|---|---|---|
| `photoFolder` | `"~/mirror-photos"` | The folder of photos, on the computer MagicMirror runs on; a leading `~` is your home folder. For the default, the `MIRROR_PHOTOS` environment variable, if it's set, is used instead. Each instance of the module can have its own |
| `photoSeconds` | `5` | A new photo this often, its crossfade included: four to a 20 s page. `0`: one photo per showing |
| `photoFadeSeconds` | `0.8` | How long the crossfade from one photo to the next takes |
| `cycleSeconds` | `3600` | Start again with a fresh photo this often; new photos also start each time the module is shown again |
| `width`, `height` | `900` | Canvas size in pixels; photos are scaled to fit, the date under them |
| `fps` | `20` | Frame-rate cap, for the crossfades |
| `showMath` | `true` | The line under the canvas where a problem (no photos, say) is shown |
| `turns` | `null` | Take turns with other modules on the same page, e.g. `{ of: 2, at: 0 }` (see [Taking turns](#taking-turns)) |
| `statsPanel` | `false` | A line under the canvas showing what the mirror spends: fps, CPU of Electron and the compositor, a bar per core, temperature. Sampled by the module's `node_helper` from `/proc`, only while the module is shown |
| `debugStats` | `false` | Show achieved fps and per-frame timings in the corner of the screen |

The module's `node_helper` serves the default folder and the folders named by `photoFolder` in
MagicMirror's config, which it reads on the server, and no others.

## Taking turns

Every page added to an MMM-pages rotation makes it longer. Instead, modules can share a page and
take turns: with `turns: { of: n, at: k }`, the modules on a page count the same showings, and
each shows on its own one in n, from showing k (counting from 0). One that isn't on its turn
takes no room on the page and costs nothing.

For example, photos one time and the night sky
([MMM-NightSky](https://github.com/charleswest775/MMM-NightSky)) the next:

```js
{
	module: "MMM-PhotoDeck",
	classes: "page-quiet",
	position: "middle_center",
	config: { turns: { of: 2, at: 0 } }
},
{
	module: "MMM-NightSky",
	classes: "page-quiet",
	position: "middle_center",
	config: { turns: { of: 2, at: 1 }, skyLatitude: 51.5072, skyLongitude: -0.1276, skyPlace: "London" }
},
{
	module: "MMM-pages",
	config: { modules: [["page-clock"], ["page-quiet"]], rotationTime: 20000 }
},
```

Or list the photos' class on more than one page, between the others, e.g.
`modules: [["page-chaos"], ["page-photos"], ["page-atom"], ["page-photos"]]`, and each showing
brings the next photos. Without MMM-pages the module works just as well in an ordinary region.

## Photos

The module lists the folder's **JPEG, PNG and WebP** files (`.jpg`, `.jpeg`, `.png`, `.webp`,
in any case; names starting with `.` are skipped). **HEIC is not listed**: convert it first. The
list is read again each time the deck runs out, so photos added to the folder turn up without a
restart.

The date under a photo comes from its EXIF: `DateTimeOriginal`, else `DateTime`. Only JPEGs are
read for it; a PNG or WebP, or a JPEG without a date, has no caption. The EXIF orientation is
applied by Chromium when the photo is drawn.

**Resize them beforehand**, to about 1600 px on the long side: decoding a 12-megapixel phone
photo takes a Raspberry Pi far longer than decoding one of about the canvas's size. On a Mac,
for example, `sips` converts HEIC too, and keeps the EXIF, orientation and date included:

```bash
sips -s format jpeg -s formatOptions 85 -Z 1600 IMG_1234.HEIC --out ~/resized/IMG_1234.jpg
rsync -a ~/resized/ pi@mirror.local:mirror-photos/
```

The deck is shuffled so that no two photos from the same day come one after the other (a burst
of shots of one moment looks like the same photo twice), and a new deck keeps the last ten shown
back from its start, so no photo comes round again within a showing or two.

## How it keeps time

MagicMirror calls `resume()` only after a module has faded in, so the module clears its canvas
when it's hidden instead; otherwise the last picture would be what fades in. It goes further:
it picks and draws its first photo while hidden, ready to be faded in, and gets the second ready
too.

The crossfades keep time with the page. MMM-pages shows a page's modules 0.5 s after the page
changes; they have faded in, and `resume()` starts the photos' clock, at 1 s. Photo n is all in
(n − 1) × `photoSeconds` later, having faded in over the `photoFadeSeconds` before: on a 20 s
page the second at 6 s, the third at 11 s and the fourth at 16 s, held until the page starts to
fade out at 20 s. No fifth starts then: while MagicMirror fades a module out, the module draws
nothing new. The photo it had ready next goes back on the deck, to open the next showing.

## Performance

Each photo is laid out once, while the one before it is held: scaled to fit with the better
filter, its date under it, on a canvas of its own. A crossfade then only copies pixels, and only
in the box where either photo is: between two landscape photos, the black above and below them
is left alone. That box is still redrawn in full every frame of a crossfade, so the crossfade is
quick.

Measured on a Raspberry Pi 3 B+ (Electron 42, software rendering, 900×1000 at 20 fps, seven
showings), as CPU of the Electron processes plus the `cage` compositor, in % of one core (the Pi
has four). Baseline mirror without the module: 0.2%.

| | % of one core | achieved fps |
|---|---|---|
| module **hidden** (e.g. another MMM-pages page; measured with the same frame loop in MMM-ChaosTheory) | 0.3 | 0 |
| a photo held | ~1 | 0 |
| a crossfade, 0.8 s (frames 50 ms apart, none over 67 ms, in 12 fades timed) | 140–170 | 20 |
| laying out the next photo, ~0.4 s after a crossfade | 40–80 | |
| over a 20 s page of four photos, its page change included (~180 for its first second) | 39 (31–56) | |
| over a 20 s page with one photo held throughout (`photoSeconds: 0`) | 14 | |

Most of either page figure is the page change itself. Where the Pi's rest matters more than the
photos, `photoSeconds: 0` shows one photo per showing.

The design points behind these numbers, from measurements on the Pi, where all canvas drawing
is done by the CPU:

- Any frame that changes the canvas costs ~2% of a core per fps; so the frame rate is capped
  (`fps`), and the frame loop sleeps with `setTimeout` until a frame is due.
- On top of that, cost grows with the **area that changes**: Chromium redraws the bounding box
  of everything touched in a frame. Hence the crossfade's box.
- A held photo rests, and is only polled twice a second. While MagicMirror fades the module out,
  nothing new is drawn, and once it is hidden the module stops entirely.

## Development

```bash
node --test                       # EXIF dates, listing, folders, shuffling, crossfade timing (no dependencies)
node dev/serve.js ~/some-photos   # then open http://localhost:8765/dev/preview.html
```

`dev/serve.js` serves the module folder, and the photos from the folder given (as
`node_helper.js` does in MagicMirror); a port can follow the folder. `dev/preview.html` runs the
module outside MagicMirror, in a portrait 1200×1920 frame, with hide/show buttons that follow
MagicMirror's suspend/resume order. Query options override the config, e.g.
`?photoSeconds=3&photoFadeSeconds=1.5` or `?width=1100&height=1000`.

## License

MIT

Part of a family of MagicMirror² modules for a Raspberry Pi 3:
[MMM-ChaosTheory](https://github.com/charleswest775/MMM-ChaosTheory),
[MMM-Atom](https://github.com/charleswest775/MMM-Atom),
[MMM-FractalZoom](https://github.com/charleswest775/MMM-FractalZoom),
[MMM-Chladni](https://github.com/charleswest775/MMM-Chladni),
[MMM-SacredGeometry](https://github.com/charleswest775/MMM-SacredGeometry),
[MMM-Tilings](https://github.com/charleswest775/MMM-Tilings),
[MMM-PlanetsDance](https://github.com/charleswest775/MMM-PlanetsDance),
[MMM-NightSky](https://github.com/charleswest775/MMM-NightSky) and
[MMM-SnowCrystal](https://github.com/charleswest775/MMM-SnowCrystal).
