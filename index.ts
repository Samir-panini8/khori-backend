import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { initializeDatabase } from "./db";
import { sessionMiddleware } from "./session";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import authRoutes from "./routes/auth.route.ts";
import userRoutes from "./routes/user.route.ts";
import { WebSocketServer } from "./websocket/server.ts";
import { errorHandler } from "./middleware/errorHandler.ts";
import { notFoundHandler } from "./middleware/notFoundHandler.ts";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const app = express();
const httpServer = createServer(app);

// 1. REQUEST LOGGING - FIRST (to log ALL requests)
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined")); // or "dev" for development
}

// 2. TRUST PROXY - EARLY (for accurate IP addresses)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// 3. Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // For React/Vue dev
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"], // For WebSockets
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"], // No Flash/PDF embeds
      },
    },
  })
);

// 4. CORS - After security, before routes
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

// 5. RATE LIMITING - After CORS, before body parsing
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 15 minutes
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  skip: (req) => req.path === "/health",
});

app.use("/api/", apiLimiter);

// 6. BODY PARSING - After security, before routes
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
    parameterLimit: 500,
  })
);

// 7. SESSION MIDDLEWARE - After body parsing, before auth
app.use(sessionMiddleware);

// ========== ROUTES ==========

// Health check (NO auth required, rate limit skipped)
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Initialize Server
(async () => {
  // Initialize database FIRST
  await initializeDatabase();
  console.log("✅ Database connected");

  // Initialize WebSocket server
  const wss = new WebSocketServer(httpServer);
  console.log("✅ WebSocket server ready");

  // Routes
  await registerRoutes(httpServer, app);

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/user", userRoutes);

  //Not Found
  app.use("*", notFoundHandler);
  // Error
  app.use(errorHandler);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  });
})();
