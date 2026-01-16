import "dotenv/config";
import express, { type Request, Response } from "express";
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
    rawBody: Buffer;
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
        scriptSrc:
          process.env.NODE_ENV === "production"
            ? ["'self'"]
            : ["'self'", "'unsafe-inline'"], // For React/Vue dev
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
  windowMs: 10 * 60 * 1000, // 10 minutes
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
    parameterLimit: 1000,
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
  try {
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

    const port = parseInt(process.env.PORT || "5000", 10);

    // Validate port
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${port}`);
    }

    const server = httpServer.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        console.log(`✅ Server running on port ${port}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(`🔗 Health: http://localhost:${port}/health`);
        console.log(`📡 WebSocket: ws://localhost:${port}`);
      }
    );

    // ========== CRITICAL: GRACEFUL SHUTDOWN ==========
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, starting graceful shutdown...`);

      // 1. Stop accepting new connections
      server.close(() => {
        console.log("✅ HTTP server closed");

        // 2. Close WebSocket connections
        wss.close();
        console.log("✅ WebSocket server closed");

        console.log("✅ Graceful shutdown complete");
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error(
          "❌ Could not close connections in time, forcing shutdown"
        );
        process.exit(1);
      }, 10000);
    };

    // Handle termination signals
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught errors
    process.on("uncaughtException", (error) => {
      console.error("💥 Uncaught Exception:", error);
      shutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
      shutdown("UNHANDLED_REJECTION");
    });
  } catch (error) {
    console.error("❌ Server startup failed", error);
    process.exit(1);
  }
})();
