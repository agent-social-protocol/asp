import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

export interface ASPKeyPair {
  publicKey: string;   // "ed25519:<base64 DER>"
  privateKey: string;  // PEM format
}

export interface EncryptionKeyPair {
  publicKey: string;   // "x25519:<base64 SPKI DER>"
  privateKey: string;  // PEM format (PKCS8)
}

export interface EncryptedPayload {
  v: 1;
  eph: string;        // ephemeral X25519 public key, SPKI DER base64
  nonce: string;       // 12-byte IV, base64
  ciphertext: string;  // AES-256-GCM ciphertext, base64
  tag: string;         // 16-byte auth tag, base64
}

/**
 * Generate an Ed25519 key pair for ASP identity.
 * Returns publicKey in ASP format ("ed25519:<base64>") and privateKey as PEM.
 */
export function generateKeyPair(): ASPKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return {
    publicKey: `ed25519:${pubDer.toString('base64')}`,
    privateKey: privPem,
  };
}

/**
 * Generate an X25519 key pair for encryption (ECIES DMs).
 * Returns publicKey in ASP format ("x25519:<base64>") and privateKey as PEM.
 */
export function generateEncryptionKeyPair(): EncryptionKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return {
    publicKey: `x25519:${pubDer.toString('base64')}`,
    privateKey: privPem,
  };
}

/**
 * Sign a payload with an Ed25519 private key (PEM format).
 * Returns base64-encoded signature.
 */
export function signPayload(payload: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(payload), key);
  return signature.toString('base64');
}

/**
 * Verify a base64 Ed25519 signature against an ASP public key
 * ("ed25519:<base64 SPKI DER>").
 */
export function verifyPayload(payload: string, signatureB64: string, publicKey: string): boolean {
  if (!publicKey.startsWith('ed25519:')) {
    throw new Error('Unsupported public key format');
  }
  const der = Buffer.from(publicKey.replace('ed25519:', ''), 'base64');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  return verify(null, Buffer.from(payload), key, Buffer.from(signatureB64, 'base64'));
}

/**
 * ECIES encrypt: encrypt plaintext for a recipient's X25519 public key.
 * Uses ephemeral ECDH + HKDF-SHA256 + AES-256-GCM.
 *
 * @param plaintext - UTF-8 string to encrypt
 * @param recipientX25519PubKey - recipient's public key in "x25519:<base64 SPKI DER>" format
 * @returns EncryptedPayload with all fields base64-encoded
 */
export function eciesEncrypt(
  plaintext: string,
  recipientX25519PubKey: string,
): EncryptedPayload {
  // 1. Generate ephemeral X25519 key pair
  const eph = generateKeyPairSync('x25519');
  const ephPubDer = eph.publicKey.export({ type: 'spki', format: 'der' });

  // 2. Parse recipient public key (strip "x25519:" prefix)
  const recipientDer = Buffer.from(recipientX25519PubKey.replace('x25519:', ''), 'base64');
  const recipientKey = createPublicKey({ key: recipientDer, format: 'der', type: 'spki' });

  // 3. ECDH: derive shared secret
  const shared = diffieHellman({ publicKey: recipientKey, privateKey: eph.privateKey });

  // 4. HKDF: derive AES key (hkdfSync returns ArrayBuffer)
  const derivedKey = Buffer.from(
    hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('asp-dm-v1'), 32),
  );

  // 5. AES-256-GCM encrypt
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 6. Return payload
  return {
    v: 1,
    eph: ephPubDer.toString('base64'),
    nonce: nonce.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * ECIES decrypt: decrypt an EncryptedPayload with a local X25519 private key.
 * Reverses the eciesEncrypt flow.
 *
 * @param payload - EncryptedPayload from eciesEncrypt
 * @param localX25519PrivKeyPem - recipient's private key in PEM (PKCS8) format
 * @returns decrypted plaintext as UTF-8 string
 */
export function eciesDecrypt(
  payload: EncryptedPayload,
  localX25519PrivKeyPem: string,
): string {
  if (payload.v !== 1) throw new Error(`Unsupported encryption version: ${payload.v}`);

  // 1. Parse ephemeral public key from DER
  const ephPub = createPublicKey({
    key: Buffer.from(payload.eph, 'base64'),
    format: 'der',
    type: 'spki',
  });

  // 2. Parse own private key
  const privKey = createPrivateKey(localX25519PrivKeyPem);

  // 3. ECDH: derive shared secret
  const shared = diffieHellman({ publicKey: ephPub, privateKey: privKey });

  // 4. HKDF: derive AES key (same parameters as encrypt)
  const derivedKey = Buffer.from(
    hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('asp-dm-v1'), 32),
  );

  // 5. AES-256-GCM decrypt
  const nonce = Buffer.from(payload.nonce, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', derivedKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}
