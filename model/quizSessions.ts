import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  jsonb,
  bigint,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { boards } from "./boards";
import { quizzes } from "./quizzes";

export const quizSessions = pgTable("quiz_sessions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  boardId: varchar("board_id")
    .notNull()
    .references(() => boards.id),
  quizId: varchar("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  status: text("status").notNull().default("draft"), // "draft", "finalized", "active", "closed"
  postedAt: timestamp("posted_at"),
  closesAt: timestamp("closes_at"),
  resultsShared: boolean("results_shared").notNull().default(false),
  leaderboardShared: boolean("leaderboard_shared").notNull().default(false),
});

export const insertQuizSessionSchema = createInsertSchema(quizSessions).omit({
  id: true,
});

export type InsertQuizSession = z.infer<typeof insertQuizSessionSchema>;
export type QuizSession = typeof quizSessions.$inferSelect;
