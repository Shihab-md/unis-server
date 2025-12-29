import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL is not set");

const g = globalThis;

function buildClient() {
  const c = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 10_000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
    },
  });

  c.on("ready", () => console.log("[redis] ready"));
  c.on("end", () => console.warn("[redis] end"));
  c.on("error", (e) => console.error("[redis] error", e));

  return c;
}

export default async function getRedis() {
  // if missing OR closed -> create a new client
  if (!g.__redisClient || !g.__redisClient.isOpen) {
    g.__redisClient = buildClient();
    g.__redisConnectPromise = g.__redisClient
      .connect()
      .catch((err) => {
        // if connect fails, clear cache so next call can retry cleanly
        g.__redisClient = null;
        g.__redisConnectPromise = null;
        throw err;
      });
  }

  // wait until connected/ready
  await g.__redisConnectPromise;

  // extra safety: if it became closed after connect, recreate once
  if (!g.__redisClient.isOpen) {
    g.__redisClient = buildClient();
    g.__redisConnectPromise = g.__redisClient.connect();
    await g.__redisConnectPromise;
  }

  return g.__redisClient;
}
