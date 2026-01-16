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
import { lectureTranscripts } from "./lectureTranscripts";
import { users } from "./users";

export const aiChatSessions = pgTable("ai_chat_sessions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  boardId: varchar("board_id")
    .notNull()
    .references(() => boards.id),
  transcriptId: varchar("transcript_id").references(
    () => lectureTranscripts.id
  ),
  boardImageData: text("board_image_data"), // Base64 encoded board snapshot
  context: text("context"), // Teacher-provided context (age, key ideas, etc.)
  createdBy: varchar("created_by")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("draft"), // "draft" | "active" | "completed"
  timerSeconds: integer("timer_seconds").notNull().default(300), // 5 minutes default
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiChatSessionSchema = createInsertSchema(
  aiChatSessions
).omit({
  id: true,
  createdAt: true,
});

export type InsertAiChatSession = z.infer<typeof insertAiChatSessionSchema>;
export type AiChatSession = typeof aiChatSessions.$inferSelect;
