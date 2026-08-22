import Notification from "../models/Notification.js";
import MobilePushToken from "../models/MobilePushToken.js";
import WebPushSubscription from "../models/WebPushSubscription.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const isExpoToken = (token) => /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/.test(String(token || ""));
const safePath = (value, prefix) => {
  const path = String(value || "");
  return path.startsWith(prefix) && !path.startsWith("//") ? path : null;
};

const buildPushPayload = (notification) => ({
  notificationId: String(notification._id),
  type: notification.type,
  resourceType: notification.resourceType || null,
  resourceId: notification.resourceId || null,
  webPath: safePath(notification.webPath, "/dashboard") || "/dashboard/notifications",
  mobilePath: safePath(notification.mobilePath, "/(app)") || "/(app)/notifications",
});

async function fetchWithTimeout(url, options, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function sendExpoPush(notification, tokens) {
  const usable = tokens.filter((row) => row.active && isExpoToken(row.expoPushToken));
  if (!usable.length) return;

  const data = buildPushPayload(notification);
  const messages = usable.map((row) => ({
    to: row.expoPushToken,
    sound: "default",
    title: notification.title,
    body: notification.message,
    data,
    priority: "high",
  }));

  try {
    const response = await fetchWithTimeout(EXPO_PUSH_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error(`Expo Push HTTP ${response.status}`);
    const result = await response.json().catch(() => null);
    const tickets = Array.isArray(result?.data) ? result.data : [];
    const invalidTokens = [];
    tickets.forEach((ticket, index) => {
      if (ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered" && usable[index]) {
        invalidTokens.push(usable[index].expoPushToken);
      }
    });
    if (invalidTokens.length) {
      await MobilePushToken.updateMany({ expoPushToken: { $in: invalidTokens } }, { active: false, updatedAt: new Date() });
    }
  } catch (error) {
    console.warn("[notifications] Expo Push delivery skipped/failed:", error?.message || error);
  }
}

let webPushClientPromise = null;
async function getWebPushClient() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;

  if (!webPushClientPromise) {
    webPushClientPromise = import("web-push")
      .then((mod) => {
        const client = mod.default || mod;
        client.setVapidDetails(subject, publicKey, privateKey);
        return client;
      })
      .catch((error) => {
        console.warn("[notifications] web-push package is not installed; browser push delivery is disabled:", error?.message || error);
        return null;
      });
  }
  return webPushClientPromise;
}

async function sendWebPush(notification, subscriptions) {
  const client = await getWebPushClient();
  if (!client || !subscriptions.length) return;

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.message,
    ...buildPushPayload(notification),
  });

  await Promise.allSettled(subscriptions.filter((row) => row.active).map(async (row) => {
    try {
      await client.sendNotification({ endpoint: row.endpoint, keys: row.keys }, payload, { TTL: 3600, timeout: 4500 });
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 404 || statusCode === 410) {
        await WebPushSubscription.findByIdAndUpdate(row._id, { active: false, updatedAt: new Date() });
      } else {
        console.warn("[notifications] Web Push delivery failed:", error?.message || error);
      }
    }
  }));
}

export async function getWebPushReadiness() {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  const subject = String(process.env.WEB_PUSH_VAPID_SUBJECT || "").trim();
  if (!publicKey || !privateKey || !subject) return { configured: false, publicKey: null };
  const client = await getWebPushClient();
  return { configured: Boolean(client), publicKey: client ? publicKey : null };
}

export async function dispatchNotification(notification) {
  try {
    const [tokens, subscriptions] = await Promise.all([
      MobilePushToken.find({ userId: notification.userId, active: true }).lean(),
      WebPushSubscription.find({ userId: notification.userId, active: true }).lean(),
    ]);
    await Promise.allSettled([
      sendExpoPush(notification, tokens),
      sendWebPush(notification, subscriptions),
    ]);
  } catch (error) {
    console.warn("[notifications] external delivery failed:", error?.message || error);
  }
}

export async function createUserNotification({ userId, type, title, message, resourceType = null, resourceId = null, webPath = null, mobilePath = null }) {
  if (!userId) return null;
  const notification = await Notification.create({
    userId,
    type: String(type || "system").slice(0, 80),
    title: String(title || "UNIS").slice(0, 140),
    message: String(message || "You have a new UNIS notification.").slice(0, 500),
    resourceType: resourceType ? String(resourceType).slice(0, 60) : null,
    resourceId: resourceId ? String(resourceId).slice(0, 120) : null,
    webPath: safePath(webPath, "/dashboard"),
    mobilePath: safePath(mobilePath, "/(app)"),
  });

  // The in-app notification is already durable at this point. External push is best-effort
  // and must never roll back the business operation that generated the notification.
  await dispatchNotification(notification);
  return notification;
}
