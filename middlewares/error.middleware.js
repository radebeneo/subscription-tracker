const errorMiddleware = (err, req, res, next) => {
    try{
        let error = {...err};

        error.message = err.message;

        console.error(err);

        //Mongoose bad ObjectId conversion error
        if(error.name === 'CastError') {
            const message = `Resource not found. Invalid ${error.path}`;
            error = new Error(message);
            error.statusCode = 404;
        }

        //Mongoose duplicate key error
        if(error.code === 11000) {
            const message = 'Duplicate field value entered';
            error = new Error(message);
            error.statusCode = 400;
        }

        //Mongoose validation error
        if(error.name === 'ValidationError') {
            const message = Object.values(error.errors).map(val => val.message);
            error = new Error(message.join(', '));
            error.statusCode = 400;
        }

        res.status(error.statusCode || 500).json({success: false, message: error.message || 'Server error'});

    } catch(error) {
        next(error);
    }
}

export default errorMiddleware;