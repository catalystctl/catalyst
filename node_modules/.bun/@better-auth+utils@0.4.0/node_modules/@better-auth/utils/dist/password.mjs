import { scryptAsync } from '@noble/hashes/scrypt.js';
import { hex } from './hex.mjs';

const config = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64
};
async function generateKey(password, salt) {
  return scryptAsync(password.normalize("NFKC"), salt, {
    N: config.N,
    r: config.r,
    p: config.p,
    dkLen: config.dkLen,
    maxmem: 128 * config.N * config.r * 2
  });
}
async function hashPassword(password) {
  const salt = hex.encode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await generateKey(password, salt);
  return `${salt}:${hex.encode(key)}`;
}
async function verifyPassword(hash, password) {
  const [salt, key] = hash.split(":");
  if (!salt || !key) {
    throw new Error("Invalid password hash");
  }
  const targetKey = await generateKey(password, salt);
  return hex.encode(targetKey) === key;
}

export { hashPassword, verifyPassword };
