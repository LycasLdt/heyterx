/**
 * 用户偏好中敏感字段（如模型 apiKey）的同构加解密工具。
 *
 * 设计：
 * - 主密钥从环境变量 `NEXT_PUBLIC_MODEL_API_KEY_ENCRYPTION_KEY` 读取
 *   （前端可见，服务端可见；服务端调用 LLM 与前端编辑时共用）
 * - 用 userId 作为 HKDF salt 派生 AES-GCM 256 密钥，使每用户密钥互不相同
 * - 加密输出 `base64(iv(12B) || ciphertext || tag(16B))`
 *
 * 数据库 jsonb 中存储密文字符串，前端 GET 拿到密文后自行解密显示，
 * 编辑保存时前端再加密后通过 PATCH 上送，全程 DB 不存明文 apiKey。
 *
 * 注意：master key 暴露在前端 JS 中，因此本方案主要防御 DB 泄露场景
 * （DBA / 备份泄露 / SQL 注入），不防御具备前端访问权限的攻击者。
 */

const MASTER_KEY_ENV = "NEXT_PUBLIC_MODEL_API_KEY_ENCRYPTION_KEY";

function getMasterKey(): string {
  const key = process.env.NEXT_PUBLIC_MODEL_API_KEY_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "缺少环境变量 NEXT_PUBLIC_MODEL_API_KEY_ENCRYPTION_KEY，请在 .env 中配置 32+ 字符随机串",
    );
  }
  return key;
}

/** 把字符串编码为 Uint8Array（UTF-8） */
function encodeStr(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Uint8Array → base64 字符串 */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 字符串 → Uint8Array */
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 全局 btoa/atob 兼容（浏览器与 Node 18+ 都有 globalThis.btoa/atob） */
declare const btoa: (s: string) => string;
declare const atob: (s: string) => string;

/**
 * 派生用户密钥。相同 userId + masterKey 总是派生出相同 CryptoKey。
 * 用 HKDF-SHA256，info 固定字符串，salt 用 userId。
 */
async function deriveUserKey(userId: string): Promise<CryptoKey> {
  const masterKey = getMasterKey();
  // 用主密钥的 UTF-8 字节作为 HKDF 的 IKM，userId 作为 salt
  // 注意：TS 6 下 TextEncoder().encode() 返回 Uint8Array<ArrayBufferLike>，
  // 不能直接作为 BufferSource 传给 subtle.crypto，故用 as BufferSource 强转
  const masterKeyBytes = encodeStr(masterKey) as unknown as BufferSource;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    masterKeyBytes,
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encodeStr(userId) as unknown as BufferSource,
      info: encodeStr("heyterx:model-api-key:v1") as unknown as BufferSource,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** AES-GCM 加密；输出 "enc:" + base64(iv || ciphertext) */
export async function encryptForUser(
  plaintext: string,
  userId: string,
): Promise<string> {
  const key = await deriveUserKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      encodeStr(plaintext) as unknown as BufferSource,
    ),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return "enc:" + toBase64(combined);
}

/**
 * AES-GCM 解密；输入 base64(iv || ciphertext)。
 * 输入为空字符串或非密文格式时直接返回原值（兼容旧明文数据迁移期间使用）。
 */
export async function decryptForUser(
  ciphertext: string,
  userId: string,
): Promise<string> {
  if (!ciphertext) return "";
  // 兼容未加密的旧数据：如果以 "enc:" 前缀开头才视为密文
  if (!ciphertext.startsWith("enc:")) return ciphertext;
  const b64 = ciphertext.slice(4);
  const key = await deriveUserKey(userId);
  const combined = fromBase64(b64);
  if (combined.length < 13) return "";
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ct as unknown as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

/** 判断字符串是否已是加密格式（以 "enc:" 前缀开头） */
export function isEncrypted(s: string): boolean {
  return typeof s === "string" && s.startsWith("enc:");
}
