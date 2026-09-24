import mongoose from "mongoose";

// Cache across warm Vercel invocations
let cached = globalThis.__mongoose;
if (!cached) {
  cached = globalThis.__mongoose = { conn: null, promise: null };
}

export default async function connectToDatabase() {
  const mongoUrl = String(process.env.MONGODB_URL || "").trim();
  if (!mongoUrl) throw new Error("MONGODB_URL is not set");

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongoUrl, {
      maxPoolSize: 5,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
