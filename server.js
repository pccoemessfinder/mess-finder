// server.js - serves the website (public/) and the API, stores data in MongoDB.
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const {
  MONGODB_URI,
  MONGODB_DB = "messfinder",
  JWT_SECRET,
  ADMIN_USERNAME = "mayuresh",
  ADMIN_PASSWORD,
  PORT = 3000
} = process.env;

if (!MONGODB_URI || !JWT_SECRET || !ADMIN_PASSWORD) {
  console.error(
    "Missing environment variables. Set MONGODB_URI, JWT_SECRET and ADMIN_PASSWORD (see .env.example)."
  );
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy (needed for rate limiting by IP)
app.use(express.json({ limit: "6mb" })); // owner photos are sent as base64

// ---------- helpers ----------

const str = (v) => (typeof v === "string" ? v : "");
const clip = (v, max) => str(v).trim().slice(0, max);

// Only allow http(s) links so nobody can store javascript: URLs in href/src
function safeUrl(v, max = 2000) {
  const s = clip(v, max);
  return /^https?:\/\//i.test(s) ? s : "";
}

function safePhoto(v) {
  const s = str(v);
  if (!s) return "";
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s) && s.length <= 4_000_000) return s;
  if (/^https?:\/\//i.test(s) && s.length <= 2000) return s;
  return null; // invalid
}

const cleanKey = (k) => {
  const key = str(k).trim().toLowerCase();
  return /^[a-z0-9_+\-]{1,200}$/.test(key) ? key : null;
};

const emailToKey = (email) => str(email).trim().toLowerCase().replace(/[.@]/g, "_");

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(v).trim());

function sign(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

function getUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(str(a)).digest();
  const hb = crypto.createHash("sha256").update(str(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// What the public is allowed to see about a mess (never passwords or email)
function publicMess(doc) {
  const { _id, ownerPasswordHash, ownerPassword, ownerEmail, ...rest } = doc;
  return rest;
}

// Editable fields (text fields clipped, links/photo validated)
function pickFields(body) {
  const out = {};
  if ("name" in body) out.name = clip(body.name, 120);
  if ("location" in body) out.location = clip(body.location, 200);
  if ("price" in body) out.price = clip(body.price, 60);
  if ("type" in body) out.type = clip(body.type, 30);
  if ("menu" in body) out.menu = clip(body.menu, 5000);
  if ("contactNumber" in body) out.contactNumber = clip(body.contactNumber, 30);
  if ("openTime" in body) out.openTime = clip(body.openTime, 20);
  if ("closeTime" in body) out.closeTime = clip(body.closeTime, 20);
  if ("whatsappLink" in body) out.whatsappLink = safeUrl(body.whatsappLink);
  if ("mapLink" in body) out.mapLink = safeUrl(body.mapLink);
  if ("photo" in body) out.photo = safePhoto(body.photo); // null = invalid
  return out;
}

// ---------- rate limits ----------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  message: { error: "Too many attempts. Try again in a few minutes." }
});
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: "Too many messages. Try again later." }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  skip: (req) => !!getUser(req), // only anonymous sign-ups are limited; logged-in owners/admin are not
  message: { error: "Too many registrations from this connection." }
});
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: { error: "Too many ratings from this connection. Try again later." }
});

// ---------- start ----------

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const database = client.db(MONGODB_DB);
  const messes = database.collection("messes");
  const contacts = database.collection("contacts");
  const suggestions = database.collection("suggestions");

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // ----- login (admin and mess owners) -----
  app.post("/api/login", loginLimiter, async (req, res) => {
    const username = clip(req.body?.username ?? req.body?.email, 200);
    const password = str(req.body?.password).trim();
    if (!username || !password) {
      return res.status(400).json({ error: "Please enter your username and password." });
    }

    if (username === ADMIN_USERNAME) {
      if (!safeEqual(password, ADMIN_PASSWORD)) {
        return res.status(401).json({ error: "Invalid Username or Password" });
      }
      return res.json({ role: "admin", token: sign({ role: "admin" }) });
    }

    const key = emailToKey(username);
    const doc = cleanKey(key) ? await messes.findOne({ _id: key }) : null;
    const ok = doc?.ownerPasswordHash && (await bcrypt.compare(password, doc.ownerPasswordHash));
    if (!ok) return res.status(401).json({ error: "Invalid Username or Password" });

    res.json({
      role: "owner",
      email: doc.ownerEmail,
      token: sign({ role: "owner", key })
    });
  });

  // ----- messes -----
  // All messes (public). Returned as an object keyed by id, like the old Firebase data.
  app.get("/api/messes", async (_req, res) => {
    const docs = await messes.find({}).toArray();
    const out = {};
    for (const d of docs) out[d._id] = publicMess(d);
    res.json(out);
  });

  app.get("/api/messes/:key", async (req, res) => {
    const key = cleanKey(req.params.key);
    const doc = key ? await messes.findOne({ _id: key }) : null;
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(publicMess(doc));
  });

  // Create (owner registration or admin add) or update (owner of that mess, or admin)
  app.put("/api/messes/:key", registerLimiter, async (req, res) => {
    const key = cleanKey(req.params.key);
    const body = req.body;
    if (!key || !body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid request." });
    }

    const user = getUser(req);
    const isAdmin = user?.role === "admin";
    const existing = await messes.findOne({ _id: key });
    const fields = pickFields(body);
    if (fields.photo === null) {
      return res.status(400).json({ error: "Photo must be a PNG/JPG/WEBP image under about 3 MB." });
    }

    if (!existing) {
      // ---- create ----
      const email = clip(body.ownerEmail, 200).toLowerCase();
      if (!isEmail(email) || emailToKey(email) !== key) {
        return res.status(400).json({ error: "Please enter a valid owner email." });
      }
      if (!fields.name) return res.status(400).json({ error: "Please enter the mess name." });

      const password = str(body.ownerPassword);
      if (!isAdmin && password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters." });
      }

      await messes.insertOne({
        _id: key,
        name: "",
        location: "",
        price: "",
        type: "",
        menu: "",
        photo: "",
        contactNumber: "",
        whatsappLink: "",
        mapLink: "",
        openTime: "",
        closeTime: "",
        reviews: [],
        ...fields,
        ownerEmail: email,
        ownerPasswordHash: password ? await bcrypt.hash(password, 10) : "",
        createdAt: new Date()
      });
      return res.status(201).json({ ok: true });
    }

    // ---- update ----
    const isOwner = user?.role === "owner" && user.key === key;
    if (!isAdmin && !isOwner) {
      return res.status(401).json({ error: "Please log in again." });
    }

    const update = { ...fields, updatedAt: new Date() };
    if (isAdmin) {
      // only the admin can change the owner's password
      const password = str(body.ownerPassword);
      if (password) update.ownerPasswordHash = await bcrypt.hash(password, 10);
    }
    await messes.updateOne({ _id: key }, { $set: update });
    res.json({ ok: true });
  });

  // Admin-only list: includes owner email (never the password hash) so the dashboard can show/edit everything
  app.get("/api/admin/messes", async (req, res) => {
    if (getUser(req)?.role !== "admin") {
      return res.status(401).json({ error: "Admin login required." });
    }
    const docs = await messes.find({}, { projection: { photo: 0 } }).sort({ createdAt: 1 }).toArray();
    res.json(
      docs.map(({ _id, ownerPasswordHash, ownerPassword, ...rest }) => ({
        ...rest,
        key: _id,
        hasPassword: !!ownerPasswordHash
      }))
    );
  });

  // Anyone can rate a mess (1-5, optional short comment); owners see these on their dashboard
  app.post("/api/messes/:key/reviews", reviewLimiter, async (req, res) => {
    const key = cleanKey(req.params.key);
    const rating = Math.round(Number(req.body?.rating));
    if (!key || !(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: "Please choose a rating from 1 to 5." });
    }
    const comment = clip(req.body?.comment, 500);
    const result = await messes.updateOne(
      { _id: key },
      { $push: { reviews: { $each: [{ rating, comment, createdAt: new Date() }], $slice: -500 } } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Mess not found." });
    res.json({ ok: true });
  });

  app.delete("/api/messes/:key", async (req, res) => {
    if (getUser(req)?.role !== "admin") {
      return res.status(401).json({ error: "Admin login required." });
    }
    const key = cleanKey(req.params.key);
    if (!key) return res.status(400).json({ error: "Invalid request." });
    await messes.deleteOne({ _id: key });
    res.json({ ok: true });
  });

  // ----- contact form and suggestions -----
  app.post("/api/contact", formLimiter, async (req, res) => {
    const name = clip(req.body?.name, 100);
    const email = clip(req.body?.email, 200);
    const message = clip(req.body?.message, 3000);
    if (!name || !isEmail(email) || !message) {
      return res.status(400).json({ error: "Please enter your name, a valid email and a message." });
    }
    await contacts.insertOne({ name, email, message, createdAt: new Date() });
    res.json({ ok: true });
  });

  app.post("/api/suggestion", formLimiter, async (req, res) => {
    const suggestion = clip(req.body?.suggestion, 3000);
    if (!suggestion) return res.status(400).json({ error: "Please write your suggestion." });
    await suggestions.insertOne({ suggestion, createdAt: new Date() });
    res.json({ ok: true });
  });

  // ----- website -----
  // Serve the website from ./public. If the files were uploaded flat (next to server.js),
  // serve them from the project root, but only website file types - never server code.
  const publicDir = fs.existsSync(path.join(__dirname, "public", "index.html"))
    ? path.join(__dirname, "public")
    : __dirname;
  if (publicDir === __dirname) {
    const siteFile = /\.(html|css|jpe?g|png|gif|webp|svg|ico)$/i;
    app.use((req, res, next) => {
      let p = "/";
      try { p = decodeURIComponent(req.path); } catch (e) { /* ignore */ }
      if (p === "/" || p.toLowerCase() === "/db.js" || siteFile.test(p)) return next();
      res.status(404).send("Not found");
    });
  }
  app.use(express.static(publicDir, { dotfiles: "ignore" }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.status === 413 ? "Photo is too large." : "Server error" });
  });

  app.listen(PORT, () => console.log("Mess Finder running on port " + PORT));
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
