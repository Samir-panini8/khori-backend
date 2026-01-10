import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";

const PgSession = ConnectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgSession({
    pool: pool,
    createTableIfMissing: true,
  }),
  secret:
    process.env.SESSION_SECRET || "whiteboard-secret-key-change-in-production",
  resave: false,
  saveUninitialized: false,
  proxy: process.env.NODE_ENV === "production",
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  },
});
