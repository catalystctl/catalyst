'use strict';

const scrypt_js = require('@noble/hashes/scrypt.js');
const hex = require('./hex.cjs');

const config = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64
};
async function generateKey(password, salt) {
  return scrypt_js.scryptAsync(password.normalize("NFKC"), salt, {
    N: config.N,
    r: config.r,
    p: config.p,
    dkLen: config.dkLen,
    maxmem: 128 * config.N * config.r * 2
  });
}
async function hashPassword(password) {
  const salt = hex.hex.encode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await generateKey(password, salt);
  return `${salt}:${hex.hex.encode(key)}`;
}
async function verifyPassword(hash, password) {
  const [salt, key] = hash.split(":");
  if (!salt || !key) {
    throw new Error("Invalid password hash");
  }
  const targetKey = await generateKey(password, salt);
  return hex.hex.encode(targetKey) === key;
}

exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
