import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { quizCategories } from "./quizCategories";
import { quizClasses } from "./quizClasses";
import { users } from "./users";

export const quizzes = pgTable("quizzes", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id")
    .notNull()
    .references(() => users.id),
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
