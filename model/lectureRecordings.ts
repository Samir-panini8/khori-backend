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
import { boards } from "./boards";
import { users } from "./users";

export const lectureRecordings = pgTable("lecture_recordings", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  boardId: varchar("board_id")
    .notNull()
    .references(() => boards.id),
  lecturerId: varchar("lecturer_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("recording"), // "recording" | "completed" | "transcribed"
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  audioData: text("audio_data"), // Base64 encoded audio
  durationMs: integer("duration_ms"),
});

export const insertLectureRecordingSchema = createInsertSchema(
  lectureRecordings
).omit({
  id: true,
  startedAt: true,
});

export type InsertLectureRecording = z.infer<
  typeof insertLectureRecordingSchema
>;
export type LectureRecording = typeof lectureRecordings.$inferSelect;
