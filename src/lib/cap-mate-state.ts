// Capitão do Mate State Cryptography Helper - KASSINO-CKB
import crypto from "crypto";

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || "cap-mate-fallback-secret-key-32chars!";
// Generate a 32-byte key by hashing the secret
const ENCRYPTION_KEY = crypto.createHash("sha256").update(SECRET).digest();

export interface CapMateGameState {
  userId: string;
  roundId: string;
  betAmount: number;
  grid: string[]; // 36 items: 'cap-mate' | 'chimpa' | 'mico' | 'urso'
  revealed: number[]; // Array of revealed indices
  createdAt: number;
}

/**
 * Encrypts the game state object into an AES-256-CBC token
 */
export function encryptGameState(state: CapMateGameState): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(JSON.stringify(state), "utf8", "hex");
  encrypted += cipher.final("hex");
  
  // Format: iv_hex:ciphertext_hex
  return iv.toString("hex") + ":" + encrypted;
}

/**
 * Decrypts the AES-256-CBC token back to the game state object
 */
export function decryptGameState(token: string): CapMateGameState {
  const parts = token.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid state token format");
  }
  
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = parts[1];
  
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return JSON.parse(decrypted) as CapMateGameState;
}

/**
 * Generates an HMAC-SHA256 signature for the encrypted state token
 */
export function generateTokenSignature(token: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(token)
    .digest("hex");
}

/**
 * Verifies that the token and signature match in a timing-safe way
 */
export function verifyTokenSignature(token: string, signature: string): boolean {
  try {
    const expectedSignature = generateTokenSignature(token);
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (err) {
    return false;
  }
}
