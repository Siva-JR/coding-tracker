import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

const COST = 10;
const MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes, so longer passwords are rejected.

export const hashPassword = (password) => bcrypt.hash(password, COST);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

// Compared against when a username does not exist, so unknown users cost the same time as wrong passwords.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

export function passwordProblem(password, username) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(password) > MAX_BYTES) return 'Password must be at most 72 bytes';
  if (username && password.toLowerCase() === String(username).toLowerCase()) return 'Password must not be the same as the username';
  return null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generatePassword(length = 12) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
