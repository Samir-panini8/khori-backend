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
import { lectureRecordings } from "./lectureRecordings";

export const lectureTranscripts = pgTable("lecture_transcripts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  recordingId: varchar("recording_id")
    .notNull()
    .references(() => lectureRecordings.id),
  transcriptText: text("transcript_text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLectureTranscriptSchema = createInsertSchema(
  lectureTranscripts
).omit({
  id: true,
  createdAt: true,
});

export type InsertLectureTranscript = z.infer<
  typeof insertLectureTranscriptSchema
>;
export type LectureTranscript = typeof lectureTranscripts.$inferSelect;
