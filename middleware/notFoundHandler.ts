// middleware/notFoundHandler.ts
import { Request, Response } from "express";

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({
    message: "Route not found",
    path: _req.originalUrl,
  });
};
