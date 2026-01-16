// middleware/errorHandler.ts
import { Request, Response, NextFunction } from "express";

// Custom error class for better error handling
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Global error handler
export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Default values
  err.statusCode = err.statusCode || 500;
  err.message = err.message || "Internal Server Error";

  // Log error (with more context in production)
  if (process.env.NODE_ENV === "production") {
    console.error("Error:", {
      message: err.message,
      statusCode: err.statusCode,
      path: _req.path,
      method: _req.method,
      ip: _req.ip,
      userAgent: _req.get("user-agent"),
    });
  } else {
    // Development: full error logging
    console.error("Error:", err);
  }

  // Handle different error types
  let response: any = {
    status: "error",
    message: err.message,
  };

  // Mongoose validation error
  if (err.name === "ValidationError") {
    err.statusCode = 400;
    response.message = "Validation Error";
    response.errors = Object.values(err.errors).map((e: any) => e.message);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    err.statusCode = 400;
    response.message = "Duplicate field value entered";
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === "CastError") {
    err.statusCode = 400;
    response.message = `Invalid ${err.path}: ${err.value}`;
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    err.statusCode = 401;
    response.message = "Invalid token";
  }

  if (err.name === "TokenExpiredError") {
    err.statusCode = 401;
    response.message = "Token expired";
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  } else if (err.statusCode >= 500) {
    // In production, don't expose internal error messages
    response.message = "Internal Server Error";
  }

  res.status(err.statusCode).json(response);
};
