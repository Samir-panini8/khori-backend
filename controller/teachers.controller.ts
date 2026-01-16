import { asyncHandler } from "../utils/asyncHandler";
import { Request, Response } from "express";
import { usersStorage } from "../storage/index.storage";

export const getAllTeachers = asyncHandler(
  async (req: Request, res: Response) => {
    const teachers = usersStorage.getUsersByRole("teacher");
  }
);
