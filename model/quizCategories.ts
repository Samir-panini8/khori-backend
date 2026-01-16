import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const quizCategories = pgTable("quiz_categories", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertQuizCategorySchema = createInsertSchema(quizCategories).omit(
  {
    id: true,
    createdAt: true,
  }
);

export type InsertQuizCategory = z.infer<typeof insertQuizCategorySchema>;
export type QuizCategory = typeof quizCategories.$inferSelect;
