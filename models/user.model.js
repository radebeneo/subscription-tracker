import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        minLength: 2,
        maxLength: 20

    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [/\S+@\S+\.\S+/, 'Please fill a valid email address'],
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minLength: 6,
    }
},{ timestamps: true });

export const serializeUser = (user) => {
    if (!user) return null;

    const source = typeof user.toObject === 'function' ? user.toObject() : { ...user };

    return {
        _id: source._id,
        name: source.name,
        email: source.email,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
    };
};

const User = mongoose.model('User', userSchema);

export default User;



