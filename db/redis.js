import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL is not set");

// IMPORTANT: in Vercel env vars, do NOT wrap the URL in quotes
// Also use rediss:// if your Redis Cloud endpoint requires TLS. :contentReference[oaicite:1]{index=1}

const g = globalThis;

const client =
  g.__redisClient ??
  createClient({
    url: REDIS_URL, // redis:// or rediss:// :contentReference[oaicite:2]{index=2}
    socket: {
      connectTimeout: 10_000,               // keep it reasonable
      keepAlive: true,
      keepAliveInitialDelay: 5_000,         // helps with idle disconnects
      reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
    },
  });

client.on("ready", () => console.log("[redis] ready"));
client.on("error", (e) => console.error("[redis] error", e));
client.on("end", () => console.warn("[redis] end"));

g.__redisClient = client;

export async function getRedis() {
  // Use isReady for “safe to run commands” :contentReference[oaicite:3]{index=3}
  if (!client.isReady) {
    if (!client.isOpen) {
      await client.connect();
    } else {
      // socket open but not ready (reconnecting etc.)
      // wait a bit by attempting connect again (node-redis handles idempotency)
      await client.connect();
    }
  }
  return client;
}

export default client;
