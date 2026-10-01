import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
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
  UpdateCourseBody,
  UpdateCourseParams,
  UpdateUserRoleBody,
  UpdateUserRoleParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  attendanceTable,
  coursesTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";

const router: IRouter = Router();

router.use((req, res, next) => {
  if (!getAuth(req).userId) return res.status(401).json({ error: "Sign in is required" });
  return next();
});

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

  await db
    .insert(usersTable)
    .values([lecturer, ...students].map((user) => ({ ...user, isDemo: true })));
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

async function getAppUser(req: Request) {
  const clerkId = getAuth(req).userId;
  if (!clerkId) return null;

  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkId))
    .limit(1);
  if (existing[0]) return await assignConfiguredAdmin(existing[0]);

  const identity = await clerkClient.users.getUser(clerkId);
  const emailRecord =
    identity.emailAddresses.find(
      (email) => email.id === identity.primaryEmailAddressId,
    ) ??
    identity.emailAddresses.find(
      (email) => email.verification?.status === "verified",
    );
  if (!emailRecord || emailRecord.verification?.status !== "verified") {
    throw new Error("Verify an email address before using this attendance system.");
  }

  const normalizedEmail = emailRecord.emailAddress.toLowerCase();
  const emailMatch = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.email, normalizedEmail), eq(usersTable.isDemo, false)))
    .limit(1);
  if (emailMatch[0]) {
    const [linked] = await db
      .update(usersTable)
      .set({ clerkUserId: clerkId })
      .where(eq(usersTable.id, emailMatch[0].id))
      .returning();
    return await assignConfiguredAdmin(linked);
  }

  const demoEmailMatch = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.email, normalizedEmail), eq(usersTable.isDemo, true)))
    .limit(1);
  if (demoEmailMatch[0]) {
    throw new Error(
      "This email belongs to a demonstration profile. Sign up with an email address you control.",
    );
  }

  const name =
    identity.fullName?.trim() ||
    [identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
    normalizedEmail.split("@")[0] ||
    "Student";
  const [created] = await db
    .insert(usersTable)
    .values({
      id: clerkId,
      clerkUserId: clerkId,
      name,
      email: normalizedEmail,
      role: "student",
      initials: name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join(""),
      matricNumber: null,
      department: "Computer Science",
      isDemo: false,
    })
    .returning();
  return await assignConfiguredAdmin(created);
}

async function assignConfiguredAdmin(user: typeof usersTable.$inferSelect) {
  const adminEmail = process.env.ATTENDANCE_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail || user.isDemo || user.email.toLowerCase() !== adminEmail) {
    return user;
  }

  const existingAdmin = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.isDemo, false)))
    .limit(1);
  if (existingAdmin[0]) return user;

  const [promoted] = await db
    .update(usersTable)
    .set({ role: "admin" })
    .where(eq(usersTable.id, user.id))
    .returning();
  return promoted ?? user;
}

function hasRole(user: typeof usersTable.$inferSelect, ...roles: string[]) {
  return roles.includes(user.role);
}

function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.initials,
    matricNumber: user.matricNumber,
    department: user.department,
  };
}

async function getCourseSummary(course: typeof coursesTable.$inferSelect) {
  const [studentCount, sessionCount, attendanceCount, activeSession, lecturerRow] =
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
            gt(sessionsTable.endsAt, new Date()),
          ),
        )
        .orderBy(desc(sessionsTable.startsAt))
        .limit(1),
      db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, course.lecturerId))
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
    lecturerName: lecturerRow[0]?.name ?? "Assigned lecturer",
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
    token: `${session.id}.${session.token}`,
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
  try {
    const user = await getAppUser(_req);
    if (!user) return errorResponse(res, 401, "Sign in is required");
    return res.json(publicUser(user));
  } catch (error) {
    return errorResponse(
      res,
      403,
      error instanceof Error ? error.message : "Unable to load your account",
    );
  }
});

router.get("/admin/users", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "admin")) {
    return errorResponse(res, 403, "Administrator access is required");
  }
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.isDemo, false))
    .orderBy(usersTable.name);
  return res.json(users.map(publicUser));
});

router.patch("/admin/users/:userId/role", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "admin")) {
    return errorResponse(res, 403, "Administrator access is required");
  }
  const { userId } = UpdateUserRoleParams.parse(req.params);
  const { role } = UpdateUserRoleBody.parse(req.body);
  if (userId === user.id && role !== "admin") {
    return errorResponse(res, 400, "You cannot remove your own administrator role");
  }
  const [updated] = await db
    .update(usersTable)
    .set({ role })
    .where(and(eq(usersTable.id, userId), eq(usersTable.isDemo, false)))
    .returning();
  if (!updated) return errorResponse(res, 404, "User not found");
  return res.json(publicUser(updated));
});

router.get("/dashboard/summary", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "admin", "lecturer")) {
    return errorResponse(res, 403, "Lecturer access is required to view the dashboard");
  }
  const allCourses = await db.select().from(coursesTable);
  const courseRows = hasRole(user, "admin")
    ? allCourses
    : allCourses.filter((course) => course.lecturerId === user.id);
  const courseIds = courseRows.map((course) => course.id);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [studentCount, todayRecords, allRecords, recent] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(usersTable)
        .where(eq(usersTable.role, "student")),
      db
        .select({ value: count() })
        .from(attendanceTable)
        .where(
          and(
            eq(attendanceTable.status, "present"),
            gte(attendanceTable.scannedAt, dayStart),
            inArray(attendanceTable.courseId, courseIds),
          ),
        ),
      db
        .select({ value: count() })
        .from(attendanceTable)
        .where(inArray(attendanceTable.courseId, courseIds)),
      db
        .select({
          id: attendanceTable.id,
          studentId: attendanceTable.studentId,
          scannedAt: attendanceTable.scannedAt,
          courseId: attendanceTable.courseId,
        })
        .from(attendanceTable)
        .where(inArray(attendanceTable.courseId, courseIds))
        .orderBy(desc(attendanceTable.scannedAt))
        .limit(5),
    ]);

  const studentTotal = Number(studentCount[0]?.value ?? 0);
  const courseTotal = courseRows.length;
  const recordsToday = Number(todayRecords[0]?.value ?? 0);
  const allAttendance = Number(allRecords[0]?.value ?? 0);
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

  return res.json({
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
  const user = await getAppUser(req);
  if (!user) return errorResponse(res, 401, "Sign in is required");
  ListCoursesQueryParams.parse(req.query);
  const courses = await db.select().from(coursesTable);
  const filtered = hasRole(user, "admin")
    ? courses
    : user.role === "student"
      ? courses
      : courses.filter((course) => course.lecturerId === user.id);
  return res.json(await Promise.all(filtered.map(getCourseSummary)));
});

router.post("/courses", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "lecturer", "admin")) {
    return errorResponse(res, 403, "Lecturer access is required to create a course");
  }
  const body = CreateCourseBody.parse(req.body);
  const course = {
    id: `course-${randomUUID()}`,
    code: body.code.toUpperCase(),
    title: body.title,
    department: body.department,
    lecturerId: user.id,
    color: body.color ?? "teal",
  };
  await db.insert(coursesTable).values(course);
  return res.status(201).json(await getCourseSummary(course));
});

router.get("/courses/:courseId", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user) return errorResponse(res, 401, "Sign in is required");
  const { courseId } = GetCourseParams.parse(req.params);
  const course = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .limit(1);
  if (!course[0]) return errorResponse(res, 404, "Course not found");
  if (!hasRole(user, "admin", "student") && course[0].lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not have access to this course");
  }
  return res.json(await getCourseSummary(course[0]));
});

router.patch("/courses/:courseId", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "lecturer", "admin")) {
    return errorResponse(res, 403, "Lecturer access is required to edit a course");
  }
  const { courseId } = UpdateCourseParams.parse(req.params);
  const body = UpdateCourseBody.parse(req.body);
  const course = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .limit(1);
  if (!course[0]) return errorResponse(res, 404, "Course not found");
  if (!hasRole(user, "admin") && course[0].lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not own this course");
  }
  const [updated] = await db
    .update(coursesTable)
    .set(body)
    .where(eq(coursesTable.id, courseId))
    .returning();
  return res.json(await getCourseSummary(updated));
});

router.delete("/courses/:courseId", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "lecturer", "admin")) {
    return errorResponse(res, 403, "Lecturer access is required to delete a course");
  }
  const { courseId } = UpdateCourseParams.parse(req.params);
  const course = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .limit(1);
  if (!course[0]) return errorResponse(res, 404, "Course not found");
  if (!hasRole(user, "admin") && course[0].lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not own this course");
  }
  const courseSessions = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.courseId, courseId))
    .limit(1);
  if (courseSessions[0]) {
    return errorResponse(res, 409, "Courses with session history cannot be deleted");
  }
  await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
  return res.status(204).send();
});

router.post("/courses/:courseId/sessions", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "lecturer", "admin")) {
    return errorResponse(res, 403, "Lecturer access is required to start a session");
  }
  const { courseId } = CreateSessionParams.parse(req.params);
  const body = CreateSessionBody.parse(req.body);
  const course = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .limit(1);
  if (!course[0]) return errorResponse(res, 404, "Course not found");
  if (!hasRole(user, "admin") && course[0].lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not own this course");
  }

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
  const user = await getAppUser(req);
  if (!user) return errorResponse(res, 401, "Sign in is required");
  const { sessionId } = GetSessionParams.parse(req.params);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  const sessionCourse = await db.select().from(coursesTable).where(eq(coursesTable.id, session[0].courseId)).limit(1);
  if (!hasRole(user, "admin", "student") && sessionCourse[0]?.lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not have access to this session");
  }
  const response = await sessionResponse(session[0]);
  return res.json(user.role === "student" ? { ...response, token: "" } : response);
});

router.post("/sessions/:sessionId/end", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "lecturer", "admin")) {
    return errorResponse(res, 403, "Lecturer access is required to end a session");
  }
  const { sessionId } = EndSessionParams.parse(req.params);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  const sessionCourse = await db.select().from(coursesTable).where(eq(coursesTable.id, session[0].courseId)).limit(1);
  if (!hasRole(user, "admin") && sessionCourse[0]?.lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not own this session");
  }
  const [updated] = await db
    .update(sessionsTable)
    .set({ status: "ended" })
    .where(eq(sessionsTable.id, sessionId))
    .returning();
  return res.json(await sessionResponse(updated));
});

router.get("/sessions/:sessionId/attendance", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user) return errorResponse(res, 401, "Sign in is required");
  const { sessionId } = ListSessionAttendanceParams.parse(req.params);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  const course = await db
    .select({ lecturerId: coursesTable.lecturerId })
    .from(coursesTable)
    .where(eq(coursesTable.id, session[0].courseId))
    .limit(1);
  if (!course[0] || (!hasRole(user, "admin") && course[0].lecturerId !== user.id)) {
    return errorResponse(res, 403, "Only the course lecturer or an administrator can view this list");
  }
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
  return res.json(
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
  const user = await getAppUser(req);
  if (!user) return errorResponse(res, 401, "Sign in is required");
  const { sessionId } = ScanAttendanceParams.parse(req.params);
  const body = ScanAttendanceBody.parse(req.body);
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  if (!session[0]) return errorResponse(res, 404, "Session not found");
  const sessionCourse = await db.select().from(coursesTable).where(eq(coursesTable.id, session[0].courseId)).limit(1);
  if (user.role === "student" && user.id !== body.studentId) {
    return errorResponse(res, 403, "Students may only check in for their own account");
  }
  if (user.role === "lecturer" && sessionCourse[0]?.lecturerId !== user.id) {
    return errorResponse(res, 403, "You do not own this session");
  }
  if (!hasRole(user, "admin", "lecturer", "student")) {
    return errorResponse(res, 403, "This account cannot check in to attendance");
  }
  const status = currentSessionStatus(session[0]);
  if (status !== "active") return errorResponse(res, 400, "This session is no longer active");
  const qrPayload = `${session[0].id}.${session[0].token}`;
  if (body.qrToken !== session[0].token && body.qrToken !== qrPayload) {
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
    .onConflictDoNothing({
      target: [attendanceTable.sessionId, attendanceTable.studentId],
    })
    .returning();
  if (!created) {
    return errorResponse(res, 409, "Attendance already recorded for this session");
  }
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
  const user = await getAppUser(req);
  if (!user || !hasRole(user, "admin", "lecturer")) {
    return errorResponse(res, 403, "Lecturer access is required to view reports");
  }
  const { courseId } = GetAttendanceReportQueryParams.parse(req.query);
  const allCourses = await db.select().from(coursesTable);
  const visibleCourses = allCourses.filter(
    (course) => hasRole(user, "admin") || course.lecturerId === user.id,
  );
  if (
    courseId &&
    allCourses.some((course) => course.id === courseId) &&
    !visibleCourses.some((course) => course.id === courseId)
  ) {
    return errorResponse(res, 403, "You do not have access to this course report");
  }
  const courses = visibleCourses.filter(
    (course) => !courseId || course.id === courseId,
  );
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
  return res.json(report);
});

router.get("/students/:studentId/attendance", async (req, res) => {
  await ensureSeeded();
  const user = await getAppUser(req);
  if (!user) return errorResponse(res, 401, "Sign in is required");
  const { studentId } = GetStudentAttendanceParams.parse(req.params);
  if (!hasRole(user, "admin") && user.id !== studentId) {
    return errorResponse(res, 403, "You may only view your own attendance history");
  }
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
  return res.json(
    records.map((record) => ({
      ...record,
      matricNumber: record.matricNumber ?? "",
      scannedAt: parseDate(record.scannedAt),
      status: record.status as "present" | "late" | "rejected",
    })),
  );
});

export default router;