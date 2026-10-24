// server.js - serves the website (public/) and the API, stores data in MongoDB.
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
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

// WhatsApp number: digits only. A 10-digit Indian number gets the 91 country code.
// Returns "" (empty), a digit string, or null (invalid).
function cleanWhatsapp(v) {
  const raw = str(v).trim();
  if (!raw) return "";
  let d = raw.replace(/[\s\-()+]/g, "");
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 10) d = "91" + d;
  else if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : null;
}

// Map location: a normal http(s) link, OR "latitude, longitude" (turned into a Google Maps link).
// Returns "" (empty), a link, or null (invalid).
function cleanMapLocation(v) {
  const s = clip(v, 2000);
  if (!s) return "";
  const m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return "https://www.google.com/maps?q=" + lat + "," + lng;
    }
    return null;
  }
  return /^https?:\/\//i.test(s) ? s : null;
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
  if (Array.isArray(rest.reviews)) {
    // never expose the anonymous voter ids
    rest.reviews = rest.reviews.map(({ voterId, ...r }) => r);
  }
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
  if ("todaySpecial" in body) out.todaySpecial = clip(body.todaySpecial, 500);
  if ("contactNumber" in body) out.contactNumber = clip(body.contactNumber, 30);
  if ("openTime" in body) out.openTime = clip(body.openTime, 20);
  if ("closeTime" in body) out.closeTime = clip(body.closeTime, 20);
  if ("whatsappNumber" in body) out.whatsappNumber = cleanWhatsapp(body.whatsappNumber); // null = invalid
  if ("mapLink" in body) out.mapLink = cleanMapLocation(body.mapLink); // null = invalid
  if ("photo" in body) out.photo = safePhoto(body.photo); // null = invalid
  return out;
}

// ---------- email notifications (contact form + suggestions) ----------
// Uses Resend's web API (Render's free plan blocks normal SMTP/Gmail ports).
// Needs RESEND_API_KEY in Render's Environment tab. MAIL_TO defaults to the Mess Finder inbox.
const MAIL_TO = process.env.MAIL_TO || "messfinderpccoe@gmail.com";
const MAIL_FROM = process.env.MAIL_FROM || "Mess Finder <onboarding@resend.dev>";

function sendMail(subject, text, replyTo) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("Email not sent: RESEND_API_KEY is not set.");
    return;
  }
  const payload = {
    from: MAIL_FROM,
    to: [MAIL_TO],
    subject: String(subject).replace(/[\r\n]+/g, " ").slice(0, 200),
    text: String(text).slice(0, 10000)
  };
  if (replyTo) payload.reply_to = replyTo;

  // fire and forget: a failed email must never stop the message from being saved
  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  })
    .then(async (r) => {
      if (!r.ok) console.error("Email failed:", r.status, (await r.text()).slice(0, 300));
    })
    .catch((err) => console.error("Email failed:", err.message));
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
const siteReviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: { error: "Too many reviews from this connection. Try again later." }
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
  const siteReviews = database.collection("siteReviews");

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
  // ?basic=1 leaves out photos/menus/reviews (the home page only needs name, type and price)
  app.get("/api/messes", async (req, res) => {
    const docs = await messes
      .find({}, req.query.basic ? { projection: { photo: 0, menu: 0, reviews: 0 } } : {})
      .toArray();
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
    if (fields.whatsappNumber === null) {
      return res.status(400).json({ error: "Please enter a valid WhatsApp number (10 digits, or with country code)." });
    }
    if (fields.mapLink === null) {
      return res.status(400).json({ error: "Map location must be a Google Maps link (https://...) or latitude, longitude (e.g. 18.65, 73.77)." });
    }
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
        whatsappNumber: "",
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

  // Anyone can rate a mess (1-5, optional short comment); owners see these on their dashboard.
  // Each visitor has an anonymous voterId, so rating again CHANGES their rating instead of adding another.
  const voterOk = (v) => typeof v === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(v);
  const summary = (reviews) => {
    const list = Array.isArray(reviews) ? reviews : [];
    const total = list.reduce((s, r) => s + Number(r.rating || 0), 0);
    return { count: list.length, average: list.length ? Math.round((total / list.length) * 10) / 10 : 0 };
  };

  app.post("/api/messes/:key/reviews", reviewLimiter, async (req, res) => {
    const key = cleanKey(req.params.key);
    const rating = Math.round(Number(req.body?.rating));
    if (!key || !(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: "Please choose a rating from 1 to 5." });
    }
    const comment = clip(req.body?.comment, 500);
    const voterId = voterOk(req.body?.voterId) ? req.body.voterId : null;

    let matched = 0;
    if (voterId) {
      const r = await messes.updateOne(
        { _id: key, "reviews.voterId": voterId },
        { $set: { "reviews.$.rating": rating, "reviews.$.updatedAt": new Date() } }
      );
      matched = r.matchedCount;
    }
    if (!matched) {
      const entry = { rating, comment, createdAt: new Date() };
      if (voterId) entry.voterId = voterId;
      const r = await messes.updateOne(
        { _id: key },
        { $push: { reviews: { $each: [entry], $slice: -500 } } }
      );
      if (!r.matchedCount) return res.status(404).json({ error: "Mess not found." });
    }
    const doc = await messes.findOne({ _id: key }, { projection: { reviews: 1 } });
    res.json({ ok: true, ...summary(doc?.reviews) });
  });

  // Ratings for the built-in messes written in messes.html (they are not in the messes collection).
  // Stored as { _id: slug, votes: { voterId: rating } } so each visitor counts once.
  const ratingsCol = database.collection("ratings");
  const slugOk = (v) => typeof v === "string" && /^[a-z0-9_]{1,80}$/.test(v);

  app.get("/api/ratings", async (_req, res) => {
    const docs = await ratingsCol.find({}).toArray();
    const out = {};
    for (const d of docs) {
      const votes = Object.values(d.votes || {}).map((n) => Number(n)).filter((n) => n >= 1 && n <= 5);
      if (!votes.length) continue;
      out[d._id] = {
        count: votes.length,
        average: Math.round((votes.reduce((a, b) => a + b, 0) / votes.length) * 10) / 10
      };
    }
    res.json(out);
  });

  app.post("/api/ratings/:slug", reviewLimiter, async (req, res) => {
    const slug = req.params.slug;
    const rating = Math.round(Number(req.body?.rating));
    if (!slugOk(slug) || !(rating >= 1 && rating <= 5) || !voterOk(req.body?.voterId)) {
      return res.status(400).json({ error: "Please choose a rating from 1 to 5." });
    }
    await ratingsCol.updateOne(
      { _id: slug },
      { $set: { ["votes." + req.body.voterId]: rating } },
      { upsert: true }
    );
    const d = await ratingsCol.findOne({ _id: slug });
    const votes = Object.values(d?.votes || {}).map(Number);
    res.json({
      ok: true,
      count: votes.length,
      average: Math.round((votes.reduce((a, b) => a + b, 0) / votes.length) * 10) / 10
    });
  });

  // Owner deletes their OWN mess; they must type their password again to confirm.
  app.post("/api/owner/delete-mess", loginLimiter, async (req, res) => {
    const user = getUser(req);
    if (user?.role !== "owner" || !cleanKey(user.key)) {
      return res.status(401).json({ error: "Please log in again." });
    }
    const password = str(req.body?.password).trim();
    if (!password) return res.status(400).json({ error: "Please enter your password." });
    const doc = await messes.findOne({ _id: user.key });
    if (!doc) return res.status(404).json({ error: "Mess not found." });
    if (!doc.ownerPasswordHash) {
      return res.status(400).json({ error: "This account has no password set. Please ask the admin to delete it." });
    }
    if (!(await bcrypt.compare(password, doc.ownerPasswordHash))) {
      return res.status(401).json({ error: "Wrong password." });
    }
    await messes.deleteOne({ _id: user.key });
    res.json({ ok: true });
  });

  // ----- admin inbox: suggestions and contact messages (newest first) -----
  const adminOnly = (req, res) => {
    if (getUser(req)?.role !== "admin") {
      res.status(401).json({ error: "Admin login required." });
      return false;
    }
    return true;
  };

  app.get("/api/admin/suggestions", async (req, res) => {
    if (!adminOnly(req, res)) return;
    const docs = await suggestions.find({}).sort({ createdAt: -1 }).limit(300).toArray();
    res.json(docs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })));
  });

  app.get("/api/admin/contacts", async (req, res) => {
    if (!adminOnly(req, res)) return;
    const docs = await contacts.find({}).sort({ createdAt: -1 }).limit(300).toArray();
    res.json(docs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })));
  });

  app.delete("/api/admin/suggestions/:id", async (req, res) => {
    if (!adminOnly(req, res)) return;
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid request." });
    await suggestions.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  });

  app.delete("/api/admin/contacts/:id", async (req, res) => {
    if (!adminOnly(req, res)) return;
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid request." });
    await contacts.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  });

  // ----- student reviews of the website (shown on the home page) -----
  app.get("/api/site-reviews", async (_req, res) => {
    const docs = await siteReviews.find({}).sort({ createdAt: -1 }).limit(100).toArray();
    res.json(docs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })));
  });

  app.post("/api/site-reviews", siteReviewLimiter, async (req, res) => {
    const name = clip(req.body?.name, 60);
    const rating = Math.round(Number(req.body?.rating));
    const comment = clip(req.body?.comment, 500);
    if (!name || !comment || !(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: "Please enter your name, a rating and a short review." });
    }
    await siteReviews.insertOne({ name, rating, comment, createdAt: new Date() });
    res.json({ ok: true });
  });

  app.delete("/api/admin/site-reviews/:id", async (req, res) => {
    if (!adminOnly(req, res)) return;
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid request." });
    await siteReviews.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  });

  // clear every suggestion / every contact message
  app.delete("/api/admin/suggestions", async (req, res) => {
    if (!adminOnly(req, res)) return;
    await suggestions.deleteMany({});
    res.json({ ok: true });
  });

  app.delete("/api/admin/contacts", async (req, res) => {
    if (!adminOnly(req, res)) return;
    await contacts.deleteMany({});
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
    sendMail(
      "Mess Finder - new contact message from " + name,
      "Name: " + name + "\nEmail: " + email + "\n\nMessage:\n" + message,
      email
    );
    res.json({ ok: true });
  });

  app.post("/api/suggestion", formLimiter, async (req, res) => {
    const suggestion = clip(req.body?.suggestion, 3000);
    if (!suggestion) return res.status(400).json({ error: "Please write your suggestion." });
    await suggestions.insertOne({ suggestion, createdAt: new Date() });
    sendMail("Mess Finder - new suggestion", "New suggestion:\n\n" + suggestion);
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
