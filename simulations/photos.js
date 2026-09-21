/* Not an animation: one photo per showing, held still, with the date it was taken.
 * The page between animations: a still picture costs the Pi nothing once drawn (the sim
 * rests), so it gives the CPU the gap the old empty page did, without an empty screen.
 * Photos come from node_helper.js (see photo-index.js), resized beforehand by the sync
 * script; they're shuffled and each is shown once before any repeats.
 */
(function (root) {
	const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

	// "2025-03-20" → "March 20, 2025"
	const formatDate = (taken) => {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(taken || "");
		return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : "";
	};

	const CAPTION = 50; // px under the photo for its date

	// the largest rectangle with the image's shape that fits in w × h, centred
	const fit = (iw, ih, w, h) => {
		const s = Math.min(w / iw, h / ih);
		const dw = Math.round(iw * s), dh = Math.round(ih * s);
		return [Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh];
	};

	// Fisher–Yates, keeping `avoid` (the photo just shown) out of first place
	const shuffle = (list, avoid, random = Math.random) => {
		const a = list.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		if (a.length > 1 && avoid && a[0].name === avoid) a.push(a.shift());
		return a;
	};

	class Photos {
		constructor (opts = {}) {
			this.base = opts.photoUrl || "/MMM-ChaosTheory/photos/";
			this.img = null;
			this.caption = "";
			this.error = "";
			this.resting = false; // until the photo is on the canvas
			this.drawn = false;
			if (typeof Image !== "undefined") this.load().catch((e) => this.fail(e.message));
		}

		async load () {
			const photo = await Photos.next(this.base);
			if (!photo) return this.fail(`No photos in the mirror's photo folder (${this.base})`);
			const img = new Image();
			img.src = this.base + encodeURIComponent(photo.name);
			await img.decode(); // off the main thread, so the page doesn't stutter
			this.img = img;
			this.caption = formatDate(photo.taken);
		}

		fail (message) {
			this.error = message;
			this.resting = true;
		}

		// the next photo of the shuffled deck; a fresh list and shuffle when it runs out
		static async next (base) {
			const deck = Photos.decks[base] = Photos.decks[base] || [];
			if (!deck.length) {
				const res = await fetch(base);
				if (!res.ok) throw new Error(`photo list: HTTP ${res.status}`);
				deck.push(...shuffle(await res.json(), Photos.last[base]));
			}
			const photo = deck.shift();
			if (photo) Photos.last[base] = photo.name;
			return photo;
		}

		step () {}

		// the photo and its date under it, centred together; drawn once, then the sim rests
		draw (ctx, w, h) {
			if (!this.img || this.drawn) return;
			const band = this.caption ? CAPTION : 0;
			const [x, , dw, dh] = fit(this.img.naturalWidth, this.img.naturalHeight, w, h - band);
			const y = Math.round((h - dh - band) / 2);
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, w, h);
			ctx.imageSmoothingQuality = "high"; // once per photo, so the better filter is affordable
			ctx.drawImage(this.img, x, y, dw, dh);
			if (band) {
				ctx.font = '24px "Roboto Condensed", sans-serif';
				ctx.fillStyle = "#999";
				ctx.textAlign = "center";
				ctx.textBaseline = "top";
				ctx.fillText(this.caption, w / 2, y + dh + 16);
			}
			this.drawn = this.resting = true;
		}

		readout () {
			return this.error;
		}
	}

	// cheap to get ready before the page is shown: load the photo, draw it, hold it
	Photos.preloadWhileHidden = true;
	Photos.decks = {};
	Photos.last = {};
	Photos.info = { title: "", equations: [] };
	Photos.formatDate = formatDate;
	Photos.fit = fit;
	Photos.shuffle = shuffle;

	root.ChaosSimulations = root.ChaosSimulations || {};
	root.ChaosSimulations.photos = Photos;
	if (typeof module !== "undefined") module.exports = { Photos };
})(typeof window !== "undefined" ? window : globalThis);
