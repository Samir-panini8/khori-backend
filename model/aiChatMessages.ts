import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { aiChatSessions } from "./aiChatSessions";

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id")
    .notNull()
    .references(() => aiChatSessions.id),
  participantId: varchar("participant_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiChatMessageSchema = createInsertSchema(
  aiChatMessages
).omit({
  id: true,
  createdAt: true,
});

export type InsertAiChatMessage = z.infer<typeof insertAiChatMessageSchema>;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
