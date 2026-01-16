import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { boards } from "./boards";

export const boardData = pgTable("board_data", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  boardId: varchar("board_id")
    .notNull()
    .references(() => boards.id),
  userId: varchar("user_id").notNull(),
  userName: text("user_name").notNull(),
  linesData: jsonb("lines_data").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBoardDataSchema = createInsertSchema(boardData).omit({
  id: true,
  updatedAt: true,
});

export type InsertBoardData = z.infer<typeof insertBoardDataSchema>;
export type BoardData = typeof boardData.$inferSelect;
