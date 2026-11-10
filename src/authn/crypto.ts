const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashPassword(password: string, iterations = 210_000): Promise<string> {
  if (password.length < 10) throw new Error("password must be at least 10 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, rawIterations, rawSalt, expected] = encoded.split("$");
  const iterations = Number(rawIterations);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || !rawSalt || !expected) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(rawSalt).buffer as ArrayBuffer, iterations },
    key,
    256,
  ));
  const expectedBytes = base64UrlToBytes(expected);
  if (bits.length !== expectedBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < bits.length; index += 1) mismatch |= bits[index]! ^ expectedBytes[index]!;
  return mismatch === 0;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) {
    result += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function decodeBase32(value: string): Uint8Array {
  let bits = "";
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
}

export async function generateTotp(secret: string, atMs = Date.now(), stepSeconds = 30): Promise<string> {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(secret).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = signature[signature.length - 1]! & 0x0f;
  const code = (
    ((signature[offset]! & 0x7f) << 24) |
    ((signature[offset + 1]! & 0xff) << 16) |
    ((signature[offset + 2]! & 0xff) << 8) |
    (signature[offset + 3]! & 0xff)
  ) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export async function verifyTotp(secret: string, code: string, atMs = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  for (const offset of [-30_000, 0, 30_000]) {
    if ((await generateTotp(secret, atMs + offset)) === code) return true;
  }
  return false;
}
