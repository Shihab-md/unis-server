import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URL;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URL is not set");
}

// Cache across warm Vercel invocations
let cached = globalThis.__mongoose;
if (!cached) {
  cached = globalThis.__mongoose = { conn: null, promise: null };
}

export default async function connectToDatabase() {
  // Already connected
  if (cached.conn) return cached.conn;

  // Create one shared connect promise
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      maxPoolSize: 5,  // keep small for serverless
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
