import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

export const boards = pgTable("boards", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  roomCode: text("room_code").notNull().unique(), // Auto-generated 9-character alphanumeric code
  title: text("title").notNull().default("Untitled Room"), // User-friendly room title (not unique)
  creatorId: varchar("creator_id")
    .notNull()
    .references(() => users.id),
  lecturerId: varchar("lecturer_id").references(() => users.id), // Lecturer for this room (defaults to creator)
  startTime: timestamp("start_time").notNull().defaultNow(),
  endTime: timestamp("end_time"),
  isEnded: boolean("is_ended").notNull().default(false),
  isPublic: boolean("is_public").notNull().default(true),
  password: text("password"),
  accessType: text("access_type").notNull().default("logged_in"), // "anyone" or "logged_in"
  boardType: text("board_type").notNull().default("multiboard"), // "multiboard" or "single"
});

export const insertBoardSchema = createInsertSchema(boards).omit({
  id: true,
  startTime: true,
});

export type InsertBoard = z.infer<typeof insertBoardSchema>;
export type Board = typeof boards.$inferSelect;
