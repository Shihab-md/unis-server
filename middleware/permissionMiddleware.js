import { getRequestPermissions } from "../services/permissionService.js";

const deny = (res, message = "You do not have permission to perform this action.") =>
  res.status(403).json({ success: false, error: message });

export const requirePermission = (permission, message) => async (req, res, next) => {
  try {
    const permissions = await getRequestPermissions(req);
    if (!permissions.includes(permission)) return deny(res, message);
    return next();
  } catch (error) {
    console.log("[permission] requirePermission:", error?.message || error);
    return res.status(500).json({ success: false, error: "Permission check failed." });
  }
};
