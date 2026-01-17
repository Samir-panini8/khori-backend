import { db } from "../db";
import { boards, type Board, type InsertBoard } from "../model/boards";
import { boardData } from "../model/boardData";
import { eq, desc } from "drizzle-orm";

export class BoardStorage {
  async getAll(): Promise<Board[]> {
    return await db.select().from(boards);
  }

  async getBoardsByCreator(creatorId: string): Promise<Board[]> {
    return db.select().from(boards).where(eq(boards.creatorId, creatorId));
  }

  async getBoardsByLecturer(lecturerId: string): Promise<Board[]> {
    return db
      .select()
      .from(boards)
      .where(eq(boards.lecturerId, lecturerId))
      .orderBy(desc(boards.startTime));
  }

  async getBoardByRoomCode(roomCode: string): Promise<Board | undefined> {
    const [board] = await db
      .select()
      .from(boards)
      .where(eq(boards.roomCode, roomCode));
    return board || undefined;
  }

  async createBoard(insertBoard: InsertBoard): Promise<Board> {
    const [board] = await db.insert(boards).values(insertBoard).returning();
    return board;
  }

  async updateBoard(
    id: string,
    updates: Partial<InsertBoard>,
  ): Promise<Board | undefined> {
    const [board] = await db
      .update(boards)
      .set(updates)
      .where(eq(boards.id, id))
      .returning();
    return board || undefined;
  }

  async deleteBoard(id: string): Promise<boolean> {
    await db.delete(boardData).where(eq(boardData.boardId, id));
    await db.delete(boards).where(eq(boards.id, id));
    return true;
  }
}
