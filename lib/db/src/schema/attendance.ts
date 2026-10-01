import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "attendance_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    role: text("role").notNull(),
    initials: text("initials").notNull(),
    matricNumber: text("matric_number"),
    department: text("department").notNull(),
    clerkUserId: text("clerk_user_id").unique(),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (table) => [index("attendance_users_role_idx").on(table.role)],
);

export const coursesTable = pgTable(
  "attendance_courses",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    title: text("title").notNull(),
    department: text("department").notNull(),
    lecturerId: text("lecturer_id")
      .notNull()
      .references(() => usersTable.id),
    color: text("color").notNull().default("navy"),
  },
  (table) => [index("attendance_courses_lecturer_idx").on(table.lecturerId)],
);

export const sessionsTable = pgTable(
  "attendance_sessions",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => coursesTable.id),
    room: text("room").notNull(),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("attendance_sessions_course_idx").on(table.courseId),
    index("attendance_sessions_status_idx").on(table.status),
  ],
);

export const attendanceTable = pgTable(
  "attendance_records",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => usersTable.id),
    courseId: text("course_id")
      .notNull()
      .references(() => coursesTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionsTable.id),
    scannedAt: timestamp("scanned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("present"),
  },
  (table) => [
    uniqueIndex("attendance_session_student_unique").on(
      table.sessionId,
      table.studentId,
    ),
    index("attendance_student_idx").on(table.studentId),
    index("attendance_course_idx").on(table.courseId),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable);
export const insertCourseSchema = createInsertSchema(coursesTable).omit({
  id: true,
});
export const insertSessionSchema = createInsertSchema(sessionsTable).omit({
  id: true,
});
export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  scannedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof coursesTable.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type AttendanceSession = typeof sessionsTable.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;