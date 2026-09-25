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

	// Fisher–Yates, then no two neighbours from the same day (a burst of shots of one moment
	// looks like the same photo twice), nor the photo just shown (`last`) or its day first
	const shuffle = (list, last, random = Math.random) => {
		const a = list.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		const clash = (p, q) => Boolean(q) && (p.name === q.name || (Boolean(p.taken) && p.taken === q.taken));
		for (let i = 0; i < a.length; i++) {
			const prev = i ? a[i - 1] : last;
			if (!clash(a[i], prev)) continue;
			const j = a.findIndex((p, k) => k > i && !clash(p, prev));
			if (j > 0) {
				[a[i], a[j]] = [a[j], a[i]];
				continue;
			}
			// none left that fits (near the end): move it back between two it doesn't clash with
			const p = a[i];
			const k = a.findIndex((q, k) => k < i && !clash(p, q) && !clash(p, k ? a[k - 1] : last));
			if (k >= 0) a.splice(k, 0, ...a.splice(i, 1));
		}
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

		// the next photo of the shuffled deck; a fresh list and shuffle when it runs out.
		// One fetch at a time: two sims asking at once (at start-up, a photo loading when the
		// module is hidden and preloads the next) would each deal a whole deck onto it.
		static async next (base) {
			const deck = Photos.decks[base] = Photos.decks[base] || [];
			if (!deck.length) {
				Photos.dealing[base] = Photos.dealing[base] || fetch(base)
					.then((res) => {
						if (!res.ok) throw new Error(`photo list: HTTP ${res.status}`);
						return res.json();
					})
					.then((list) => { deck.push(...shuffle(list, Photos.last[base])); })
					.finally(() => { delete Photos.dealing[base]; });
				await Photos.dealing[base];
			}
			const photo = deck.shift();
			if (photo) Photos.last[base] = photo;
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
	Photos.dealing = {};
	Photos.info = { title: "", equations: [] };
	Photos.formatDate = formatDate;
	Photos.fit = fit;
	Photos.shuffle = shuffle;

	root.ChaosSimulations = root.ChaosSimulations || {};
	root.ChaosSimulations.photos = Photos;
	if (typeof module !== "undefined") module.exports = { Photos };
})(typeof window !== "undefined" ? window : globalThis);
