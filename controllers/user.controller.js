import User, { serializeUser } from "../models/user.model.js";

export const getUsers = async (req, res, next) => {
    try{
        const users = await User.find()

        res.status(200).json({success:true, data:users})
    } catch(error){
        next(error)
    }
}


export const getUserById = async (req, res, next) => {
    try{
        const user = await User.findById(req.params.id)

        if(!user){
            const error = new Error('User not found')
            error.statusCode = 404
            throw error
        }

        if (req.user && req.user._id && req.user._id.toString() !== user._id.toString()) {
            const error = new Error('Forbidden')
            error.statusCode = 403
            throw error
        }

        res.status(200).json({success:true, data: serializeUser(user)})

    } catch(error){
        next(error)
    }
}