# Subscription Tracker API

A professional, production-ready backend API for managing subscriptions, featuring automated email reminders, advanced security, and robust database management.

## 🚀 Overview

The **Subscription Tracker API** is a comprehensive solution for users to manage their recurring subscriptions efficiently. It provides automated renewal notifications, integrated security features, and a scalable architecture built on Node.js and MongoDB.

## ✨ Key Features

-   **User Authentication**: Secure signup and login using JWT and Bcrypt for password hashing.
-   **Subscription Management**: Complete CRUD operations for tracking various subscription types (entertainment, health, sports, etc.).
-   **Automated Workflows**: Integration with **Upstash Workflow** to automatically trigger email reminders before subscription renewals (7, 5, 2, and 1 day before).
-   **Advanced Security**: 
    -   **Arcjet** integration for bot detection and rate limiting.
    -   Global error handling and input validation.
-   **Email Notifications**: Automated reminder emails sent via **Nodemailer**.
-   **Database**: Robust data modeling with **Mongoose** and **MongoDB**.

## 🛠️ Tech Stack

-   **Backend**: Node.js, Express.js
-   **Database**: MongoDB (Mongoose)
-   **Security**: Arcjet, JWT, Bcrypt
-   **Automation**: Upstash Workflow
-   **Utilities**: Dayjs (Date manipulation), Nodemailer (Emails), Morgan (Logging)

## 📁 Project Structure

```bash
├── config              # Environment and third-party service configurations
├── controllers         # Request handlers and business logic
├── database            # Database connection setup
├── middlewares         # Authentication, security, and error handlers
├── models              # Mongoose data models
├── routes              # API endpoint definitions
├── utils               # Helper functions (e.g., email sending)
└── app.js              # Express application entry point
```

## ⚙️ Getting Started

### Prerequisites

-   Node.js installed
-   MongoDB account (Atlas or local)
-   Arcjet account (for security features)
-   Upstash account (for workflows)

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd subscription-tracker
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Set up environment variables:
    Create `.env.development.local` and `.env.production.local` files and populate them with the following:
    ```env
    PORT=5500
    SERVER_URL=http://localhost:5500
    NODE_ENV=development
    DB_URI=your_mongodb_uri
    JWT_SECRET=your_secret
    JWT_EXPIRES_IN=1d
    ARCJET_KEY=your_arcjet_key
    ARCJET_ENV=development
    QSTASH_URL=your_upstash_qstash_url
    QSTASH_TOKEN=your_upstash_qstash_token
    EMAIL_PASSWORD=your_email_app_password
    ```

### Running the Application

-   Development mode:
    ```bash
    npm run dev
    ```
-   Production mode:
    ```bash
    npm start
    ```

## 🔌 API Endpoints

### Auth
- `POST /api/v1/auth/sign-up`: Register a new user
- `POST /api/v1/auth/sign-in`: Login user

### Users
- `GET /api/v1/users`: Get all users
- `GET /api/v1/users/:id`: Get specific user details

### Subscriptions
- `POST /api/v1/subscriptions`: Create a new subscription
- `GET /api/v1/subscriptions/user/:id`: Get all subscriptions for a specific user
- `PUT /api/v1/subscriptions/:id/cancel`: Cancel a subscription

## 🛡️ Security

The API uses **Arcjet** for:
-   **Bot Detection**: Preventing automated malicious requests.
-   **Rate Limiting**: Protecting the API from abuse.

## 📧 Automated Reminders

The system uses **Upstash Workflows** to monitor renewal dates. It automatically schedules reminders and sends emails using **Nodemailer** to ensure users never miss a renewal payment.
