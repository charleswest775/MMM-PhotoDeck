/* The photo page's library: the pictures in a folder and when each was taken.
 * Used by node_helper.js, which serves the list and the files to the photos page.
 * The date comes from the JPEG's EXIF (DateTimeOriginal, else DateTime), which the
 * sync script's resized copies keep.
 */
const fs = require("node:fs");
const path = require("node:path");

const IMAGE = /\.(jpe?g|png|webp)$/i;

// "YYYY-MM-DD" from a JPEG's EXIF, or null. Needs only the start of the file.
function exifDate (buf) {
	if (buf.readUInt16BE(0) !== 0xffd8) return null;
	let at = 2;
	while (at + 4 <= buf.length && buf[at] === 0xff) {
		const marker = buf[at + 1], len = buf.readUInt16BE(at + 2);
		if (marker === 0xe1 && buf.toString("latin1", at + 4, at + 10) === "Exif\0\0") return tiffDate(buf, at + 10);
		if (marker === 0xda) break; // image data: no EXIF before it
		at += 2 + len;
	}
	return null;
}

function tiffDate (buf, tiff) {
	const le = buf.toString("latin1", tiff, tiff + 2) === "II";
	const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
	const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
	// the entries of the IFD at offset `ifd`, as tag → offset of the entry
	const entries = (ifd) => {
		const map = new Map(), start = tiff + ifd;
		if (start + 2 > buf.length) return map;
		const n = u16(start);
		for (let i = 0; i < n && start + 2 + 12 * i + 12 <= buf.length; i++) map.set(u16(start + 2 + 12 * i), start + 2 + 12 * i);
		return map;
	};
	// dates are ASCII "YYYY:MM:DD HH:MM:SS" (20 bytes, so stored at an offset)
	const date = (entry) => {
		if (entry === undefined) return null;
		const o = tiff + u32(entry + 8);
		const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(buf.toString("latin1", o, o + 19));
		return m && m[1] !== "0000" ? `${m[1]}-${m[2]}-${m[3]}` : null;
	};
	try {
		const ifd0 = entries(u32(tiff + 4));
		const exif = ifd0.has(0x8769) ? entries(u32(ifd0.get(0x8769) + 8)) : new Map();
		return date(exif.get(0x9003)) || date(ifd0.get(0x0132));
	} catch (e) {
		return null; // truncated or malformed
	}
}

// [{ name, taken }] for the images in `dir`, taken "YYYY-MM-DD" or null.
// Dates are cached by name and modification time, so re-listing is cheap.
const cache = new Map();
function listPhotos (dir) {
	let names;
	try { names = fs.readdirSync(dir).filter((n) => IMAGE.test(n) && !n.startsWith(".")); } catch (e) { return []; }
	return names.sort().map((name) => {
		const file = path.join(dir, name);
		const { mtimeMs } = fs.statSync(file);
		const key = `${file}@${mtimeMs}`;
		if (!cache.has(key)) {
			const fd = fs.openSync(file, "r"), head = Buffer.alloc(128 * 1024);
			const n = fs.readSync(fd, head, 0, head.length, 0);
			fs.closeSync(fd);
			cache.set(key, /\.jpe?g$/i.test(name) ? exifDate(head.subarray(0, n)) : null);
		}
		return { name, taken: cache.get(key) };
	});
}

module.exports = { exifDate, listPhotos, IMAGE };
