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

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersStorage.getById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { screenName } = req.body;
  await storage.updateUserScreenName(req.params.id, screenName || null);
  res.json({ success: true, screenName: screenName || null });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersStorage.getById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.role === "admin") {
    return res.status(403).json({ error: "Cannot delete admin user" });
  }

  await usersStorage.deleteUser(req.params.id);
  res.json({ success: true });
});

export const GetUsersByRole = asyncHandler(
  async (req: Request, res: Response) => {
    const { role, page = 1, limit = 10, search } = req.query;

    if (typeof role !== "string" || !role.trim()) {
      res.status(400).json({ message: "role query parameter is required" });
      return;
    }

    const pageInt = Number.parseInt(String(page ?? "1"), 10);
    const limitInt = Number.parseInt(String(limit ?? "10"), 10);
    const offset = (pageInt - 1) * limitInt;

    const users = await usersStorage.getUsersByRolePaginated(
      String(role),
      limitInt,
      offset,
      typeof search === "string" ? search : undefined,
    );

    const totalUsers = await usersStorage.countUsersByRole(
      String(role),
      typeof search === "string" ? search : undefined,
    );

    const totalPages = Math.ceil(totalUsers / limitInt);

    res.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        screenName: u.screenName,
      })),
      pagination: {
        page: pageInt,
        limit: limitInt,
        total: totalUsers,
        totalPages,
        hasPrevious: pageInt > 1,
        hasNext: pageInt < totalPages,
      },
    });
  },
);
