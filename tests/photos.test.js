// Checks for the photo page: EXIF dates, the folder listing, layout, shuffling, and the
// crossfades' timing. Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { exifDate, listPhotos } = require("../photo-index.js");
const { Photos } = require("../simulations/photos.js");
const { formatDate, fit, shuffle } = Photos;

// A minimal JPEG header whose EXIF holds DateTime in IFD0 and, optionally,
// DateTimeOriginal in the Exif IFD, in either byte order.
function jpeg ({ le = true, dateTime = "2001:02:03 04:05:06", original = null } = {}) {
	const t = Buffer.alloc(200);
	const u16 = (o, v) => (le ? t.writeUInt16LE(v, o) : t.writeUInt16BE(v, o));
	const u32 = (o, v) => (le ? t.writeUInt32LE(v, o) : t.writeUInt32BE(v, o));
	t.write(le ? "II" : "MM", 0, "latin1");
	u16(2, 42);
	u32(4, 8);                                  // IFD0 at 8: two entries
	u16(8, 2);
	u16(10, 0x0132); u16(12, 2); u32(14, 20); u32(18, 100);      // DateTime → 100
	u16(22, 0x8769); u16(24, 4); u32(26, 1); u32(30, original ? 60 : 0); // Exif IFD → 60
	u32(34, 0);
	if (original) {
		u16(60, 1);
		u16(62, 0x9003); u16(64, 2); u32(66, 20); u32(70, 140);  // DateTimeOriginal → 140
		t.write(original, 140, "latin1");
	}
	t.write(dateTime, 100, "latin1");
	const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
	const len = Buffer.alloc(2);
	len.writeUInt16BE(app1.length + 2);
	return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xda, 0, 2])]);
}

test("EXIF date: DateTimeOriginal first, else DateTime, in both byte orders", () => {
	assert.strictEqual(exifDate(jpeg({ original: "2025:03:20 15:59:28" })), "2025-03-20");
	assert.strictEqual(exifDate(jpeg({ le: false, original: "2025:03:20 15:59:28" })), "2025-03-20");
	assert.strictEqual(exifDate(jpeg()), "2001-02-03");
	assert.strictEqual(exifDate(jpeg({ le: false })), "2001-02-03");
});

test("EXIF date: none for blank dates, no EXIF, truncation or non-JPEG", () => {
	assert.strictEqual(exifDate(jpeg({ dateTime: "0000:00:00 00:00:00" })), null);
	assert.strictEqual(exifDate(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])), null);
	assert.strictEqual(exifDate(jpeg({ original: "2025:03:20 15:59:28" }).subarray(0, 40)), null);
	assert.strictEqual(exifDate(Buffer.from("\x89PNG\r\n\x1a\n", "latin1")), null);
});

test("listing: images only, sorted, with dates", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-"));
	fs.writeFileSync(path.join(dir, "b.jpg"), jpeg({ original: "2025:03:20 15:59:28" }));
	fs.writeFileSync(path.join(dir, "a.JPG"), jpeg());
	fs.writeFileSync(path.join(dir, "c.png"), "not really a png");
	fs.writeFileSync(path.join(dir, "notes.txt"), "");
	fs.writeFileSync(path.join(dir, "._b.jpg"), "");
	assert.deepStrictEqual(listPhotos(dir), [
		{ name: "a.JPG", taken: "2001-02-03" },
		{ name: "b.jpg", taken: "2025-03-20" },
		{ name: "c.png", taken: null }
	]);
	assert.deepStrictEqual(listPhotos(path.join(dir, "missing")), []);
	fs.rmSync(dir, { recursive: true });
});

test("caption date", () => {
	assert.strictEqual(formatDate("2025-03-20"), "March 20, 2025");
	assert.strictEqual(formatDate("2010-12-01"), "December 1, 2010");
	assert.strictEqual(formatDate(null), "");
});

test("fit: centred, whole photo visible, shape kept", () => {
	assert.deepStrictEqual(fit(1200, 900, 1000, 1000), [0, 125, 1000, 750]);   // landscape
	assert.deepStrictEqual(fit(900, 1600, 1000, 1000), [219, 0, 563, 1000]);   // tall portrait
	assert.deepStrictEqual(fit(500, 500, 1000, 1000), [0, 0, 1000, 1000]);     // small: scaled up
});

// a seeded random() for repeatable shuffles
const lehmer = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("shuffle: a permutation, and never the last photo first", () => {
	const list = ["a", "b", "c", "d", "e"].map((name) => ({ name }));
	for (let seed = 1; seed < 200; seed++) {
		const out = shuffle(list, [{ name: "c" }], lehmer(seed));
		assert.deepStrictEqual(out.map((p) => p.name).sort(), ["a", "b", "c", "d", "e"]);
		assert.notStrictEqual(out[0].name, "c");
	}
	assert.deepStrictEqual(shuffle([{ name: "a" }], [{ name: "a" }]), [{ name: "a" }]);
});

test("shuffle: none of the last few shown among the first few, as many as there are others", () => {
	const photos = (n) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, taken: `2020-01-${10 + (i % 20)}` }));
	for (const [n, shown, kept] of [[442, 10, 10], [12, 10, 6], [8, 10, 4]]) {
		const list = photos(n), recent = list.slice(0, shown); // e.g. the end of the last deck
		const lately = new Set(recent.slice(-kept).map((p) => p.name));
		for (let seed = 1; seed < 100; seed++) {
			const out = shuffle(list, recent, lehmer(seed));
			assert.strictEqual(new Set(out.map((p) => p.name)).size, n);
			const early = out.slice(0, kept).filter((p) => lately.has(p.name));
			assert.deepStrictEqual(early, [], `${n} photos, seed ${seed}`);
			for (let i = 1; i < n; i++) assert.notStrictEqual(out[i].taken, out[i - 1].taken);
		}
	}
});

test("shuffle: photos from the same day never side by side, nor after the last one's day", () => {
	// like the library: a trip with a burst of photos a day, some photos undated
	const list = [];
	for (let d = 10; d < 16; d++) for (let k = 0; k < 6; k++) list.push({ name: `${d}-${k}`, taken: `2025-03-${d}` });
	for (let k = 0; k < 60; k++) list.push({ name: `x${k}`, taken: k % 3 ? `2019-01-${10 + (k % 20)}` : null });
	for (let seed = 1; seed < 200; seed++) {
		const out = shuffle(list, [{ name: "12-0", taken: "2025-03-12" }], lehmer(seed));
		assert.strictEqual(new Set(out.map((p) => p.name)).size, list.length);
		assert.notStrictEqual(out[0].taken, "2025-03-12");
		for (let i = 1; i < out.length; i++) {
			if (out[i].taken) assert.notStrictEqual(out[i].taken, out[i - 1].taken, `seed ${seed}, at ${i}`);
		}
	}
});

test("next: callers at once share one deck, dealt once; the next keeps the last few back", async () => {
	const names = ["a", "b", "c", "d", "e", "f"];
	let fetches = 0;
	globalThis.fetch = async () => {
		fetches++;
		await new Promise((r) => setTimeout(r, 10));
		return { ok: true, json: async () => names.map((name) => ({ name, taken: null })) };
	};
	try {
		const got = await Promise.all([Photos.next("/t/"), Photos.next("/t/"), Photos.next("/t/")]);
		for (let i = 3; i < names.length; i++) got.push(await Photos.next("/t/"));
		assert.strictEqual(fetches, 1);
		assert.deepStrictEqual(got.map((p) => p.name).sort(), names); // each once
		const ending = got.slice(-3).map((p) => p.name); // half the list: as many as can be kept back
		const next = [];
		for (let i = 0; i < 3; i++) next.push((await Photos.next("/t/")).name);
		assert.deepStrictEqual(next.filter((n) => ending.includes(n)), [], "the next deck starts with others");
		assert.strictEqual(fetches, 2);
	} finally {
		delete globalThis.fetch;
	}
});

// Enough of a browser for the carousel: canvases that remember what was drawn on them, with
// what alpha; an Image that decodes at once (or, for names in `slow`, when released); a list.
function browser (list, { slow = [], sizes = {} } = {}) {
	const saved = ["Image", "document", "fetch"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
	const waiting = new Map();
	const canvas = () => {
		const c = { draws: [] };
		c.ctx = {
			globalAlpha: 1,
			fillRect () {},
			fillText () {},
			measureText: (s) => ({ width: 10 * s.length }),
			drawImage (src, ...at) { c.draws.push({ src, alpha: this.globalAlpha, at }); }
		};
		c.getContext = () => c.ctx;
		return c;
	};
	globalThis.fetch = async () => ({ ok: true, json: async () => list });
	globalThis.document = { createElement: canvas };
	globalThis.Image = class {
		set src (url) {
			this.name = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
			[this.naturalWidth, this.naturalHeight] = sizes[this.name] || [1600, 1200];
		}

		decode () {
			return slow.includes(this.name) ? new Promise((r) => waiting.set(this.name, r)) : Promise.resolve();
		}
	};
	return {
		screen: canvas(),
		release: (name) => waiting.get(name)(),
		restore () { for (const [k, d] of saved) if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
	};
}

const settle = () => new Promise((r) => setImmediate(r));
const photoOf = (slide) => slide.draws[0].src.name; // a composed photo's canvas: what's on it
const deal = (base, names) => { Photos.decks[base] = names.map((name, i) => ({ name, taken: `2025-03-1${i}` })); };

// The module's loop, for `seconds` on screen: a frame every 1/16 s while the sim is busy, a
// poll every 0.5 s while it rests (binary fractions: the times add up exactly), and between
// them time for loading. The frames that drew something, as { t, draws }.
async function show (sim, screen, seconds, tick = () => {}) {
	const frames = [];
	for (let t = 0; t < seconds;) {
		const dt = sim.resting ? 0.5 : 1 / 16;
		t += dt;
		tick(t);
		sim.step(dt);
		if (!sim.resting) {
			const n = screen.draws.length;
			sim.draw(screen.ctx, 900, 1000);
			if (screen.draws.length > n) frames.push({ t, draws: screen.draws.slice(n) });
		}
		await settle();
	}
	return frames;
}

// the crossfades in those frames: which photo came in, and when, with what alpha each frame
const fadesIn = (frames) => {
	const fades = [];
	for (const { t, draws } of frames) {
		const to = draws.at(-1), name = photoOf(to.src);
		if (fades.at(-1)?.name !== name) fades.push({ name, t: [], alpha: [], at: [] });
		const f = fades.at(-1);
		f.t.push(t);
		f.alpha.push(to.alpha);
		f.at.push(to.at);
	}
	return fades;
};

// primed while hidden, as the module does: step(0) and draw until it rests
const prime = (sim, screen) => {
	sim.step(0);
	sim.draw(screen.ctx, 900, 1000);
};

test("carousel: a new photo every photoSeconds, all in on the beat", async () => {
	const b = browser([]);
	try {
		deal("/beat/", ["a", "b", "c", "d", "e", "f"]);
		const sim = new Photos({ photoUrl: "/beat/", width: 900, height: 1000, photoSeconds: 5, photoFadeSeconds: 0.75 });
		await settle();
		prime(sim, b.screen);
		assert.ok(sim.resting, "holds the first photo");
		assert.strictEqual(photoOf(sim.upcoming.canvas), "b", "with the next one ready");
		assert.deepStrictEqual(b.screen.draws.map((d) => [photoOf(d.src), d.at]), [["a", [0, 0]]]);

		// a 20 s page: resume() comes after the 0.5 s fade-in, the fade-out starts at 20 s
		const fades = fadesIn(await show(sim, b.screen, 19));
		assert.deepStrictEqual(fades.map((f) => f.name), ["b", "c", "d"]);
		fades.forEach((f, i) => {
			const k = i + 1; // photo k is all in at 5k s, having started at 5k − 0.75
			assert.strictEqual(f.t[0], 5 * k - 0.75 + 1 / 16, `photo ${k} starts on the beat`);
			assert.strictEqual(f.t.at(-1), 5 * k, `photo ${k} all in on the beat`);
			assert.strictEqual(f.alpha.at(-1), 1);
			for (let j = 1; j < f.alpha.length; j++) assert.ok(f.alpha[j] > f.alpha[j - 1], "fading in smoothly");
		});
		assert.ok(!sim.resting, "awake for the fifth, due at 19.25 s");

		// the photos' canvases freed once they're no longer needed
		const canvases = [b.screen.draws[0].src, ...fades.map((f) => b.screen.draws.find((d) => photoOf(d.src) === f.name).src)];
		assert.deepStrictEqual(canvases.map((c) => c.width), [0, 0, 0, 900], "all but the one on screen");
		const next = sim.upcoming.canvas;
		sim.dispose();
		assert.deepStrictEqual([canvases[3].width, next.width], [0, 0], "and the rest when replaced");
	} finally {
		b.restore();
	}
});

test("carousel: a crossfade redraws only where either photo is", async () => {
	const b = browser([], { sizes: { c: [1200, 1600] } });
	try {
		deal("/box/", ["a", "b", "c", "d"]);
		const sim = new Photos({ photoUrl: "/box/", width: 900, height: 1000 });
		await settle();
		prime(sim, b.screen);
		const fades = fadesIn(await show(sim, b.screen, 11));
		// 4:3 with its date, in 900×1000: 900×675 at y = 138, its date below it to 863.
		// 3:4: 713×950 at x = 94, its date below it to 1000.
		assert.deepStrictEqual(fades.map((f) => f.name), ["b", "c"]);
		for (const at of fades[0].at) assert.deepStrictEqual(at, [0, 138, 900, 725, 0, 138, 900, 725]);
		for (const at of fades[1].at) assert.deepStrictEqual(at, [0, 0, 900, 1000, 0, 0, 900, 1000]);
	} finally {
		b.restore();
	}
});

test("carousel: a late photo fades in from the start, and the beat holds", async () => {
	const b = browser([], { slow: ["b"] });
	try {
		deal("/late/", ["a", "b", "c", "d"]);
		const sim = new Photos({ photoUrl: "/late/", width: 900, height: 1000, photoSeconds: 5, photoFadeSeconds: 0.75 });
		await settle();
		prime(sim, b.screen);
		const fades = fadesIn(await show(sim, b.screen, 11, (t) => t === 6 && b.release("b")));
		assert.deepStrictEqual(fades.map((f) => f.name), ["b", "c"]);
		assert.strictEqual(fades[0].t[0], 6.5 + 1 / 16, "b fades in once it's ready");
		assert.ok(fades[0].alpha[0] < 0.05, "from the start");
		assert.strictEqual(fades[1].t.at(-1), 10, "c on the beat");
	} finally {
		b.restore();
	}
});

test("carousel: a first photo loaded on screen still gets its time", async () => {
	const b = browser([], { slow: ["a"] });
	try {
		deal("/first/", ["a", "b", "c"]);
		const sim = new Photos({ photoUrl: "/first/", width: 900, height: 1000, photoSeconds: 5, photoFadeSeconds: 0.75 });
		const frames = await show(sim, b.screen, 8, (t) => t === 1.5 && b.release("a"));
		assert.strictEqual(frames[0].t, 1.5 + 1 / 16, "a drawn as soon as it's ready");
		assert.strictEqual(fadesIn(frames.slice(1))[0].t.at(-1), 1.5 + 1 / 16 + 5, "b all in 5 s later");
	} finally {
		b.restore();
	}
});

test("carousel: photos got ready but not shown go back on the deck", async () => {
	const b = browser([], { slow: ["y"] });
	const names = (base) => Photos.decks[base].map((p) => p.name);
	try {
		// made and replaced while hidden, never shown: both back, in order
		deal("/back/", ["a", "b", "c"]);
		new Photos({ photoUrl: "/back/" }).dispose();
		await settle();
		const hidden = new Photos({ photoUrl: "/back/" });
		await settle();
		hidden.dispose();
		assert.deepStrictEqual(names("/back/"), ["a", "b", "c"]);

		// shown: only the one it had ready next
		const shown = new Photos({ photoUrl: "/back/", width: 900, height: 1000 });
		await settle();
		prime(shown, b.screen);
		await show(shown, b.screen, 1);
		shown.dispose();
		assert.deepStrictEqual(names("/back/"), ["b", "c"]);

		// still loading when replaced: back once it has loaded
		deal("/back/", ["x", "y", "z"]);
		const loading = new Photos({ photoUrl: "/back/", width: 900, height: 1000 });
		await settle();
		prime(loading, b.screen);
		await show(loading, b.screen, 1);
		loading.dispose();
		assert.deepStrictEqual(names("/back/"), ["z"]);
		b.release("y");
		await settle();
		assert.deepStrictEqual(names("/back/"), ["y", "z"]);
	} finally {
		b.restore();
	}
});

test("carousel: photoSeconds 0 holds one photo per showing", async () => {
	const b = browser([]);
	try {
		deal("/one/", ["a", "b"]);
		const sim = new Photos({ photoUrl: "/one/", width: 900, height: 1000, photoSeconds: 0 });
		await settle();
		prime(sim, b.screen);
		assert.deepStrictEqual(await show(sim, b.screen, 60), []);
		assert.strictEqual(Photos.decks["/one/"].length, 1, "the next photo left on the deck");
	} finally {
		b.restore();
	}
});
