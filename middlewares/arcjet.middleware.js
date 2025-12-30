import aj from '../config/arcjet.js'

const arcjetMiddleware = (req, res, next) => {
    try{
        const decision = await aj.protect(req);

        if (decision.isDenied()) {
            if (decision.reason.isRateLimit()){
                return res.status(429).json({message: 'Rate limit reached'});
            }
        }
    } catch (error){
        console.log(`Arcjet Middleware Error: ${error}`)
        next(error)

    }
}