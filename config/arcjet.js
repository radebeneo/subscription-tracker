import arcjet, { shield, detectBot, tokenBucket} from "@arcjet/node";
import {ARCJET_KEY} from "./env.js";

const aj = arcjet({
    key: ARCJET_KEY,
    rules: [
        // Shield protects app from common attacks e.g. SQL injection
        shield({ mode: "LIVE" }),
        // Bot detection rule
        detectBot({
            mode: "LIVE", // Blocks requests. Use "DRY_RUN" to log only
            // Block all bots except the following
            allow: [
                "CATEGORY:SEARCH_ENGINE", // Google, Bing, etc
            ],
        }),
        // Token bucket rate limit. Other algorithms are supported.
        tokenBucket({
            mode: "LIVE",
            // Tracked by IP address by default, but this can be customized
            refillRate: 5, // Refill 5 tokens per interval
            interval: 10, // Refill every 10 seconds
            capacity: 10, // Bucket capacity of 10 tokens
        }),
    ],
});

export default aj;