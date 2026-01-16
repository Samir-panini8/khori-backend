import { asyncHandler } from "../utils/asyncHandler.ts";
import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { usersStorage } from "../storage/index.storage.ts";
import { insertUserSchema } from "../model/users.ts";

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const validatedData = insertUserSchema.parse(req.body);

  // Check if user already exists
  const existingUser = await usersStorage.getByUsername(validatedData.username);
  if (existingUser) {
    return res.status(400).json({ error: "Username already exists" });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(validatedData.password, 10);

  const user = await usersStorage.create({
    ...validatedData,
    password: hashedPassword,
    role: validatedData.role || "teacher",
  });

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
  });
});

export const updateUser = asyncHandler(
  async (req: Request, res: Response) => {}
);

export const deleteUser = asyncHandler(
  async (req: Request, res: Response) => {}
);
