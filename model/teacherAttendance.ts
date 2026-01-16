import { sql } from "drizzle-orm";
import { pgTable, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { boards } from "./boards";
import { users } from "./users";

export const teacherAttendance = pgTable("teacher_attendance", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  boardId: varchar("board_id")
    .notNull()
    .references(() => boards.id),
  teacherId: varchar("teacher_id")
    .notNull()
    .references(() => users.id),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  leftAt: timestamp("left_at"),
  timeSpentSeconds: integer("time_spent_seconds").default(0),
});

export const insertTeacherAttendanceSchema = createInsertSchema(
  teacherAttendance
).omit({
  id: true,
});

export type InsertTeacherAttendance = z.infer<
  typeof insertTeacherAttendanceSchema
>;
export type TeacherAttendance = typeof teacherAttendance.$inferSelect;
