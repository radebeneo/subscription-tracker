import { Router } from 'express';
import {getUserById, getUsers} from "../controllers/user.controller.js";

const userRouter = Router();

userRouter.get('/', getUsers)

userRouter.get('/:id', getUserById)

userRouter.post('/', (req, res) => res.send({title: 'CREATE new users'}))

userRouter.put('/:id', (req, res) => res.send({title: 'UPDATE user'}))

userRouter.delete('/:id', (req, res) => res.send({title: 'DELETE user'}))

export default userRouter;