import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL is not set");

const g = globalThis;

// Reuse client across hot reload / serverless invocations
const redisClient =
  g.__redisClient ??
  createClient({
    url: REDIS_URL, // supports redis:// and rediss:// :contentReference[oaicite:2]{index=2}
    socket: {
      connectTimeout: 25_000,
      // If you use rediss://, node-redis will use TLS.
      // (Optional) reconnect backoff:
      reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
    },
  });

redisClient.on("error", (err) => console.error("Redis Client Error:", err));
redisClient.on("ready", () => console.log("Redis ready"));

const connectPromise =
  g.__redisConnectPromise ??
  (async () => {
    if (!redisClient.isOpen) await redisClient.connect(); // basic connect pattern :contentReference[oaicite:3]{index=3}
    return redisClient;
  })();

g.__redisClient = redisClient;
g.__redisConnectPromise = connectPromise;

export async function getRedis() {
  await connectPromise;
  return redisClient;
}

export default redisClient;