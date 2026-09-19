// Checks for the photo page: EXIF dates, the folder listing, layout and shuffling. Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { exifDate, listPhotos } = require("../photo-index.js");
const { Photos: { formatDate, fit, shuffle } } = require("../simulations/photos.js");

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

test("shuffle: a permutation, and never the last photo first", () => {
	const list = ["a", "b", "c", "d", "e"].map((name) => ({ name }));
	for (let seed = 1; seed < 200; seed++) {
		let s = seed;
		const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
		const out = shuffle(list, "c", random);
		assert.deepStrictEqual(out.map((p) => p.name).sort(), ["a", "b", "c", "d", "e"]);
		assert.notStrictEqual(out[0].name, "c");
	}
	assert.deepStrictEqual(shuffle([{ name: "a" }], "a"), [{ name: "a" }]);
});
