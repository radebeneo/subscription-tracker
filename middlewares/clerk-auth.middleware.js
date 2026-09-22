import { createClerkVerifier } from '../services/clerk-verifier.js';
import { createClerkVerifierConfig } from '../config/clerk.js';

const clerkVerifier = createClerkVerifier(createClerkVerifierConfig());

const clerkAuthorize = async (req, res, next) => {
    try {
        req.providerIdentity = await clerkVerifier(req.headers.authorization);
        return next();
    } catch (error) {
        return next(error);
    }
};

export default clerkAuthorize;
