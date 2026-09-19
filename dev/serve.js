/* Serves the repo for dev/preview.html, plus the photo page's routes that node_helper.js
 * adds to MagicMirror, from a local folder of photos:
 *   node dev/serve.js [photo folder] [port]     (default ~/Pictures/Mirror, 8765)
 * then open http://localhost:8765/dev/preview.html?simulations=photos
 * The folder should hold resized JPEGs, as mac/sync-mirror-photos.sh makes them; big
 * originals work too, and HEIC isn't listed.
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listPhotos } = require("../photo-index.js");

const root = path.join(__dirname, "..");
const photos = path.resolve(process.argv[2] || path.join(os.homedir(), "Pictures", "Mirror"));
const port = Number(process.argv[3]) || 8765;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const send = (res, file) => fs.readFile(file, (err, data) => {
	if (err) return res.writeHead(404).end();
	res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" }).end(data);
});

http.createServer((req, res) => {
	const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
	if (url === "/MMM-ChaosTheory/photos/") {
		return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(listPhotos(photos)));
	}
	if (url.startsWith("/MMM-ChaosTheory/photos/")) return send(res, path.join(photos, path.basename(url)));
	const file = path.join(root, path.normalize(url));
	if (!file.startsWith(root)) return res.writeHead(403).end();
	send(res, file);
}).listen(port, () => console.log(`http://localhost:${port}/dev/preview.html  (photos from ${photos})`));
