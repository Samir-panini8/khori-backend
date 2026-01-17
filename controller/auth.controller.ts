import { asyncHandler } from "../utils/asyncHandler.ts";
import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { usersStorage } from "../storage/index.storage.ts";

export const Login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const user = await usersStorage.getByUsername(username);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.userId = user.id;
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    screenName: user.screenName,
  });
});

export const Logout = asyncHandler(async (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.json({ success: true });
  });
});

export const ChangePassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new passwords are required" });
    }

    if (newPassword.length < 4) {
      return res
        .status(400)
        .json({ message: "Password must be at least 4 characters" });
    }

    const user = await usersStorage.getById(req.session.userId!);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await usersStorage.updatePassword(user.id, hashedPassword);

    res.json({ success: true });
  },
);

// Check session
export const CheckSession = asyncHandler(
  async (req: Request, res: Response) => {
    const user = await usersStorage.getById(req.session.userId!);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      screenName: user.screenName,
    });
  },
);
