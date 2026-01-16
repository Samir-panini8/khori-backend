import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { aiChatSessions } from "./aiChatSessions";

export const aiChatParticipants = pgTable("ai_chat_participants", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id")
    .notNull()
    .references(() => aiChatSessions.id),
  participantId: varchar("participant_id").notNull(),
  participantName: text("participant_name").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "started" | "completed"
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  score: integer("score"), // Understanding score 0-100
});

export const insertAiChatParticipantSchema = createInsertSchema(
  aiChatParticipants
).omit({
  id: true,
});

export type InsertAiChatParticipant = z.infer<
  typeof insertAiChatParticipantSchema
>;
export type AiChatParticipant = typeof aiChatParticipants.$inferSelect;
