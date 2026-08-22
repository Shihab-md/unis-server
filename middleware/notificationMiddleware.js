import { createUserNotification } from "../services/notificationService.js";

const valueOf = (source, req, payload) => typeof source === "function" ? source(req, payload) : source;

const defaultResourceId = (req, payload) =>
  payload?.studentId ||
  payload?.employeeMongoId ||
  payload?.certificateId ||
  payload?.resourceId ||
  req.authorizedStudent?._id ||
  req.authorizedEmployee?._id ||
  req.authorizedCertificate?._id ||
  req.params?.id ||
  null;

export const notifyOnSuccess = ({ type, title, message, resourceType, resourceId, webPath, mobilePath }) => (req, res, next) => {
  const originalJson = res.json.bind(res);
  let handled = false;

  res.json = async (payload) => {
    if (handled) return originalJson(payload);
    handled = true;
    const statusCode = Number(res.statusCode || 200);
    const success = statusCode < 400 && payload?.success !== false;

    if (success && req.user?._id) {
      try {
        const resolvedResourceId = valueOf(resourceId, req, payload) || defaultResourceId(req, payload);
        await createUserNotification({
          userId: req.user._id,
          type: valueOf(type, req, payload),
          title: valueOf(title, req, payload),
          message: valueOf(message, req, payload),
          resourceType: valueOf(resourceType, req, payload),
          resourceId: resolvedResourceId,
          webPath: valueOf(webPath, req, { ...payload, resourceId: resolvedResourceId }),
          mobilePath: valueOf(mobilePath, req, { ...payload, resourceId: resolvedResourceId }),
        });
      } catch (error) {
        console.warn("[notifications] unable to persist operation notification:", error?.message || error);
      }
    }
    return originalJson(payload);
  };

  next();
};
