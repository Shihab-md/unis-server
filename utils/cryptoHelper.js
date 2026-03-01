import crypto from "crypto";

const ALG = "aes-256-gcm";

const getKey = () => {
  const secret = process.env.INTEGRATION_ENC_SECRET;
  if (!secret) throw new Error("Missing env INTEGRATION_ENC_SECRET");
  return crypto.createHash("sha256").update(secret).digest();
};

export const encryptText = (plain) => {
  if (!plain) return "";
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);

  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
};

export const decryptText = (packed) => {
  if (!packed) return "";
  const [ivB64, tagB64, dataB64] = String(packed).split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted payload");

  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
};