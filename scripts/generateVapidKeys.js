import crypto from "crypto";

// Generates a Web Push VAPID P-256 key pair without persisting or uploading it anywhere.
// Run once, then store the values only in your deployment environment secrets.
const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
const publicKey = ecdh.getPublicKey().toString("base64url");
const privateKey = ecdh.getPrivateKey().toString("base64url");
console.log(JSON.stringify({ publicKey, privateKey }, null, 2));
