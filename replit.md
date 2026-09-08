# QR Attendance Management System

An attendance command center for universities where lecturers create expiring QR sessions, validate student presence, and review live attendance reports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/qr-attendance` — responsive React/Vite application and primary user experience.
- `artifacts/api-server/src/routes/attendance.ts` — attendance API, demo seed data, session/token validation, and report aggregation.
- `lib/api-spec/openapi.yaml` — source of truth for the generated API hooks and validation schemas.
- `lib/db/src/schema/attendance.ts` — PostgreSQL/Drizzle schema for users, courses, sessions, and attendance records.

## Architecture decisions

- Attendance is bound to an active, time-limited session token rather than relying on a static student QR alone.
- Duplicate scans are prevented by both an application check and a database unique index on session/student.
- The first build uses seeded demo users and courses so the product can be evaluated immediately; authentication is intentionally kept behind the future managed sign-in boundary.
- The frontend consumes generated OpenAPI React Query hooks rather than hand-written fetch calls.

## Product

- Lecturer overview dashboard with attendance rate, activity, and course summaries.
- Live session creation, QR token display, scan validation, and end-session controls.
- Course management, attendance reports with filtering/export affordance, and student attendance history.
- Student view with identity QR presentation and personal attendance records.

## User preferences

No additional preferences recorded.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.
- Start or restart the managed API and web workflows rather than running root-level dev commands.
- The demo API seeds its initial records on the first request after the schema is pushed.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
