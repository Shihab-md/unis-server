import AuditLog from "../models/AuditLog.js";

const safeString = (value, max = 300) => {
  const text = value === undefined || value === null ? "" : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

// Delays the JSON response only long enough to persist a compact audit entry.
// It intentionally does NOT store req.body, names, addresses, phone numbers, or other submitted PII.
export const auditMutation = ({ action, resourceType, resourceIdParam = "id" }) => (req, res, next) => {
  const originalJson = res.json.bind(res);
  let written = false;

  res.json = (payload) => {
    if (written) return originalJson(payload);
    written = true;

    const statusCode = Number(res.statusCode || 200);
    const success = statusCode < 400 && payload?.success !== false;
    const resourceId =
      payload?.studentId ||
      payload?.employeeMongoId ||
      payload?.employeeId ||
      payload?.resourceId ||
      req.params?.[resourceIdParam] ||
      req.authorizedStudent?._id ||
      req.authorizedEmployee?._id ||
      null;
    const schoolId = req.body?.schoolId || req.authorizedStudent?.schoolId || req.authorizedEmployee?.schoolId || null;

    return AuditLog.create({
      userId: req.user?._id || null,
      role: safeString(req.user?.role, 60),
      action,
      resourceType,
      resourceId: resourceId ? safeString(resourceId, 100) : null,
      schoolId: schoolId || null,
      method: safeString(req.method, 16),
      path: safeString(req.originalUrl || req.path, 300),
      statusCode,
      success,
      message: safeString(payload?.message || payload?.error || "", 300),
    })
      .catch((error) => {
        // Audit persistence must be visible in server logs but should not convert a successful
        // business transaction into a failed client response after the write already committed.
        console.error("[audit] failed to persist mutation audit:", error?.message || error);
      })
      .then(() => originalJson(payload));
  };

  next();
};
