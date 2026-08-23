import jwt from 'jsonwebtoken'
import User from '../models/User.js';

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
