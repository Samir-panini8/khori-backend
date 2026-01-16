import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const quizClasses = pgTable("quiz_classes", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuizClassSchema = createInsertSchema(quizClasses).omit({
  id: true,
  createdAt: true,
});

export type InsertQuizClass = z.infer<typeof insertQuizClassSchema>;
export type QuizClass = typeof quizClasses.$inferSelect;
