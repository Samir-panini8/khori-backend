import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, bigint, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session table for connect-pg-simple (don't delete this!)
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("teacher"),
  screenName: text("screen_name"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const boards = pgTable("boards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomCode: text("room_code").notNull().unique(), // Auto-generated 9-character alphanumeric code
  title: text("title").notNull().default("Untitled Room"), // User-friendly room title (not unique)
  creatorId: varchar("creator_id").notNull().references(() => users.id),
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

export const boardData = pgTable("board_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  boardId: varchar("board_id").notNull().references(() => boards.id),
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

// Quiz categories (Math, Physics, etc.)
export const quizCategories = pgTable("quiz_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuizCategorySchema = createInsertSchema(quizCategories).omit({
  id: true,
  createdAt: true,
});

export type InsertQuizCategory = z.infer<typeof insertQuizCategorySchema>;
export type QuizCategory = typeof quizCategories.$inferSelect;

// Quiz classes/levels (Level 1, Level 2, etc.)
export const quizClasses = pgTable("quiz_classes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuizClassSchema = createInsertSchema(quizClasses).omit({
  id: true,
  createdAt: true,
});

export type InsertQuizClass = z.infer<typeof insertQuizClassSchema>;
export type QuizClass = typeof quizClasses.$inferSelect;

// Quiz library - questions created by teachers/admins
export const quizzes = pgTable("quizzes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  categoryId: varchar("category_id").references(() => quizCategories.id),
  classId: varchar("class_id").references(() => quizClasses.id),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull().default("multiple_choice"), // "multiple_choice" or "integer"
  choices: jsonb("choices").default([]), // For multiple choice: [{id, text}]
  correctAnswer: text("correct_answer").notNull(), // Choice ID for MC, or integer value as string
  timerSeconds: integer("timer_seconds").notNull().default(120),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuizSchema = createInsertSchema(quizzes).omit({
  id: true,
  createdAt: true,
});

export type InsertQuiz = z.infer<typeof insertQuizSchema>;
export type Quiz = typeof quizzes.$inferSelect;

// Quiz sessions - active quiz instances within a board
export const quizSessions = pgTable("quiz_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  boardId: varchar("board_id").notNull().references(() => boards.id),
  quizId: varchar("quiz_id").notNull().references(() => quizzes.id),
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

// Quiz responses - participant answers
export const quizResponses = pgTable("quiz_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => quizSessions.id),
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

// Student attendance - tracks when students join rooms
export const studentAttendance = pgTable("student_attendance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  boardId: varchar("board_id").notNull().references(() => boards.id),
  studentId: varchar("student_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
  timeSpentSeconds: integer("time_spent_seconds").default(0),
});

export const insertStudentAttendanceSchema = createInsertSchema(studentAttendance).omit({
  id: true,
});

export type InsertStudentAttendance = z.infer<typeof insertStudentAttendanceSchema>;
export type StudentAttendance = typeof studentAttendance.$inferSelect;

// Teacher attendance - tracks when teachers are in their rooms
export const teacherAttendance = pgTable("teacher_attendance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  boardId: varchar("board_id").notNull().references(() => boards.id),
  teacherId: varchar("teacher_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
  timeSpentSeconds: integer("time_spent_seconds").default(0),
});

export const insertTeacherAttendanceSchema = createInsertSchema(teacherAttendance).omit({
  id: true,
});

export type InsertTeacherAttendance = z.infer<typeof insertTeacherAttendanceSchema>;
export type TeacherAttendance = typeof teacherAttendance.$inferSelect;

// Lecture recordings - stores audio recording metadata and data
export const lectureRecordings = pgTable("lecture_recordings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  boardId: varchar("board_id").notNull().references(() => boards.id),
  lecturerId: varchar("lecturer_id").notNull().references(() => users.id),
  status: text("status").notNull().default("recording"), // "recording" | "completed" | "transcribed"
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  audioData: text("audio_data"), // Base64 encoded audio
  durationMs: integer("duration_ms"),
});

export const insertLectureRecordingSchema = createInsertSchema(lectureRecordings).omit({
  id: true,
  startedAt: true,
});

export type InsertLectureRecording = z.infer<typeof insertLectureRecordingSchema>;
export type LectureRecording = typeof lectureRecordings.$inferSelect;

// Lecture transcripts - stores transcribed text from audio
export const lectureTranscripts = pgTable("lecture_transcripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordingId: varchar("recording_id").notNull().references(() => lectureRecordings.id),
  transcriptText: text("transcript_text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLectureTranscriptSchema = createInsertSchema(lectureTranscripts).omit({
  id: true,
  createdAt: true,
});

export type InsertLectureTranscript = z.infer<typeof insertLectureTranscriptSchema>;
export type LectureTranscript = typeof lectureTranscripts.$inferSelect;

// AI Chat Sessions - created by lecturer to start chat about a lecture
export const aiChatSessions = pgTable("ai_chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  boardId: varchar("board_id").notNull().references(() => boards.id),
  transcriptId: varchar("transcript_id").references(() => lectureTranscripts.id),
  boardImageData: text("board_image_data"), // Base64 encoded board snapshot
  context: text("context"), // Teacher-provided context (age, key ideas, etc.)
  createdBy: varchar("created_by").notNull().references(() => users.id),
  status: text("status").notNull().default("draft"), // "draft" | "active" | "completed"
  timerSeconds: integer("timer_seconds").notNull().default(300), // 5 minutes default
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiChatSessionSchema = createInsertSchema(aiChatSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertAiChatSession = z.infer<typeof insertAiChatSessionSchema>;
export type AiChatSession = typeof aiChatSessions.$inferSelect;

// AI Chat Participants - tracks students participating in chat sessions
export const aiChatParticipants = pgTable("ai_chat_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => aiChatSessions.id),
  participantId: varchar("participant_id").notNull(),
  participantName: text("participant_name").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "started" | "completed"
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  score: integer("score"), // Understanding score 0-100
});

export const insertAiChatParticipantSchema = createInsertSchema(aiChatParticipants).omit({
  id: true,
});

export type InsertAiChatParticipant = z.infer<typeof insertAiChatParticipantSchema>;
export type AiChatParticipant = typeof aiChatParticipants.$inferSelect;

// AI Chat Messages - individual messages in a chat conversation
export const aiChatMessages = pgTable("ai_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => aiChatSessions.id),
  participantId: varchar("participant_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAiChatMessageSchema = createInsertSchema(aiChatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertAiChatMessage = z.infer<typeof insertAiChatMessageSchema>;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;

// Export chat models
export * from "./models/chat";
