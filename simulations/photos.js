/* Not an animation: photos, each held still with the date it was taken, the next one
 * crossfading in every `photoSeconds` (four to a 20 s page).
 * The page between animations: a still picture costs the Pi nothing once drawn (the sim
 * rests), so it gives the CPU the gap the old empty page did, without an empty screen.
 * A crossfade is a full redraw while it lasts, so it's quick, and it only redraws where
 * either photo is; the next photo is loaded and laid out while the last one is held.
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
	const POLL = 0.5;   // s: how often the module looks in on a resting sim
	const RECENT = 10;  // photos dealt lately that a new deck keeps back: about two showings' worth

	// the largest rectangle with the image's shape that fits in w × h, centred
	const fit = (iw, ih, w, h) => {
		const s = Math.min(w / iw, h / ih);
		const dw = Math.round(iw * s), dh = Math.round(ih * s);
		return [Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh];
	};

	// Fisher–Yates, then no two neighbours from the same day (a burst of shots of one moment
	// looks like the same photo twice), nor the photo just shown or its day first. And the
	// last few shown (`recent`, oldest first; at most half the list) none of them among the
	// first few, so no photo comes round again within a showing or two of a new deck.
	const shuffle = (list, recent = [], random = Math.random) => {
		const a = list.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		const last = recent[recent.length - 1];
		const m = Math.min(recent.length, Math.floor(a.length / 2));
		const lately = new Set(recent.slice(recent.length - m).map((p) => p.name));
		const clash = (p, q) => Boolean(q) && (p.name === q.name || (Boolean(p.taken) && p.taken === q.taken));
		const fits = (p, i, prev) => !clash(p, prev) && !(i < lately.size && lately.has(p.name));
		for (let i = 0; i < a.length; i++) {
			const prev = i ? a[i - 1] : last;
			if (fits(a[i], i, prev)) continue;
			const j = a.findIndex((p, k) => k > i && fits(p, i, prev));
			if (j > 0) {
				[a[i], a[j]] = [a[j], a[i]];
				continue;
			}
			// none left that fits (near the end): move it back between two it doesn't clash with
			const p = a[i];
			const k = a.findIndex((q, k) => k < i && !clash(p, q) && fits(p, k, k ? a[k - 1] : last));
			if (k >= 0) a.splice(k, 0, ...a.splice(i, 1));
		}
		return a;
	};

	// A photo as it will be shown, drawn once on a canvas of its own: black, the photo, its
	// date under it. `box` [x0, y0, x1, y1] is where it isn't black.
	const compose = (img, caption, w, h) => {
		const band = caption ? CAPTION : 0;
		const [x, , dw, dh] = fit(img.naturalWidth, img.naturalHeight, w, h - band);
		const y = Math.round((h - dh - band) / 2);
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d", { alpha: false });
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, w, h);
		ctx.imageSmoothingQuality = "high"; // once per photo, so the better filter is affordable
		ctx.drawImage(img, x, y, dw, dh);
		const box = [x, y, x + dw, y + dh];
		if (band) {
			ctx.font = '24px "Roboto Condensed", sans-serif';
			ctx.fillStyle = "#999";
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillText(caption, w / 2, y + dh + 16);
			const half = Math.ceil(ctx.measureText(caption).width / 2) + 2;
			box[0] = Math.max(0, Math.min(x, Math.floor(w / 2) - half));
			box[2] = Math.min(w, Math.max(x + dw, Math.ceil(w / 2) + half));
			box[3] = y + dh + band;
		}
		return { canvas, box };
	};

	// its pixels freed now, not whenever the garbage is collected: the Pi has little memory
	const discard = (slide) => {
		if (slide) slide.canvas.width = slide.canvas.height = 0;
	};

	// `to` over `from`, a fraction `a` of the way in; only inside the box around both photos,
	// since outside it both are black
	const crossfade = (ctx, from, to, a) => {
		const x = Math.min(from.box[0], to.box[0]), y = Math.min(from.box[1], to.box[1]);
		const w = Math.max(from.box[2], to.box[2]) - x, h = Math.max(from.box[3], to.box[3]) - y;
		ctx.globalAlpha = 1;
		if (a < 1) ctx.drawImage(from.canvas, x, y, w, h, x, y, w, h);
		ctx.globalAlpha = a;
		ctx.drawImage(to.canvas, x, y, w, h, x, y, w, h);
		ctx.globalAlpha = 1;
	};

	class Photos {
		// photoSeconds: a new photo this often, its crossfade included (0: one per showing);
		// photoFadeSeconds: how long the crossfade takes
		constructor ({ photoUrl = "/MMM-ChaosTheory/photos/", width = 900, height = 900, photoSeconds = 5, photoFadeSeconds = 0.8 } = {}) {
			this.base = photoUrl;
			this.w = width;
			this.h = height;
			this.seconds = photoSeconds;
			this.fadeSeconds = photoFadeSeconds;
			this.clock = 0;       // seconds on screen
			this.fadeAt = photoSeconds - photoFadeSeconds; // photo k, from 0, is all in at k × photoSeconds
			this.slide = null;    // the photo on screen, composed
			this.upcoming = null; // the next one, once it's ready
			this.fade = null;     // { from, to, start } during a crossfade
			this.error = "";
			this.resting = false; // until the first photo is on the canvas
			this.drawn = false;
			if (typeof Image !== "undefined") this.start().catch((e) => this.fail(e.message));
		}

		async start () {
			this.slide = await this.load();
			if (this.slide && this.seconds > 0) this.preload();
		}

		// the next photo, got ready while this one is held
		preload () {
			this.load().then((s) => { this.upcoming = s; }, (e) => { this.error = e.message; });
		}

		// The next photo of the deck, decoded and composed. Null if the module replaced this sim
		// meanwhile: then the photo goes back on the deck.
		async load (tries = 3) {
			const photo = await Photos.next(this.base);
			if (!photo) throw new Error(`No photos in the mirror's photo folder (${this.base})`);
			const img = new Image();
			img.src = this.base + encodeURIComponent(photo.name);
			try {
				await img.decode(); // off the main thread, so the page doesn't stutter
			} catch (e) {
				if (tries > 1 && !this.disposed) return this.load(tries - 1); // gone since the list was made? the next one
				throw new Error(`${photo.name}: ${e.message}`);
			}
			if (this.disposed) {
				Photos.putBack(this.base, photo);
				return null;
			}
			return { photo, ...compose(img, formatDate(photo.taken), this.w, this.h) };
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
			const recent = Photos.recent[base] = Photos.recent[base] || [];
			if (!deck.length) {
				Photos.dealing[base] = Photos.dealing[base] || fetch(base)
					.then((res) => {
						if (!res.ok) throw new Error(`photo list: HTTP ${res.status}`);
						return res.json();
					})
					.then((list) => { deck.push(...shuffle(list, recent)); })
					.finally(() => { delete Photos.dealing[base]; });
				await Photos.dealing[base];
			}
			const photo = deck.shift();
			if (photo) recent.push(photo);
			if (recent.length > RECENT) recent.shift();
			return photo;
		}

		// back on top of the deck, to be dealt next
		static putBack (base, photo) {
			(Photos.decks[base] = Photos.decks[base] || []).unshift(photo);
		}

		step (dt) {
			this.clock += dt;
			if (this.fade || !this.drawn || !this.upcoming) return;
			if (this.clock >= this.fadeAt) {
				this.fade = { from: this.slide, to: this.upcoming, start: this.clock };
				this.upcoming = null;
			}
			// a resting sim is only polled every POLL s: be awake before the beat, so the fade
			// starts within a frame of it (or as soon as the photo is ready, if it's late)
			this.resting = this.clock < this.fadeAt - POLL;
		}

		// the first photo whole; then, at each crossfade, the next one fading in over the last
		draw (ctx) {
			const f = this.fade;
			if (f) {
				const p = this.fadeSeconds > 0 ? Math.min(1, (this.clock - f.start) / this.fadeSeconds) : 1;
				if (p > 0) crossfade(ctx, f.from, f.to, p * p * (3 - 2 * p));
				if (p === 1) this.faded();
			} else if (this.slide && !this.drawn) {
				ctx.drawImage(this.slide.canvas, 0, 0);
				this.drawn = this.resting = true;
				// normally drawn while hidden, at 0; if it was loaded on screen, its full time anyway
				this.fadeAt = Math.max(this.fadeAt, this.clock + this.seconds - this.fadeSeconds);
			}
		}

		// the new photo is all in: hold it, and get the next one ready
		faded () {
			discard(this.fade.from);
			this.slide = this.fade.to;
			this.fade = null;
			this.fadeAt += this.seconds;
			this.resting = true;
			this.preload();
		}

		// The module replaces the sim when the page is hidden. Photos it had ready but didn't
		// show go back on the deck, to open the next showing.
		dispose () {
			this.disposed = true;
			if (this.upcoming) Photos.putBack(this.base, this.upcoming.photo);
			if (this.slide && !this.clock) Photos.putBack(this.base, this.slide.photo); // never on screen
			[this.slide, this.upcoming, this.fade && this.fade.to].forEach(discard);
			this.slide = this.upcoming = this.fade = null;
		}

		readout () {
			return this.error;
		}
	}

	// cheap to get ready before the page is shown: load the first two photos, draw one, hold it
	Photos.preloadWhileHidden = true;
	Photos.decks = {};
	Photos.recent = {};
	Photos.dealing = {};
	Photos.info = { title: "", equations: [] };
	Photos.formatDate = formatDate;
	Photos.fit = fit;
	Photos.shuffle = shuffle;

	root.ChaosSimulations = root.ChaosSimulations || {};
	root.ChaosSimulations.photos = Photos;
	if (typeof module !== "undefined") module.exports = { Photos };
})(typeof window !== "undefined" ? window : globalThis);
