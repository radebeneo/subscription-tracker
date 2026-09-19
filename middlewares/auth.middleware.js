import jwt from "jsonwebtoken";
import {JWT_SECRET} from "../config/env.js";
import User from "../models/user.model.js";

const authorize = async (req, res, next) => {
    try{
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            const error = new Error('Authentication required');
            error.statusCode = 401;
            return next(error);
        }

        if (!authHeader.startsWith('Bearer ')) {
            const error = new Error('Invalid or expired token');
            error.statusCode = 401;
            return next(error);
        }

        const token = authHeader.slice(7).trim();

        if (!token) {
            const error = new Error('Invalid or expired token');
            error.statusCode = 401;
            return next(error);
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET)
        } catch {
            const authError = new Error('Invalid or expired token');
            authError.statusCode = 401;
            return next(authError);
        }

        if (!decoded || !decoded.userId) {
            const error = new Error('Invalid or expired token');
            error.statusCode = 401;
            return next(error);
        }

        const user = await User.findById(decoded.userId)

        if (!user) {
            const error = new Error('Authentication failed: user not found');
            error.statusCode = 401;
            return next(error);
        }

        req.user = user

        return next()

    } catch (authError) {
        return next(authError)
    }
}

export default authorize;