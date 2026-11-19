import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM sealing for secrets at rest (module secrets, webhook signing secrets).
 * Ciphertext is bound to the tenant via AAD, so a row copied to another tenant won't decrypt.
 * Format: 0x01 | iv(12) | tag(16) | ciphertext. Key: 32 bytes (base64), from KMS/Vault in prod.
 */
export class SecretBox {
  private key: Buffer;
  constructor(keyB64: string) {
    this.key = Buffer.from(keyB64, "base64");
    if (this.key.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes base64");
  }
  seal(plaintext: string, tenantId: string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(tenantId));
    const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
  }
  open(sealed: Buffer, tenantId: string): string {
    if (sealed[0] !== 1) throw new Error("unknown secret format");
    const d = createDecipheriv("aes-256-gcm", this.key, sealed.subarray(1, 13));
    d.setAAD(Buffer.from(tenantId));
    d.setAuthTag(sealed.subarray(13, 29));
    return Buffer.concat([d.update(sealed.subarray(29)), d.final()]).toString("utf8");
  }
}
