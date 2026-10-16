// db.js - replaces the missing firebase.js.
// Same exports the pages already use (db, ref, get, set), but the data now
// lives in MongoDB behind the Express API in server.js (hosted on Render).

const API = "/api"; // same origin: Render serves both the site and the API

export const db = {};

export function ref(_db, path) {
  return { path: String(path || "").replace(/^\/+|\/+$/g, "") };
}

function authHeaders() {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: "Bearer " + token } : {};
}

function snapshot(value) {
  return {
    exists: () => value !== null && value !== undefined,
    val: () => value
  };
}

// get(ref(db, "messes"))        -> object of all messes, keyed by owner key
// get(ref(db, "messes/<key>"))  -> one mess (never includes the password)
export async function get(r) {
  const parts = r.path.split("/");
  if (parts[0] !== "messes") throw new Error("Unsupported path: " + r.path);

  if (parts.length === 1) {
    const res = await fetch(API + "/messes");
    if (!res.ok) throw new Error("Could not load messes");
    const data = await res.json();
    return snapshot(Object.keys(data).length ? data : null);
  }

  const res = await fetch(API + "/messes/" + encodeURIComponent(parts[1]));
  if (res.status === 404) return snapshot(null);
  if (!res.ok) throw new Error("Could not load mess");
  return snapshot(await res.json());
}

// set(ref(db, "messes/<key>"), value) -> create / replace
// set(ref(db, "messes/<key>"), null)  -> delete (admin only)
export async function set(r, value) {
  const parts = r.path.split("/");
  if (parts[0] !== "messes" || parts.length !== 2) {
    throw new Error("Unsupported path: " + r.path);
  }
  const url = API + "/messes/" + encodeURIComponent(parts[1]);

  const res =
    value === null || value === undefined
      ? await fetch(url, { method: "DELETE", headers: authHeaders() })
      : await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(value)
        });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Request failed (" + res.status + ")");
  }
}
