import jwt from 'jsonwebtoken'
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import { HQ_EMPLOYEE_ROLE_SET, normalizeRole } from '../config/rolePolicy.js';
import { ORGANIZATION_TYPES } from '../config/organizationPolicy.js';

const sendUnauthorized = (res, code, error) => {
    return res.status(401).json({
        success: false,
        code,
        error,
    });
};

const verifyUser = async (req, res, next) => {
    try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

        if (!token) {
            return sendUnauthorized(res, "TOKEN_NOT_PROVIDED", "Session expired. Please login again.");
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded?._id) {
            return sendUnauthorized(res, "INVALID_TOKEN", "Session expired. Please login again.");
        }

        const user = await User.findById({ _id: decoded._id }).select('-password');

        if (!user) {
            return sendUnauthorized(res, "USER_NOT_FOUND", "Session expired. Please login again.");
        }

        const role = normalizeRole(user.role);
        const tokenRole = normalizeRole(decoded.role);
        if (tokenRole && tokenRole !== role) {
            return sendUnauthorized(res, "ROLE_CHANGED", "Your account role changed. Please login again.");
        }

        if (HQ_EMPLOYEE_ROLE_SET.has(role)) {
            const employee = await Employee.findOne({ userId: user._id, active: "Active" })
                .select("_id organizationType")
                .lean();

            if (!employee?._id || String(employee?.organizationType || "").trim().toUpperCase() !== ORGANIZATION_TYPES.HQ) {
                return res.status(403).json({
                    success: false,
                    code: "HQ_ROLE_SCOPE_INVALID",
                    error: "This HQ role requires an active Employee record assigned to the HQ organization.",
                });
            }
        }

        req.user = user;
        req.authPayload = decoded;
        next();
    } catch (error) {
        console.log("Error from authMiddleware : " + error.message);

        if (error?.name === 'TokenExpiredError') {
            return sendUnauthorized(res, "SESSION_EXPIRED", "Session expired. Please login again.");
        }

        if (error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
            return sendUnauthorized(res, "INVALID_TOKEN", "Session expired. Please login again.");
        }

        return res.status(500).json({ success: false, error: "Authentication server error." });
    }
}

export default verifyUser
