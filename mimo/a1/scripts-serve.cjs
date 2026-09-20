const http = require("http");
const fs = require("fs");
const path = require("path");
const root = "C:\\Users\\27417\\Desktop\\temp\\mimo\\a1";
const mime = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".map": "application/json"
};
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  });
}).listen(8765, "127.0.0.1", () => console.log("listening 8765"));
