import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateCourseBody,
  CreateSessionBody,
  CreateSessionParams,
  EndSessionParams,
  GetAttendanceReportQueryParams,
  GetCourseParams,
  GetSessionParams,
  GetStudentAttendanceParams,
  ListCoursesQueryParams,
  ListSessionAttendanceParams,
  ScanAttendanceBody,
  ScanAttendanceParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  attendanceTable,
  coursesTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";

const router: IRouter = Router();

const lecturer = {
  id: "lecturer-01",
  name: "Dr. Amina Yusuf",
  email: "amina.yusuf@fuoye.edu.ng",
  role: "lecturer",
  initials: "AY",
  matricNumber: null,
  department: "Computer Science",
} as const;

const students = [
  {
    id: "student-01",
    name: "Nathaniel Goodluck",
    email: "nathaniel.goodluck@fuoye.edu.ng",
    role: "student",
    initials: "NG",
    matricNumber: "CSC/2022/81094",
    department: "Computer Science",
  },
  {
    id: "student-02",
    name: "Blessing Adebayo",
    email: "blessing.adebayo@fuoye.edu.ng",
    role: "student",
    initials: "BA",
    matricNumber: "CSC/2022/80113",
    department: "Computer Science",
  },
  {
    id: "student-03",
    name: "Daniel Okafor",
    email: "daniel.okafor@fuoye.edu.ng",
    role: "student",
    initials: "DO",
    matricNumber: "CSC/2022/80771",
    department: "Computer Science",
  },
  {
    id: "student-04",
    name: "Esther Ibrahim",
    email: "esther.ibrahim@fuoye.edu.ng",
    role: "student",
    initials: "EI",
    matricNumber: "CSC/2022/80422",
    department: "Computer Science",
  },
] as const;

const seedCourses = [
  {
    id: "course-csc401",
    code: "CSC 401",
    title: "Software Engineering",
    department: "Computer Science",
    lecturerId: lecturer.id,
    color: "teal",
  },
  {
    id: "course-csc407",
    code: "CSC 407",
    title: "Information Systems",
    department: "Computer Science",
    lecturerId: lecturer.id,
    color: "amber",
  },
  {
    id: "course-csc415",
    code: "CSC 415",
    title: "Database Management",
    department: "Computer Science",
    lecturerId: lecturer.id,
    color: "violet",
  },
] as const;

function parseDate(value: Date): string {
  return value.toISOString();
}

function currentSessionStatus(session: typeof sessionsTable.$inferSelect) {
  if (session.status === "ended") return "ended";
  if (session.endsAt.getTime() <= Date.now()) return "expired";
  return "active";
}

async function ensureSeeded() {
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(usersTable).values([lecturer, ...students]);
  await db.insert(coursesTable).values([...seedCourses]);

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + 45 * 60 * 1000);
  await db.insert(sessionsTable).values({
    id: "session-csc401-today",
    courseId: "course-csc401",
    room: "LT 2",
    token: "qr-session-csc401-today",
    status: "active",
    startsAt,
    endsAt,
  });
}

async function getCourseSummary(course: typeof coursesTable.$inferSelect) {
  const [studentCount, sessionCount, attendanceCount, activeSession] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(usersTable)
        .where(eq(usersTable.role, "student")),
      db
        .select({ value: count() })
        .from(sessionsTable)
        .where(eq(sessionsTable.courseId, course.id)),
      db
        .select({ value: count() })
        .from(attendanceTable)
        .where(eq(attendanceTable.courseId, course.id)),
      db
        .select()
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.courseId, course.id),
            eq(sessionsTable.status, "active"),
          ),
        )
        .orderBy(desc(sessionsTable.startsAt))
        .limit(1),
    ]);

  const totalStudents = Number(studentCount[0]?.value ?? 0);
  const sessions = Number(sessionCount[0]?.value ?? 0);
  const records = Number(attendanceCount[0]?.value ?? 0);
  const rate =
    sessions > 0 && totalStudents > 0
      ? Math.round((records / (sessions * totalStudents)) * 100)
      : 0;
  const nextClass = activeSession[0]?.startsAt ?? null;

  return {
    id: course.id,
    code: course.code,
    title: course.title,
    department: course.department,
    lecturerId: course.lecturerId,
    lecturerName: lecturer.name,
    color: course.color,
    studentsEnrolled: totalStudents,
    attendanceRate: rate,
    nextClass: nextClass ? parseDate(nextClass) : null,
    activeSessionId: activeSession[0]?.id ?? null,
  };
}

async function sessionResponse(session: typeof sessionsTable.$inferSelect) {
  const [course, recordCount, studentCount] = await Promise.all([
    db
      .select()
      .from(coursesTable)
      .where(eq(coursesTable.id, session.courseId))
      .limit(1),
    db
      .select({ value: count() })
      .from(attendanceTable)
      .where(eq(attendanceTable.sessionId, session.id)),
    db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "student")),
  ]);

  const totalStudents = Number(studentCount[0]?.value ?? 0);
  const scanCount = Number(recordCount[0]?.value ?? 0);
  return {
    id: session.id,
    courseId: session.courseId,
    courseCode: course[0]?.code ?? "",
    courseTitle: course[0]?.title ?? "",
    room: session.room,
    status: currentSessionStatus(session),
    token: session.token,
    startsAt: parseDate(session.startsAt),
    endsAt: parseDate(session.endsAt),
    scanCount,
    totalStudents,
    attendanceRate:
      totalStudents > 0 ? Math.round((scanCount / totalStudents) * 100) : 0,
  };
}

function errorResponse(res: Response, status: number, error: string) {
  return res.status(status).json({ error });
}

async function findStudent(studentId: string) {
  const result = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, studentId), eq(usersTable.role, "student")))
    .limit(1);
  return result[0];
}

router.get("/me", async (_req, res) => {
  await ensureSeeded();
  res.json(lecturer);
});

router.get("/dashboard/summary", async (_req, res) => {
  await ensureSeeded();
  const [studentCount, courseCount, todayRecords, allRecords, recent] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(usersTable)
        .where(eq(usersTable.role, "student")),
      db.select({ value: count() }).from(coursesTable),
      db
        .select({ value: count() })
        .from(attendanceTable)
        .where(eq(attendanceTable.status, "present")),
      db.select({ value: count() }).from(attendanceTable),
      db
        .select({
          id: attendanceTable.id,
          studentId: attendanceTable.studentId,
          scannedAt: attendanceTable.scannedAt,
          courseId: attendanceTable.courseId,
        })
        .from(attendanceTable)
        .orderBy(desc(attendanceTable.scannedAt))
        .limit(5),
    ]);

  const studentTotal = Number(studentCount[0]?.value ?? 0);
  const courseTotal = Number(courseCount[0]?.value ?? 0);
  const recordsToday = Number(todayRecords[0]?.value ?? 0);
  const allAttendance = Number(allRecords[0]?.value ?? 0);
  const courseRows = await db.select().from(coursesTable);
  const recentActivity = await Promise.all(
    recent.map(async (item) => {
      const [student, course] = await Promise.all([
        db
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, item.studentId))
          .limit(1),
        db
          .select({ code: coursesTable.code })
          .from(coursesTable)
          .where(eq(coursesTable.id, item.courseId))
          .limit(1),
      ]);
      return {
        id: item.id,
        text: `${student[0]?.name ?? "Student"} checked in to ${course[0]?.code ?? "course"}`,
        timestamp: parseDate(item.scannedAt),
        type: "scan" as const,
      };
    }),
  );

  res.json({
    totalStudents: studentTotal,
    activeCourses: courseTotal,
    presentToday: recordsToday,
    attendanceRate:
      studentTotal > 0
        ? Math.round((allAttendance / (studentTotal * Math.max(courseTotal, 1))) * 100)
        : 0,
    trend: [
      { label: "Mon", value: 78 },
      { label: "Tue", value: 84 },
      { label: "Wed", value: 81 },
      { label: "Thu", value: 91 },
      { label: "Fri", value: 88 },
    ],
    recentActivity:
      recentActivity.length > 0
        ? recentActivity
        : courseRows.slice(0, 3).map((course, index) => ({
            id: `course-activity-${course.id}`,
            text: `${course.code} is ready for attendance`,
            timestamp: new Date(Date.now() - index * 60 * 60 * 1000).toISOString(),
            type: "session" as const,
          })),
  });
});

router.get("/courses", async (req, res) => {
  await ensureSeeded();
  const { role } = ListCoursesQueryParams.parse(req.query);
  const courses = await db.select().from(coursesTable);
  const filtered =
    role === "student"
      ? courses
      : courses.filter((course) => course.lecturerId === lecturer.id);
  res.json(await Promise.all(filtered.map(getCourseSummary)));
});

router.post("/courses", async (req, res) => {
  await ensureSeeded();
  const body = CreateCourseBody.parse(req.body);
  const course = {
    id: `course-${randomUUID()}`,
    code: body.code.toUpperCase(),
    title: body.title,
    department: body.department,
    lecturerId: lecturer.id,
    color: body.color ?? "teal",
  };
  await db.insert(coursesTable).values(course);
  res.status(201).json(await getCourseSummary(course));
});

router.get("/courses/:courseId", async (req, res) => {
  await ensureSeeded();
  const { courseId } = GetCourseParams.parse(req.params);
  const course = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .limit(1);
  if (!course[0]) return errorResponse(res, 404, "Course not found");
  return res.json(await getCourseSummary(course[0]));
});

router.post("/courses/:courseId/sessions", async (req, res) => {
  await ensureSeeded();
  const { courseId } = CreateSessionParams.parse(req.params);
  const body = CreateSessionBody.parse(req.body);
  const course = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .limit(1);
  if (!course[0]) return errorResponse(res, 404, "Course not found");

  const startsAt = new Date();
  const endsAt = new Date(
    startsAt.getTime() + (body.durationMinutes ?? 30) * 60 * 1000,
  );
  const session = {
    id: `session-${randomUUID()}`,
    courseId,
    room: body.room,
    token: `qr-${randomUUID()}`,
    status: "active",
    startsAt,
    endsAt,
  };
  await db.insert(sessionsTable).values(session);
  return res.status(201).json(await sessionResponse(session));
});

router.get("/sessions/:sessionId", async (req, res) => {
  await ensureSeeded();
  const { sessionId } = GetSessionParams.parse(req.params);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  return res.json(await sessionResponse(session[0]));
});

router.post("/sessions/:sessionId/end", async (req, res) => {
  await ensureSeeded();
  const { sessionId } = EndSessionParams.parse(req.params);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  const [updated] = await db
    .update(sessionsTable)
    .set({ status: "ended" })
    .where(eq(sessionsTable.id, sessionId))
    .returning();
  return res.json(await sessionResponse(updated));
});

router.get("/sessions/:sessionId/attendance", async (req, res) => {
  await ensureSeeded();
  const { sessionId } = ListSessionAttendanceParams.parse(req.params);
  const records = await db
    .select({
      id: attendanceTable.id,
      studentId: attendanceTable.studentId,
      studentName: usersTable.name,
      matricNumber: usersTable.matricNumber,
      courseId: attendanceTable.courseId,
      courseCode: coursesTable.code,
      sessionId: attendanceTable.sessionId,
      scannedAt: attendanceTable.scannedAt,
      status: attendanceTable.status,
    })
    .from(attendanceTable)
    .innerJoin(usersTable, eq(usersTable.id, attendanceTable.studentId))
    .innerJoin(coursesTable, eq(coursesTable.id, attendanceTable.courseId))
    .where(eq(attendanceTable.sessionId, sessionId))
    .orderBy(desc(attendanceTable.scannedAt));
  res.json(
    records.map((record) => ({
      ...record,
      matricNumber: record.matricNumber ?? "",
      scannedAt: parseDate(record.scannedAt),
      status: record.status as "present" | "late" | "rejected",
    })),
  );
});

router.post("/sessions/:sessionId/scan", async (req, res) => {
  await ensureSeeded();
  const { sessionId } = ScanAttendanceParams.parse(req.params);
  const body = ScanAttendanceBody.parse(req.body);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  const status = currentSessionStatus(session[0]);
  if (status !== "active") return errorResponse(res, 400, "This session is no longer active");
  if (body.qrToken !== session[0].token) {
    return errorResponse(res, 400, "This QR code is not valid for the active session");
  }
  const student = await findStudent(body.studentId);
  if (!student) return errorResponse(res, 400, "Student identity was not found");

  const duplicate = await db
    .select({ id: attendanceTable.id })
    .from(attendanceTable)
    .where(
      and(
        eq(attendanceTable.sessionId, sessionId),
        eq(attendanceTable.studentId, body.studentId),
      ),
    )
    .limit(1);
  if (duplicate[0]) return errorResponse(res, 400, "Attendance already recorded for this session");

  const [created] = await db
    .insert(attendanceTable)
    .values({
      id: `attendance-${randomUUID()}`,
      studentId: body.studentId,
      courseId: session[0].courseId,
      sessionId,
      status: "present",
    })
    .returning();
  const [course] = await db
    .select({ code: coursesTable.code })
    .from(coursesTable)
    .where(eq(coursesTable.id, created.courseId))
    .limit(1);
  return res.status(201).json({
    id: created.id,
    studentId: student.id,
    studentName: student.name,
    matricNumber: student.matricNumber ?? "",
    courseId: created.courseId,
    courseCode: course?.code ?? "",
    sessionId: created.sessionId,
    scannedAt: parseDate(created.scannedAt),
    status: "present",
  });
});

router.get("/reports/attendance", async (req, res) => {
  await ensureSeeded();
  const { courseId } = GetAttendanceReportQueryParams.parse(req.query);
  const courses = await db
    .select()
    .from(coursesTable)
    .where(courseId ? eq(coursesTable.id, courseId) : undefined);
  const report = await Promise.all(
    courses.map(async (course) => {
      const [studentsCount, sessionsCount, attendanceCount] = await Promise.all([
        db
          .select({ value: count() })
          .from(usersTable)
          .where(eq(usersTable.role, "student")),
        db
          .select({ value: count() })
          .from(sessionsTable)
          .where(eq(sessionsTable.courseId, course.id)),
        db
          .select({ value: count() })
          .from(attendanceTable)
          .where(eq(attendanceTable.courseId, course.id)),
      ]);
      const totalStudents = Number(studentsCount[0]?.value ?? 0);
      const totalSessions = Number(sessionsCount[0]?.value ?? 0);
      const present = Number(attendanceCount[0]?.value ?? 0);
      return {
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        present,
        absent: Math.max(totalStudents * totalSessions - present, 0),
        totalSessions,
        attendanceRate:
          totalStudents * totalSessions > 0
            ? Math.round((present / (totalStudents * totalSessions)) * 100)
            : 0,
      };
    }),
  );
  res.json(report);
});

router.get("/students/:studentId/attendance", async (req, res) => {
  await ensureSeeded();
  const { studentId } = GetStudentAttendanceParams.parse(req.params);
  const records = await db
    .select({
      id: attendanceTable.id,
      studentId: attendanceTable.studentId,
      studentName: usersTable.name,
      matricNumber: usersTable.matricNumber,
      courseId: attendanceTable.courseId,
      courseCode: coursesTable.code,
      sessionId: attendanceTable.sessionId,
      scannedAt: attendanceTable.scannedAt,
      status: attendanceTable.status,
    })
    .from(attendanceTable)
    .innerJoin(usersTable, eq(usersTable.id, attendanceTable.studentId))
    .innerJoin(coursesTable, eq(coursesTable.id, attendanceTable.courseId))
    .where(eq(attendanceTable.studentId, studentId))
    .orderBy(desc(attendanceTable.scannedAt));
  res.json(
    records.map((record) => ({
      ...record,
      matricNumber: record.matricNumber ?? "",
      scannedAt: parseDate(record.scannedAt),
      status: record.status as "present" | "late" | "rejected",
    })),
  );
});

export default router;