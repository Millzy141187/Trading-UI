/**
 * Local profile authentication for the start screen.
 *
 * This is a device-local convenience lock for shared machines (college
 * computers): profiles + hashed PINs live in localStorage and are never sent
 * anywhere. The real protection for a deployed instance is the server-side
 * APP_ACCESS_CODE, which is verified against the backend here.
 *
 * TradingView does not offer third-party OAuth, so "connect TradingView" is
 * tracked as a local state and drives the official sign-in flow in the
 * embedded widget — credentials are only ever entered on tradingview.com.
 */

const PROFILES_KEY = "td.v1.__profiles";
const ACTIVE_KEY = "td.v1.__active"; // sessionStorage: current session
const REMEMBER_KEY = "td.v1.__remember"; // localStorage: remembered session
const PENDING_TV_KEY = "td.v1.__pendingTv";

/* --------------------------------- storage -------------------------------- */

function readProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY)) || [];
  } catch {
    return [];
  }
}

function writeProfiles(list) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("profile write failed", err);
  }
}

export function currentProfileId() {
  return sessionStorage.getItem(ACTIVE_KEY) || localStorage.getItem(REMEMBER_KEY) || null;
}

export function getProfile(id = currentProfileId()) {
  return readProfiles().find((p) => p.id === id) || null;
}

export function getProfiles() {
  return readProfiles();
}

/* ---------------------------------- hashing ------------------------------- */

function makeSalt() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}::${pin}`);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Non-secure context (plain http): degraded hash, still a lock. The UI
  // labels PINs as a local convenience lock, not real security.
  let h = 0x811c9dc5;
  for (const byte of data) h = Math.imul(h ^ byte, 16777619) >>> 0;
  return `fnv-${h.toString(16)}`;
}

/* --------------------------------- profiles ------------------------------- */

function normalizeName(name) {
  return String(name || "").trim().slice(0, 40);
}

export async function createProfile({ name, pin = "", remember = false } = {}) {
  const trimmed = normalizeName(name);
  if (!trimmed) throw new Error("Enter a name for your profile");
  const list = readProfiles();
  if (list.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("A profile with that name already exists on this device");
  }
  const profile = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    pinSalt: null,
    pinHash: null,
    createdAt: new Date().toISOString(),
    tv: { connected: false, connectedAt: null },
  };
  if (pin) {
    profile.pinSalt = makeSalt();
    profile.pinHash = await hashPin(String(pin), profile.pinSalt);
  }
  writeProfiles([...list, profile]);
  activateProfile(profile.id, remember);
  return profile;
}

export function activateProfile(profileId, remember = false) {
  sessionStorage.setItem(ACTIVE_KEY, profileId);
  if (remember) localStorage.setItem(REMEMBER_KEY, profileId);
  else localStorage.removeItem(REMEMBER_KEY);
}

export function signOut() {
  sessionStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(REMEMBER_KEY);
}

export async function verifyPin(profile, pin) {
  if (!profile?.pinHash) return true;
  return (await hashPin(String(pin ?? ""), profile.pinSalt)) === profile.pinHash;
}

export async function setPin(profileId, pin) {
  const list = readProfiles();
  const idx = list.findIndex((p) => p.id === profileId);
  if (idx < 0) throw new Error("Profile not found");
  if (pin) {
    list[idx].pinSalt = makeSalt();
    list[idx].pinHash = await hashPin(String(pin), list[idx].pinSalt);
  } else {
    list[idx].pinSalt = null;
    list[idx].pinHash = null;
  }
  writeProfiles(list);
  return list[idx];
}

export function renameProfile(profileId, name) {
  const trimmed = normalizeName(name);
  if (!trimmed) throw new Error("Name cannot be empty");
  const list = readProfiles();
  const idx = list.findIndex((p) => p.id === profileId);
  if (idx < 0) throw new Error("Profile not found");
  list[idx].name = trimmed;
  writeProfiles(list);
  return list[idx];
}

/* ------------------------------ access code ------------------------------- */

/**
 * Verify the shared deployment access code against the backend.
 * The server answers 401 when the code is wrong/missing; anything else
 * (200, 503-not-configured) means the code passed the gate.
 */
export async function verifyAccessCode(code) {
  try {
    const res = await fetch("/api/capital/accounts", {
      headers: { "x-app-request": "trading-ui", authorization: `Bearer ${code}` },
    });
    return res.status !== 401;
  } catch {
    return false;
  }
}

/* ------------------------------- TradingView ------------------------------ */

export function markTradingViewConnected(profileId = currentProfileId()) {
  const list = readProfiles();
  const idx = list.findIndex((p) => p.id === profileId);
  if (idx < 0) return null;
  list[idx].tv = { connected: true, connectedAt: new Date().toISOString() };
  writeProfiles(list);
  return list[idx];
}

export function clearTradingView(profileId = currentProfileId()) {
  const list = readProfiles();
  const idx = list.findIndex((p) => p.id === profileId);
  if (idx < 0) return null;
  list[idx].tv = { connected: false, connectedAt: null };
  writeProfiles(list);
  return list[idx];
}

/** Flag that survives the login reload so the app can open the TV flow. */
export function queueTradingViewConnect() {
  sessionStorage.setItem(PENDING_TV_KEY, "1");
}

export function consumeTradingViewConnect() {
  const pending = sessionStorage.getItem(PENDING_TV_KEY) === "1";
  sessionStorage.removeItem(PENDING_TV_KEY);
  return pending;
}

/* ------------------------------- storage scope ---------------------------- */

/**
 * localStorage namespace for app data. Profiles get their own scope so each
 * person on a shared machine keeps their own journal/watchlist/settings.
 */
export function activeStoragePrefix() {
  const id = currentProfileId();
  return id ? `td.v1.${id}.` : "td.v1.";
}
