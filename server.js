require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${BASE}/auth/tiktok/callback`;
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY || "";
const KEY = /^[0-9a-f]{64}$/i.test(KEY_HEX) ? Buffer.from(KEY_HEX, "hex") : null;

if (!process.env.SESSION_SECRET || !KEY || !CLIENT_KEY || !CLIENT_SECRET) {
  console.warn("Setup incomplete: configure .env using .env.example before OAuth can work.");
}

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
const db = new Database(path.join(__dirname, "data", "app.db"));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  open_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  token_blob TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  refresh_blob TEXT,
  refresh_expires_at INTEGER
)`);

function encrypt(value) {
  if (!KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
function decrypt(blob) {
  if (!KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const [iv, tag, data] = blob.split(".").map(x => Buffer.from(x, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
function configReady() {
  return Boolean(CLIENT_KEY && CLIENT_SECRET && KEY && process.env.SESSION_SECRET);
}
function account() {
  return db.prepare("SELECT * FROM tiktok_accounts WHERE id=1").get();
}
async function refreshIfNeeded(row) {
  if (row.expires_at > Date.now() + 120000) return decrypt(row.token_blob);
  if (!row.refresh_blob) throw new Error("TikTok authorization expired. Please connect again.");
  const refreshToken = decrypt(row.refresh_blob);
  const form = new URLSearchParams({
    client_key: CLIENT_KEY, client_secret: CLIENT_SECRET,
    grant_type: "refresh_token", refresh_token: refreshToken
  });
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error_description || "Could not refresh TikTok token");
  db.prepare(`UPDATE tiktok_accounts SET token_blob=?, expires_at=?, refresh_blob=?, refresh_expires_at=? WHERE id=1`)
    .run(encrypt(data.access_token), Date.now() + data.expires_in * 1000,
      data.refresh_token ? encrypt(data.refresh_token) : row.refresh_blob,
      data.refresh_expires_in ? Date.now() + data.refresh_expires_in * 1000 : row.refresh_expires_at);
  return data.access_token;
}
async function tiktokGet(endpoint, token, fields) {
  const url = new URL(`https://open.tiktokapis.com${endpoint}`);
  if (fields) url.searchParams.set("fields", fields);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await response.json();
  if (!response.ok || json.error?.code !== "ok") {
    throw new Error(json.error?.message || `TikTok API error (${response.status})`);
  }
  return json.data;
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000 }
}));
app.use("/auth", rateLimit({ windowMs: 60 * 1000, limit: 20 }));
app.use(express.static(path.join(__dirname, "public")));

// Serve the homepage and frontend files from repository root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/app.js", (req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});


app.get("/api/status", (_req, res) => {
  const row = account();
  res.json({
    configured: configReady(),
    connected: Boolean(row),
    account: row ? { open_id: row.open_id, display_name: row.display_name, avatar_url: row.avatar_url } : null
  });
});

app.get("/auth/tiktok", (req, res) => {
  if (!configReady()) return res.status(503).send("সার্ভার সেটআপ অসম্পূর্ণ। .env ফাইল পূরণ করুন।");
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    scope: "user.info.basic,video.list",
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state
  });
  res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
});

app.get("/auth/tiktok/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) {
      throw new Error("OAuth state যাচাই করা যায়নি। আবার Connect করুন।");
    }
    delete req.session.oauthState;
    const form = new URLSearchParams({
      client_key: CLIENT_KEY, client_secret: CLIENT_SECRET,
      code: String(req.query.code), grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI
    });
    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form
    });
    const token = await response.json();
    if (!response.ok || token.error) throw new Error(token.error_description || "TikTok token exchange failed");
    const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
    profileUrl.searchParams.set("fields", "open_id,display_name,avatar_url");
    const profileResponse = await fetch(profileUrl, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || profile.error?.code !== "ok") throw new Error(profile.error?.message || "Profile API failed");
    const u = profile.data.user;
    db.prepare(`INSERT INTO tiktok_accounts (id,open_id,display_name,avatar_url,token_blob,expires_at,refresh_blob,refresh_expires_at)
      VALUES (1,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET open_id=excluded.open_id,display_name=excluded.display_name,
      avatar_url=excluded.avatar_url,token_blob=excluded.token_blob,expires_at=excluded.expires_at,
      refresh_blob=excluded.refresh_blob,refresh_expires_at=excluded.refresh_expires_at`)
      .run(u.open_id, u.display_name || "", u.avatar_url || "", encrypt(token.access_token),
        Date.now() + token.expires_in * 1000, token.refresh_token ? encrypt(token.refresh_token) : null,
        token.refresh_expires_in ? Date.now() + token.refresh_expires_in * 1000 : null);
    res.redirect("/?connected=1");
  } catch (e) {
    res.status(400).send(`<p>সংযোগ সম্পন্ন হয়নি: ${String(e.message).replace(/[<>&"]/g, "")}</p><a href="/">ফিরে যান</a>`);
  }
});

app.get("/api/me", async (_req, res) => {
  try {
    const row = account();
    if (!row) return res.status(401).json({ error: "আগে TikTok সংযোগ করুন" });
    const token = await refreshIfNeeded(row);
    const data = await tiktokGet("/v2/user/info/", token, "open_id,display_name,avatar_url");
    res.json(data.user);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/api/videos", async (_req, res) => {
  try {
    const row = account();
    if (!row) return res.status(401).json({ error: "আগে TikTok সংযোগ করুন" });
    const token = await refreshIfNeeded(row);
    const url = new URL("https://open.tiktokapis.com/v2/video/list/");
    url.searchParams.set("fields", "id,title,video_description,cover_image_url,share_url,view_count,like_count,comment_count,share_count");
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ max_count: 20 })
    });
    const json = await response.json();
    if (!response.ok || json.error?.code !== "ok") throw new Error(json.error?.message || "Video API failed");
    res.json(json.data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post("/api/disconnect", (_req, res) => {
  db.prepare("DELETE FROM tiktok_accounts WHERE id=1").run();
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`LX ZISHAN SERVER running at ${BASE}`));
