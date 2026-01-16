import { sql } from "drizzle-orm";
import { pgTable, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { boards } from "./boards";
import { users } from "../shared/schema";

export const studentAttendance = pgTable("student_attendance", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  boardId: varchar("board_id")
    .notNull()
    .references(() => boards.id),
  studentId: varchar("student_id")
    .notNull()
    .references(() => users.id),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
  timeSpentSeconds: integer("time_spent_seconds").default(0),
});

export const insertStudentAttendanceSchema = createInsertSchema(
  studentAttendance
).omit({
  id: true,
});

export type InsertStudentAttendance = z.infer<
  typeof insertStudentAttendanceSchema
>;
export type StudentAttendance = typeof studentAttendance.$inferSelect;
