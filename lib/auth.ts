import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "crypto";
import { cookies } from "next/headers";
import { execute, row, transaction } from "@/lib/db";

export const SESSION_COOKIE = "frog_session";
const SESSION_DAYS = 30;

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  if (password.length < 8) throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
  if (bcrypt.truncates(password)) throw new Error("Le mot de passe est trop long.");
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createUser(emailInput: string, password: string, displayName: string) {
  const email = normalizeEmail(emailInput);
  if (!email || !email.includes("@")) throw new Error("Adresse e-mail invalide.");
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();

  try {
    await transaction(async (connection) => {
      await connection.execute(
        "insert into users (id,email,password_hash,email_verified) values (?,?,?,1)",
        [userId, email, passwordHash]
      );
      await connection.execute(
        "insert into user_profiles (user_id,display_name,timezone,onboarding_completed) values (?,?,?,0)",
        [userId, displayName.trim() || null, "Europe/Paris"]
      );
      await connection.execute(
        "insert into athlete_profiles (id,user_id) values (?,?)",
        [randomUUID(), userId]
      );
    });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") throw new Error("Un compte existe déjà avec cette adresse e-mail.");
    throw error;
  }

  return { id: userId, email, display_name: displayName.trim() || null };
}

export async function authenticateUser(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const user = await row<UserRow & { password_hash: string }>(
    `select u.id,u.email,u.password_hash,p.display_name
     from users u left join user_profiles p on p.user_id=u.id
     where u.email=? and u.status='active' limit 1`,
    [email]
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  return { id: user.id, email: user.email, display_name: user.display_name };
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await execute(
    "insert into sessions (id,user_id,token_hash,expires_at) values (?,?,?,?)",
    [randomUUID(), userId, tokenHash, expiresAt]
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return expiresAt;
}

export async function deleteCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await execute("delete from sessions where token_hash=?", [hashSessionToken(token)]);
  store.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(0) });
}

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await row<UserRow>(
    `select u.id,u.email,p.display_name
     from sessions s
     join users u on u.id=s.user_id and u.status='active'
     left join user_profiles p on p.user_id=u.id
     where s.token_hash=? and s.expires_at>utc_timestamp(3)
     limit 1`,
    [hashSessionToken(token)]
  );
  return user;
}

export async function purgeExpiredSessions() {
  await execute("delete from sessions where expires_at<=utc_timestamp(3)");
}
