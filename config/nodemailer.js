import nodemailer from "nodemailer";
import {EMAIL_PASSWORD} from "./env.js";

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'radebeneo17@gmail.com',
        pass: EMAIL_PASSWORD
    }
})