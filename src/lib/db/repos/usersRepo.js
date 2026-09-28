import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

// Trust-boundary normalization: callers pass raw user input, repo never sees un-normalized values twice.
export function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    oidcIssuer: row.oidcIssuer,
    oidcSubject: row.oidcSubject,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Strip passwordHash before this ever reaches a dashboard API response.
export function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash, oidcIssuer, oidcSubject, ...rest } = user;
  return rest;
}

export async function getUserById(id) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE id = ?`, [id]));
}

export async function getUserByUsername(username) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE username = ?`, [normalizeIdentifier(username)]));
}

export async function getUserByEmail(email) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE email = ?`, [normalizeIdentifier(email)]));
}

// Accepts either username or email as a single login identifier.
export async function getUserByIdentifier(identifier) {
  const db = await getAdapter();
  const norm = normalizeIdentifier(identifier);
  return rowToUser(db.get(`SELECT * FROM users WHERE username = ? OR email = ?`, [norm, norm]));
}

export async function getUserByOidc(issuer, subject) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE oidcIssuer = ? AND oidcSubject = ?`, [issuer, subject]));
}

export async function createUser(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    username: normalizeIdentifier(data.username),
    email: data.email ? normalizeIdentifier(data.email) : null,
    displayName: data.displayName || null,
    passwordHash: data.passwordHash || null,
    oidcIssuer: data.oidcIssuer || null,
    oidcSubject: data.oidcSubject || null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO users(id, username, email, displayName, passwordHash, oidcIssuer, oidcSubject, isActive, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.username, user.email, user.displayName, user.passwordHash, user.oidcIssuer, user.oidcSubject, 1, user.createdAt, user.updatedAt]
  );
  return user;
}

export async function updateUser(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToUser(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE users SET username = ?, email = ?, displayName = ?, passwordHash = ?, oidcIssuer = ?, oidcSubject = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
      [merged.username, merged.email, merged.displayName, merged.passwordHash, merged.oidcIssuer, merged.oidcSubject, merged.isActive ? 1 : 0, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function setPassword(id, plainPassword) {
  const passwordHash = bcrypt.hashSync(plainPassword, 10);
  return updateUser(id, { passwordHash });
}

export async function verifyPassword(user, plainPassword) {
  if (!user?.passwordHash) return false;
  return bcrypt.compare(plainPassword, user.passwordHash);
}
