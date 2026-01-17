import { boardStorage } from "../storage/index.storage";
import { usersStorage } from "../storage/index.storage";
import { asyncHandler } from "../utils/asyncHandler";
import { Request, Response } from "express";
import { type Board } from "../model/boards";
import { insertBoardSchema } from "../model/boards";
import { generateRoomCode } from "../utils/generateRoomCode";

export const getAllBoards = asyncHandler(
  async (req: Request, res: Response) => {
    const user = await usersStorage.getById(req.session.userId!);
    let allBoards: Board[];

    if (user?.role === "admin") {
      allBoards = await boardStorage.getAll();
    } else {
      // Get boards where user is creator OR lecturer
      const createdBoards = await boardStorage.getBoardsByCreator(
        req.session.userId!,
      );
      const lecturerBoards = await boardStorage.getBoardsByLecturer(
        req.session.userId!,
      );

      // Merge and deduplicate by board id
      const boardMap = new Map();
      [...createdBoards, ...lecturerBoards].forEach((board) => {
        boardMap.set(board.id, board);
      });
      allBoards = Array.from(boardMap.values());
    }

    res.json(allBoards);
  },
);

export const createBoard = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersStorage.getById(req.session.userId!);
  if (!user || user.role === "student") {
    return res.status(403).json({ error: "Students cannot create boards" });
  }

  // Generate unique room code
  let roomCode = generateRoomCode();
  let attempts = 0;
  while ((await boardStorage.getBoardByRoomCode(roomCode)) && attempts < 10) {
    roomCode = generateRoomCode();
    attempts++;
  }

  // Admin can assign a lecturer, otherwise creator is lecturer
  let lecturerId = req.session.userId;
  if (user.role === "admin" && req.body.lecturerId) {
    // Verify the lecturer exists and is a teacher
    const lecturerIdStr = String(req.body.lecturerId);
    const lecturer = await usersStorage.getById(lecturerIdStr);
    if (
      lecturer &&
      (lecturer.role === "teacher" || lecturer.role === "admin")
    ) {
      lecturerId = lecturerIdStr;
    }
  }

  const validatedData = insertBoardSchema.parse({
    ...req.body,
    roomCode,
    creatorId: req.session.userId,
    lecturerId,
  });

  const board = await boardStorage.createBoard(validatedData);
  res.json(board);
});
