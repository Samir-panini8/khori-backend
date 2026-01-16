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
import { quizSessions } from "./quizSessions";

export const quizResponses = pgTable("quiz_responses", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id")
    .notNull()
    .references(() => quizSessions.id),
  participantId: varchar("participant_id").notNull(),
  participantName: text("participant_name").notNull(),
  answer: text("answer"), // Choice ID for MC, or integer value as string
  isCorrect: boolean("is_correct"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertQuizResponseSchema = createInsertSchema(quizResponses).omit({
  id: true,
  updatedAt: true,
});

export type InsertQuizResponse = z.infer<typeof insertQuizResponseSchema>;
export type QuizResponse = typeof quizResponses.$inferSelect;
