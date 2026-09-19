import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

import User, { serializeUser } from '../models/user.model.js';
import authorize from '../middlewares/auth.middleware.js';
import { signUp, signIn } from '../controllers/auth.controller.js';
import { getUserById } from '../controllers/user.controller.js';
import userRouter from '../routes/user.routes.js';
import { JWT_SECRET } from '../config/env.js';

const makeRes = () => {
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };

  return res;
};

test('sign-up response omits password hash', async () => {
  const existing = User.findOne;
  const createUser = User.create;
  const startSession = (await import('mongoose')).default.startSession;

  User.findOne = async () => null;
  User.create = async ([doc]) => [{ ...doc, _id: 'user-1' }];
  (await import('mongoose')).default.startSession = async () => ({
    startTransaction() {},
    commitTransaction() {},
    abortTransaction() {},
    endSession() {},
  });

  try {
    const req = {
      body: { name: 'Alice', email: 'alice@example.com', password: 'secret123' },
    };
    const res = makeRes();
    const next = (err) => {
      assert.ifError(err);
    };

    await signUp(req, res, next);
    assert.equal(res.payload.data.user.password, undefined);
    assert.equal(res.payload.data.user.email, 'alice@example.com');
  } finally {
    User.findOne = existing;
    User.create = createUser;
    (await import('mongoose')).default.startSession = startSession;
  }
});

test('sign-in response omits password hash', async () => {
  const original = User.findOne;
  User.findOne = async () => ({
    _id: 'user-2',
    name: 'Bob',
    email: 'bob@example.com',
    password: '$2a$10$abcdefghijklmnopqrstuv/1234567890abcdefghijkl',
  });

  try {
    const req = {
      body: { email: 'bob@example.com', password: 'secret123' },
    };
    const res = makeRes();
    const next = (err) => { assert.ifError(err); };

    const hash = await bcrypt.hash('secret123', 10);
    User.findOne = async () => ({
      _id: 'user-2',
      name: 'Bob',
      email: 'bob@example.com',
      password: hash,
    });

    await signIn(req, res, next);
    assert.equal(res.payload.data.user.password, undefined);
    assert.equal(res.payload.data.user.email, 'bob@example.com');
  } finally {
    User.findOne = original;
  }
});

test('user serialization only exposes the public allowlist', () => {
  const user = {
    _id: 'user-public',
    name: 'Public User',
    email: 'public@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    password: 'hashed-password',
    internalRole: 'admin',
    resetToken: 'private-token',
  };

  assert.deepEqual(serializeUser(user), {
    _id: 'user-public',
    name: 'Public User',
    email: 'public@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
});

test('missing, malformed, invalid, and expired auth requests are rejected', async () => {
  const cases = [
    { label: 'missing', headers: {}, expectedMessage: 'Authentication required' },
    { label: 'malformed', headers: { authorization: 'Token invalid' }, expectedMessage: 'Invalid or expired token' },
    { label: 'invalid', headers: { authorization: 'Bearer invalid.token.value' }, expectedMessage: 'Invalid or expired token' },
    { label: 'expired', headers: { authorization: `Bearer ${jwt.sign({ userId: 'user-3' }, JWT_SECRET, { expiresIn: '-1s' })}` }, expectedMessage: 'Invalid or expired token' },
  ];

  for (const testCase of cases) {
    const req = { headers: testCase.headers };
    const res = makeRes();
    let nextError = null;
    await authorize(req, res, (err) => {
      nextError = err;
    });

    assert.ok(nextError, `${testCase.label} should reject`);
    assert.equal(nextError.statusCode, 401, `${testCase.label} should return 401`);
    assert.match(nextError.message, new RegExp(testCase.expectedMessage, 'i'));
    assert.equal(res.statusCode, 200, `${testCase.label} must not send a response directly`);
  }
});

test('authenticated identity with no database user is rejected by the protected handler chain', async () => {
  const original = User.findById;
  User.findById = async () => null;

  const app = express();
  let downstreamCalled = false;
  app.get('/private', authorize, (req, res) => {
    downstreamCalled = true;
    res.status(200).json({ ok: true });
  });
  app.use((error, req, res, next) => {
    void req;
    void next;
    res.status(error.statusCode || 500).json({ message: error.message });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const token = jwt.sign({ userId: 'missing-user' }, JWT_SECRET, { expiresIn: '5m' });
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/private`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(downstreamCalled, false);
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.match(payload.message, /user not found/i);
  } finally {
    server.close();
    User.findById = original;
  }
});

test('database operational errors propagate through authorization', async () => {
  const original = User.findById;
  const databaseError = new Error('database unavailable');
  User.findById = async () => {
    throw databaseError;
  };

  try {
    const token = jwt.sign({ userId: 'user-4' }, JWT_SECRET, { expiresIn: '5m' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    let nextError;

    await authorize(req, res, (error) => {
      nextError = error;
    });

    assert.strictEqual(nextError, databaseError);
    assert.equal(res.statusCode, 200);
  } finally {
    User.findById = original;
  }
});

test('owner access to profile is allowed, other-user access is blocked', async () => {
  const original = User.findById;
  const user = { _id: 'user-99', name: 'Owner', email: 'owner@example.com', password: 'hashed' };
  User.findById = async () => user;

  try {
    const req = {
      params: { id: 'user-99' },
      user,
    };
    const res = makeRes();
    const next = (err) => { assert.ifError(err); };

    await getUserById(req, res, next);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.data._id.toString(), 'user-99');
    assert.equal(res.payload.data.password, undefined);

    const otherReq = {
      params: { id: 'user-100' },
      user,
    };
    const otherRes = makeRes();
    let otherErr;

    User.findById = async (id) => ({
      _id: id,
      name: 'Another',
      email: 'another@example.com',
      password: 'hashed',
    });

    await getUserById(otherReq, otherRes, (err) => {
      otherErr = err;
    });

    assert.ok(otherErr);
    assert.equal(otherErr.statusCode, 403);
  } finally {
    User.findById = original;
  }
});

test('public user enumeration is unavailable', async () => {
  const app = express();
  app.use('/api/v1/users', userRouter);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/users`, { method: 'GET' });
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});

test('authorization failure does not call downstream route handlers or send duplicate responses', async () => {
  const app = express();
  let downstreamCalled = false;
  let responseCount = 0;

  app.get('/private', authorize, (req, res) => {
    downstreamCalled = true;
    responseCount += 1;
    res.status(200).json({ ok: true });
  });

  app.use((err, req, res, next) => {
    void next;
    responseCount += 1;
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/private`, {
      headers: { authorization: 'Bearer invalid.token' },
    });

    assert.equal(downstreamCalled, false);
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.match(payload.message, /invalid or expired token/i);
    assert.equal(responseCount, 1);
  } finally {
    server.close();
  }
});
