import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Html5Qrcode } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, Check, ChevronRight, CircleAlert,
  Download, LayoutDashboard, LogOut, Menu, MoreHorizontal, QrCode, Radio, RefreshCw, ScanLine,
  Search, Settings2, ShieldCheck, Sparkles, UsersRound, X, DoorOpen, CalendarDays, Shield,
  Camera, UserRoundCog, Pencil, Trash2,
} from 'lucide-react';
import {
  useGetCurrentUser, useGetDashboardSummary, useListCourses, useCreateSession, useGetSession,
  useEndSession, useListSessionAttendance, useScanAttendance, useGetAttendanceReport,
  useGetStudentAttendance, useCreateCourse, useUpdateCourse, useDeleteCourse,
  useListUsers, useUpdateUserRole,
  useIssueStudentQr,
  getGetDashboardSummaryQueryKey, getGetCurrentUserQueryKey, getListCoursesQueryKey, getListUsersQueryKey,
  getGetSessionQueryKey, getListSessionAttendanceQueryKey, getGetAttendanceReportQueryKey,
  getGetStudentAttendanceQueryKey,
  type UserRoleInputRole,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import NotFound from '@/pages/not-found';
import { type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2f998b',
    colorForeground: '#1d2833',
    colorMutedForeground: '#64717c',
    colorDanger: '#c74747',
    colorBackground: '#ffffff',
    colorInput: '#ffffff',
    colorInputForeground: '#1d2833',
    colorNeutral: '#d9e0e5',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-slate-900 font-bold',
    headerSubtitle: 'text-slate-600',
    socialButtonsBlockButtonText: 'text-slate-800 font-semibold',
    formFieldLabel: 'text-slate-800 font-semibold',
    footerActionLink: 'text-teal-700 font-semibold',
    footerActionText: 'text-slate-600',
    dividerText: 'text-slate-500',
    identityPreviewEditButton: 'text-teal-700',
    formFieldSuccessText: 'text-emerald-700',
    alertText: 'text-red-700',
    logoBox: 'rounded-lg overflow-hidden',
    logoImage: 'h-9 w-9',
    socialButtonsBlockButton: 'rounded-xl border-slate-200',
    formButtonPrimary: 'rounded-xl font-semibold',
    formFieldInput: 'rounded-xl border-slate-200 text-slate-900',
    footerAction: 'text-slate-600',
    dividerLine: 'bg-slate-200',
    alert: 'rounded-xl',
    otpCodeFieldInput: 'rounded-lg border-slate-200 text-slate-900',
    formFieldRow: 'gap-1',
    main: 'text-slate-900',
  },
};

type AnyRecord = Record<string, any>;

const courseFormSchema = z.object({
  code: z.string().trim().min(2, 'Enter a course code').max(24),
  title: z.string().trim().min(2, 'Enter a course title').max(120),
  department: z.string().trim().min(2, 'Enter a department').max(120),
  color: z.enum(['teal', 'amber', 'violet', 'blue']),
});
type CourseFormValues = z.infer<typeof courseFormSchema>;

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/sessions', label: 'Sessions', icon: Radio },
  { href: '/courses', label: 'Courses', icon: BookOpen },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/student', label: 'Student view', icon: QrCode },
  { href: '/admin', label: 'User access', icon: UserRoundCog },
];

function cx(...parts: Array<string | false | undefined>) { return parts.filter(Boolean).join(' '); }
function formatTime(value?: string | null) { if (!value) return '—'; try { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); } catch { return value; } }
function formatDate(value?: string | null) { if (!value) return '—'; try { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); } catch { return value; } }
function initials(name?: string) { return name?.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'AD'; }

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'live' | 'warn' | 'danger' | 'good' }) {
  const styles = { neutral: 'bg-muted text-muted-foreground', live: 'bg-primary/12 text-primary', warn: 'bg-accent/25 text-foreground', danger: 'bg-destructive/12 text-destructive', good: 'bg-emerald-100 text-emerald-700' };
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.1em]', styles[tone])}>{tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}{children}</span>;
}

function ProgressBar({ value, color = 'bg-primary' }: { value: number; color?: string }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function Skeleton({ className = '' }: { className?: string }) { return <div className={cx('skeleton rounded-lg', className)} />; }

function EmptyState({ icon: Icon = InboxIcon, title, body, action }: { icon?: any; title: string; body: string; action?: ReactNode }) {
  return <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 text-center">
    <div className="mb-4 rounded-2xl bg-primary/10 p-3 text-primary"><Icon size={22} /></div>
    <h3 className="font-display text-xl text-foreground">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>{action && <div className="mt-5">{action}</div>}
  </div>;
}
function InboxIcon(props: any) { return <Activity {...props} />; }

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { signOut } = useClerk();
  const { data: user } = useGetCurrentUser();
  const current = user as AnyRecord | undefined;
  const visibleNavItems = current?.role === 'student'
    ? navItems.filter(item => item.href === '/student' || item.href === '/courses')
    : navItems.filter(item => item.href !== '/student' && (current?.role === 'admin' || item.href !== '/admin'));
  return <div className="min-h-[100dvh] bg-background text-foreground">
    <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 transition-transform lg:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center gap-3 px-3 pb-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><ScanLine size={19} strokeWidth={2.5} /></div>
        <div><div className="font-display text-lg font-bold tracking-tight text-sidebar-accent-foreground">Attend<span className="text-sidebar-primary">ly</span></div><div className="font-mono-ui text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/55">presence, verified</div></div>
      </div>
      <div className="mb-3 px-3 font-mono-ui text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/45">Command center</div>
      <nav className="space-y-1">
        {visibleNavItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={() => setMobileOpen(false)} className={cx('group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', location === href || (href !== '/' && location.startsWith(`${href}/`)) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground')}><Icon size={17} /><span>{label}</span>{href === '/sessions' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary" />}</Link>)}
      </nav>
      <div className="mt-auto">
        <div className="mb-5 rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-3">
          <div className="flex items-center gap-2 text-sidebar-foreground"><ShieldCheck size={15} className="text-sidebar-primary" /><span className="text-xs font-semibold">Verification healthy</span></div>
          <p className="mt-1.5 text-[11px] leading-4 text-sidebar-foreground/55">QR validation service is online and ready for today.</p>
        </div>
        <Link href="/settings" data-testid="link-nav-settings" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary/20 text-xs font-bold text-sidebar-primary">{current?.initials || 'AC'}</div><div className="min-w-0"><div className="truncate text-xs font-semibold">{current?.name || 'Your account'}</div><div className="truncate text-[10px] capitalize text-sidebar-foreground/45">{current?.role || 'loading'}</div></div><Settings2 size={15} className="ml-auto" />
        </Link>
      </div>
    </aside>
    {mobileOpen && <button aria-label="Close menu" data-testid="button-close-menu" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" />}
    <main className="min-h-[100dvh] lg:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-md sm:px-8">
        <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={20} /></button>
        <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span>{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span><span className="text-border">/</span><span className="font-mono-ui text-[11px] text-primary">LIVE ACADEMIC DAY</span></div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground md:flex"><Activity size={14} className="text-primary" /> All systems operational</div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-xs font-bold text-primary" data-testid="avatar-current-user">{current?.initials || 'AC'}</div>
          <button onClick={() => signOut({ redirectUrl: basePath || '/' })} aria-label="Sign out" title="Sign out" data-testid="button-sign-out" className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"><LogOut size={17} /></button>
        </div>
      </header>
      <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9">{children}</div>
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, body, action }: { eyebrow: string; title: string; body?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-2 font-mono-ui text-[10px] uppercase tracking-[.2em] text-primary">{eyebrow}</div><h1 className="font-display text-4xl font-bold tracking-[-.035em] text-foreground sm:text-5xl">{title}</h1>{body && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>}</div>{action && <div className="shrink-0">{action}</div>}</div>;
}

function PrimaryButton({ children, onClick, testId, variant = 'primary', disabled = false, type = 'button' }: { children: ReactNode; onClick?: () => void; testId: string; variant?: 'primary' | 'quiet' | 'danger'; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} disabled={disabled} onClick={onClick} data-testid={testId} className={cx('inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50', variant === 'primary' && 'bg-primary text-primary-foreground shadow-sm hover:brightness-95', variant === 'quiet' && 'border border-border bg-card text-foreground hover:bg-muted', variant === 'danger' && 'bg-destructive text-destructive-foreground hover:brightness-95')}>{children}</button>;
}

function StartSessionDialog({ courseId, courseCode, courseTitle, onClose }: { courseId: string; courseCode: string; courseTitle: string; onClose: () => void }) {
  const [, setLocation] = useLocation(); const client = useQueryClient(); const create = useCreateSession();
  const [room, setRoom] = useState('LT-204'); const [duration, setDuration] = useState('75');
  const submit = () => create.mutate({ courseId, data: { room, durationMinutes: Number(duration) } }, { onSuccess: (session: any) => { client.invalidateQueries({ queryKey: getListCoursesQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); onClose(); setLocation(`/sessions/${session.id}`); } });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in">
    <div className="flex items-start justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary">Start a live session</div><h2 className="mt-1 font-display text-2xl">Open the room</h2><p className="mt-1 text-sm text-muted-foreground">{courseCode} · {courseTitle}</p></div><button onClick={onClose} data-testid="button-close-session-dialog" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button></div>
    <div className="mt-7 space-y-4"><label className="block text-sm font-semibold">Room or location<input value={room} onChange={e => setRoom(e.target.value)} data-testid="input-session-room" className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none ring-primary/20 focus:ring-4" /></label><label className="block text-sm font-semibold">Session length<select value={duration} onChange={e => setDuration(e.target.value)} data-testid="select-session-duration" className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none ring-primary/20 focus:ring-4"><option value="45">45 minutes</option><option value="75">75 minutes</option><option value="120">2 hours</option></select></label></div>
    {create.isError && <div className="mt-4 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive"><CircleAlert size={15} /> Could not start this session. Try again.</div>}<div className="mt-7 flex justify-end gap-2"><PrimaryButton variant="quiet" testId="button-cancel-session" onClick={onClose}>Cancel</PrimaryButton><PrimaryButton testId="button-confirm-start-session" onClick={submit} disabled={create.isPending}>{create.isPending ? 'Opening room…' : <><Radio size={16} /> Start session</>}</PrimaryButton></div>
  </div></div>;
}

function MetricCard({ label, value, hint, icon: Icon, accent = 'primary', trend }: { label: string; value: ReactNode; hint: string; icon: any; accent?: string; trend?: 'up' | 'down' }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_2px_12px_hsl(222_30%_16%_/.03)] animate-in"><div className="flex items-start justify-between"><div className={cx('rounded-xl p-2.5', accent === 'amber' ? 'bg-accent/25 text-foreground' : accent === 'blue' ? 'bg-sky-100 text-sky-700' : 'bg-primary/12 text-primary')}><Icon size={19} /></div>{trend && <span className={cx('flex items-center gap-1 text-[11px] font-bold', trend === 'up' ? 'text-emerald-600' : 'text-destructive')}>{trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} 4.8%</span>}</div><div className="mt-5 text-3xl font-bold tracking-tight">{value}</div><div className="mt-1 text-xs font-semibold text-foreground/70">{label}</div><div className="mt-1 text-[11px] text-muted-foreground">{hint}</div></div>;
}

function Dashboard() {
  const { data, isLoading, isError, refetch } = useGetDashboardSummary(); const { data: courses } = useListCourses(); const [start, setStart] = useState<AnyRecord | null>(null);
  const summary = data as AnyRecord | undefined; const courseList = (courses as AnyRecord[] | undefined) || [];
  if (isLoading) return <><PageHeading eyebrow="Daily command center" title="Good morning." body="Loading today's attendance picture…" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-40" />)}</div><div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_.7fr]"><Skeleton className="h-80" /><Skeleton className="h-80" /></div></>;
  if (isError) return <EmptyState icon={CircleAlert} title="The dashboard is taking a moment" body="We couldn't retrieve today's summary. Check your connection and try again." action={<PrimaryButton testId="button-retry-dashboard" onClick={() => refetch()}><RefreshCw size={15} /> Retry</PrimaryButton>} />;
  const trend = summary?.trend || [];
  return <><PageHeading eyebrow="Daily command center" title="Good morning." body="A clear view of who is in the room, what needs attention, and where to begin." action={<PrimaryButton testId="button-open-session-dashboard" onClick={() => courseList[0] && setStart(courseList[0])}><Radio size={16} /> Start a session</PrimaryButton>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Present today" value={summary?.presentToday ?? '—'} hint={`of ${summary?.totalStudents ?? '—'} enrolled students`} icon={UsersRound} trend="up" />
      <MetricCard label="Attendance rate" value={summary ? `${summary.attendanceRate}%` : '—'} hint="Across active teaching days" icon={BarChart3} accent="blue" trend="up" />
      <MetricCard label="Active courses" value={summary?.activeCourses ?? '—'} hint="Courses on your teaching desk" icon={BookOpen} accent="amber" />
      <MetricCard label="Verification status" value={<span className="text-2xl">Healthy</span>} hint="QR service · synced just now" icon={ShieldCheck} />
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 animate-in delay-1"><div className="flex items-start justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Attendance pulse</div><h2 className="mt-1 font-display text-2xl">This week, at a glance</h2></div><span className="rounded-lg bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">Mon — Sun</span></div><div className="mt-8 flex h-48 items-end gap-2 sm:gap-4">{(trend.length ? trend : [{label:'Mon',value:0},{label:'Tue',value:0},{label:'Wed',value:0},{label:'Thu',value:0},{label:'Fri',value:0}]).map((point: AnyRecord, i: number) => <div key={point.label + i} className="flex min-w-0 flex-1 flex-col items-center gap-2"><div className="relative flex h-40 w-full items-end justify-center"><div className="w-full max-w-12 rounded-t-lg bg-primary/75 transition-all hover:bg-primary" style={{ height: `${Math.max(7, Math.min(100, Number(point.value) || 0))}%` }}><span className="sr-only">{point.value}</span></div></div><span className="text-[10px] font-semibold text-muted-foreground">{point.label}</span></div>)}</div><div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" />Average attendance across recorded sessions</div></section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 animate-in delay-2"><div className="flex items-center justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Activity log</div><h2 className="mt-1 font-display text-2xl">Recent movement</h2></div><Link href="/reports" data-testid="link-dashboard-reports" className="text-xs font-bold text-primary hover:underline">View reports</Link></div><div className="mt-5 space-y-1">{(summary?.recentActivity || []).length ? (summary?.recentActivity || []).slice(0, 5).map((item: AnyRecord) => <div key={item.id} className="flex gap-3 rounded-xl px-2 py-3 hover:bg-muted"><div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Activity size={14} /></div><div className="min-w-0"><p className="text-xs font-semibold leading-5">{item.text}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{item.timestamp}</p></div></div>) : <EmptyState title="No activity yet" body="Session scans and reports will appear here." />}</div></section>
    </div>
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6 animate-in delay-3"><div className="flex items-center justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">Teaching desk</div><h2 className="mt-1 font-display text-2xl">Your courses</h2></div><Link href="/courses" data-testid="link-dashboard-courses" className="flex items-center gap-1 text-xs font-bold text-primary">Manage courses <ChevronRight size={14} /></Link></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{courseList.slice(0, 3).map((course: AnyRecord) => <CourseRow key={course.id} course={course} onStart={() => setStart(course)} />)}</div>{!courseList.length && <div className="mt-5"><EmptyState icon={BookOpen} title="Your course list is quiet" body="Courses assigned to you will appear here." /></div>}</section>
    {start && <StartSessionDialog courseId={start.id} courseCode={start.code} courseTitle={start.title} onClose={() => setStart(null)} />}
  </>;
}

function CourseRow({ course, onStart }: { course: AnyRecord; onStart: () => void }) {
  const active = Boolean(course.activeSessionId); return <div className="group flex items-center gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold" style={{ backgroundColor: `${course.color || '#2f998b'}22`, color: course.color || '#2f998b' }}>{course.code?.slice(0, 2)}</div><div className="min-w-0 flex-1"><div className="font-mono-ui text-[11px] font-semibold text-primary">{course.code}</div><div className="truncate text-sm font-semibold">{course.title}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{course.studentsEnrolled} students · {course.attendanceRate}% attendance</div></div>{active ? <Link href={`/sessions/${course.activeSessionId}`} data-testid={`link-active-session-${course.id}`} className="rounded-lg bg-primary/10 px-2.5 py-2 text-[11px] font-bold text-primary">Live</Link> : <button onClick={onStart} data-testid={`button-start-course-${course.id}`} className="rounded-lg border border-border px-2.5 py-2 text-[11px] font-bold text-muted-foreground hover:border-primary hover:text-primary">Start</button>}</div>;
}

function SessionsPage() {
  const { data: courses, isLoading } = useListCourses(); const list = (courses as AnyRecord[] | undefined) || []; const [start, setStart] = useState<AnyRecord | null>(null);
  const active = list.filter(c => c.activeSessionId); return <><PageHeading eyebrow="Attendance sessions" title="The room, live." body="Start, monitor, and close the QR window for each class." action={<PrimaryButton testId="button-open-session-sessions" onClick={() => setStart(list[0] || null)}><Radio size={16} /> Start a session</PrimaryButton>} />
    <div className="mb-6 flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Radio size={17} /></span><div><div className="text-sm font-bold">{active.length || 'No'} active {active.length === 1 ? 'session' : 'sessions'}</div><div className="text-xs text-muted-foreground">{active.length ? 'Attendance windows currently accepting scans.' : 'Open a session when your class is ready.'}</div></div></div><span className="font-mono-ui text-xs text-primary">{active.length ? 'LIVE NOW' : 'STANDBY'}</span></div>
    <div className="mb-3 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground"><span>Active now</span><span className="h-px flex-1 bg-border" /></div>
    {isLoading ? <div className="grid gap-4 md:grid-cols-2">{[1,2].map(i => <Skeleton key={i} className="h-44" />)}</div> : active.length ? <div className="grid gap-4 md:grid-cols-2">{active.map(course => <SessionCard key={course.id} course={course} active />)}</div> : <EmptyState icon={Radio} title="No open rooms" body="Your active attendance sessions will appear in this space." action={<PrimaryButton testId="button-empty-start-session" onClick={() => list[0] && setStart(list[0])}>Open a room</PrimaryButton>} />}
    <div className="mb-3 mt-9 flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground"><span>Recent sessions</span><span className="h-px flex-1 bg-border" /></div><div className="rounded-2xl border border-border bg-card"><div className="hidden grid-cols-[1.4fr_.8fr_.6fr_.5fr] gap-4 border-b border-border px-5 py-3 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground sm:grid"><span>Course</span><span>When</span><span>Room</span><span>Result</span></div>{list.slice(0, 5).map((course, i) => <div key={`${course.id}-recent`} className="grid gap-2 border-b border-border px-5 py-4 last:border-0 sm:grid-cols-[1.4fr_.8fr_.6fr_.5fr] sm:items-center sm:gap-4"><div><div className="font-mono-ui text-[11px] font-semibold text-primary">{course.code}</div><div className="text-sm font-semibold">{course.title}</div></div><div className="text-xs text-muted-foreground">{course.nextClass ? formatDate(course.nextClass) : `${i + 1} day${i ? 's' : ''} ago`}</div><div className="text-xs text-muted-foreground">—</div><Badge tone={course.attendanceRate >= 75 ? 'good' : 'warn'}>{course.attendanceRate || '—'}%</Badge></div>)}</div>
    {start && <StartSessionDialog courseId={start.id} courseCode={start.code} courseTitle={start.title} onClose={() => setStart(null)} />}
  </>;
}

function SessionCard({ course }: { course: AnyRecord; active?: boolean }) {
  return <Link href={`/sessions/${course.activeSessionId}`} data-testid={`card-session-${course.id}`} className="group rounded-2xl border border-primary/25 bg-card p-5 shadow-[0_6px_24px_hsl(171_54%_39%_/.08)] transition-all hover:-translate-y-0.5 hover:border-primary/50"><div className="flex items-start justify-between"><Badge tone="live">Live now</Badge><MoreHorizontal size={18} className="text-muted-foreground" /></div><div className="mt-6 font-mono-ui text-xs font-semibold text-primary">{course.code}</div><div className="mt-1 font-display text-2xl">{course.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><UsersRound size={14} /> {course.studentsEnrolled} students expected <span className="text-border">·</span> QR accepting scans</div><div className="mt-6 flex items-center justify-between border-t border-border pt-4"><span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Radio size={14} /> Open session monitor</span><ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-1" /></div></Link>;
}

function SessionDetail() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const { data: session, isLoading, isError, refetch } = useGetSession(sessionId, {
    query: { queryKey: getGetSessionQueryKey(sessionId) },
  });
  const { data: user } = useGetCurrentUser();
  const currentUser = user as AnyRecord | undefined;
  const hasScanRole = currentUser?.role === 'admin' || currentUser?.role === 'lecturer';
  const { data: attendance, isLoading: attendanceLoading, error: attendanceError } = useListSessionAttendance(sessionId, {
    query: {
      queryKey: getListSessionAttendanceQueryKey(sessionId),
      enabled: hasScanRole,
      refetchInterval: (query) => (query.state.error as { status?: number } | null)?.status === 403 ? false : 15000,
    },
  });
  const end = useEndSession();
  const scan = useScanAttendance();
  const client = useQueryClient();
  const [ended, setEnded] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const current = session as AnyRecord | undefined;
  const records = (attendance as AnyRecord[] | undefined) || [];
  const attendanceStatus = (attendanceError as { status?: number } | null)?.status;
  const canScanSession = hasScanRole && !attendanceLoading && !attendanceError;
  const scanAccessMessage = !currentUser
    ? 'Checking your account access…'
    : !hasScanRole
      ? 'Sign in with a lecturer or administrator account to scan attendance.'
      : attendanceLoading
        ? 'Checking access to this session…'
        : attendanceStatus === 403
          ? 'Only this course’s assigned lecturer or an administrator can scan this session.'
          : attendanceError
            ? 'Could not verify access to this session. Reload and try again.'
            : '';

  useEffect(() => {
    if (!canScanSession && scannerOpen) setScannerOpen(false);
  }, [canScanSession, scannerOpen]);

  if (isLoading) return <><Skeleton className="h-10 w-48" /><Skeleton className="mt-3 h-8 w-80" /><div className="mt-8 grid gap-6 lg:grid-cols-[.7fr_1.3fr]"><Skeleton className="h-[490px]" /><Skeleton className="h-[490px]" /></div></>;
  if (isError || !current) return <EmptyState icon={CircleAlert} title="Session not found" body="This attendance room may have ended or the link is no longer valid." action={<PrimaryButton testId="button-retry-session" onClick={() => refetch()}><RefreshCw size={15} /> Try again</PrimaryButton>} />;

  const scanStudentQr = async (qrToken: string) => {
    setScanMessage('');
    try {
      const record = await scan.mutateAsync({ sessionId, data: { qrToken } });
      setScanMessage(`${record.studentName} checked in successfully.`);
      void client.invalidateQueries({ queryKey: getListSessionAttendanceQueryKey(sessionId) });
      void client.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    } catch {
      setScanMessage('This student QR is invalid, expired, or already recorded.');
    }
  };
  const closeSession = () => end.mutate({ sessionId }, {
    onSuccess: () => {
      setEnded(true);
      setScannerOpen(false);
      void client.invalidateQueries({ queryKey: getGetSessionQueryKey(sessionId) });
    },
  });

  return <>
    <div className="mb-7 flex items-center gap-2 text-xs text-muted-foreground"><Link href="/sessions" data-testid="link-back-sessions" className="hover:text-primary">Sessions</Link><ChevronRight size={14} /><span>{current.courseCode}</span></div>
    <PageHeading
      eyebrow={current.status === 'active' && !ended ? 'Live attendance room' : 'Session complete'}
      title={current.courseTitle}
      body={`${current.courseCode} · ${current.room} · started ${formatTime(current.startsAt)}`}
      action={<div className="flex gap-2"><Badge tone={current.status === 'active' && !ended ? 'live' : 'neutral'}>{current.status === 'active' && !ended ? 'Accepting scans' : 'Ended'}</Badge>{current.status === 'active' && !ended && <PrimaryButton variant="danger" testId="button-end-session" onClick={closeSession} disabled={end.isPending}><DoorOpen size={15} /> {end.isPending ? 'Ending…' : 'End session'}</PrimaryButton>}</div>}
    />
    <div className="grid gap-6 lg:grid-cols-[.72fr_1.28fr]">
      <section className="flex flex-col rounded-2xl border border-border bg-sidebar p-6 text-sidebar-foreground shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-sidebar-primary">Lecturer camera scanner</div>
            <h2 className="mt-2 font-display text-2xl">Scan student codes</h2>
            <p className="mt-2 text-sm leading-6 text-sidebar-foreground/65">Scan each student’s personal QR code. Codes are encrypted, tied to this active session, and expire after 30 seconds.</p>
          </div>
          <Camera size={20} className="shrink-0 text-sidebar-primary" />
        </div>
        <div className="mt-8 flex min-h-44 flex-1 flex-col items-center justify-center rounded-2xl border border-sidebar-border bg-sidebar-accent/45 p-5 text-center">
          <ScanLine size={34} className="text-sidebar-primary" />
          <div className="mt-3 text-sm font-semibold">{scannerOpen ? 'Camera scanner is open' : 'Ready for student check-in'}</div>
          <div className="mt-1 max-w-xs text-xs leading-5 text-sidebar-foreground/60">Keep this session monitor open while students present their codes.</div>
          {current.status === 'active' && !ended && <div className="mt-5">
            {canScanSession
              ? <PrimaryButton testId="button-open-attendance-scanner" onClick={() => setScannerOpen(true)} disabled={scan.isPending}><Camera size={15} /> {scannerOpen ? 'Scanner open' : 'Open camera scanner'}</PrimaryButton>
              : <p role="status" className="max-w-xs text-xs leading-5 text-sidebar-foreground/70">{scanAccessMessage}</p>}
          </div>}
        </div>
        {scanMessage && <div role="status" data-testid="status-scan-result" className={cx('mt-4 rounded-xl px-3 py-2.5 text-sm', scanMessage.includes('successfully') ? 'bg-emerald-400/10 text-emerald-200' : 'bg-destructive/15 text-red-100')}>{scanMessage}</div>}
        <div className="mt-5 flex items-center gap-2 border-t border-sidebar-border pt-4 text-xs text-sidebar-foreground/60"><ShieldCheck size={14} className="text-sidebar-primary" /> Server-verified identity · duplicate scans rejected</div>
      </section>
      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-col justify-between gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:p-6">
          <div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Scan activity</div><h2 className="mt-1 font-display text-2xl">{current.scanCount} <span className="text-base font-normal text-muted-foreground">of {current.totalStudents} checked in</span></h2></div>
          <div className="w-full sm:w-40"><div className="mb-2 flex justify-between text-[11px] text-muted-foreground"><span>Attendance</span><span className="font-bold text-primary">{current.attendanceRate}%</span></div><ProgressBar value={current.attendanceRate} /></div>
        </div>
        <div className="max-h-[455px] overflow-auto">
          {attendanceLoading ? [1,2,3,4].map(i => <div className="flex gap-3 border-b border-border p-4" key={i}><Skeleton className="h-8 w-8" /><Skeleton className="h-8 flex-1" /></div>)
            : !hasScanRole ? <div className="p-5"><EmptyState icon={CircleAlert} title="Lecturer access required" body={scanAccessMessage} /></div>
            : attendanceError ? <div className="p-5"><EmptyState icon={CircleAlert} title={attendanceStatus === 403 ? 'You cannot monitor this session' : 'Attendance could not be loaded'} body={scanAccessMessage} /></div>
              : records.length ? records.map((record: AnyRecord) => <div key={record.id} className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-0"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initials(record.studentName)}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{record.studentName}</div><div className="font-mono-ui text-[10px] text-muted-foreground">{record.matricNumber}</div></div><div className="text-right"><Badge tone={record.status === 'present' ? 'good' : record.status === 'late' ? 'warn' : 'danger'}>{record.status}</Badge><div className="mt-1 text-[10px] text-muted-foreground">{formatTime(record.scannedAt)}</div></div></div>)
                : <div className="p-5"><EmptyState icon={ScanLine} title="Waiting for the first scan" body="Student check-ins will appear here in real time." /></div>}
        </div>
      </section>
    </div>
    {scannerOpen && canScanSession && current.status === 'active' && !ended && <AttendanceScanner onScan={scanStudentQr} onClose={() => setScannerOpen(false)} statusMessage={scanMessage} isChecking={scan.isPending} />}
  </>;
}

function CoursesPage() {
  const { data: courses, isLoading, isError, refetch } = useListCourses();
  const { data: user } = useGetCurrentUser();
  const current = user as AnyRecord | undefined;
  const list = (courses as AnyRecord[] | undefined) || [];
  const [start, setStart] = useState<AnyRecord | null>(null);
  const [editing, setEditing] = useState<AnyRecord | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const deleteCourse = useDeleteCourse();
  const client = useQueryClient();
  const canCreate = current?.role === 'admin' || current?.role === 'lecturer';
  const filtered = list.filter(course => `${course.code} ${course.title}`.toLowerCase().includes(query.toLowerCase()));
  const canManage = (course: AnyRecord) => current?.role === 'admin' || (current?.role === 'lecturer' && current.id === course.lecturerId);
  const removeCourse = (course: AnyRecord) => {
    if (!window.confirm(`Delete ${course.code}? Courses with session history cannot be deleted.`)) return;
    setActionError('');
    deleteCourse.mutate({ courseId: course.id }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
      onError: () => setActionError('Course could not be deleted. It may already have session history.'),
    });
  };

  return <>
    <PageHeading eyebrow="Course management" title="Your teaching desk." body="Create and maintain courses, then start time-limited attendance sessions." action={canCreate ? <PrimaryButton testId="button-add-course" onClick={() => setEditing(null)}><BookOpen size={16} /> Add course</PrimaryButton> : undefined} />
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 sm:w-80"><Search size={16} className="text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} data-testid="input-course-search" placeholder="Search courses" className="w-full bg-transparent text-sm outline-none" /></div>
      <div className="text-xs text-muted-foreground">{list.length} courses</div>
    </div>
    {actionError && <div role="alert" className="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{actionError}</div>}
    {isError ? <EmptyState icon={CircleAlert} title="Courses couldn't load" body="Try the request again, then continue your lecture day." action={<PrimaryButton testId="button-retry-courses" onClick={() => refetch()}><RefreshCw size={15} /> Retry</PrimaryButton>} />
      : isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-64" />)}</div>
        : filtered.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(course => {
          const manage = canManage(course);
          return <div key={course.id} className="rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40">
            <div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">{course.code?.slice(0, 2)}</div>{course.activeSessionId ? <Badge tone="live">In session</Badge> : <Badge>{course.department}</Badge>}</div>
            <div className="mt-6 font-mono-ui text-xs font-semibold text-primary">{course.code}</div><h2 className="mt-1 min-h-12 font-display text-2xl leading-tight">{course.title}</h2>
            <div className="mt-5 flex items-end justify-between"><div><div className="text-2xl font-bold">{course.attendanceRate}%</div><div className="text-[11px] text-muted-foreground">attendance rate</div></div><div className="text-right text-xs text-muted-foreground"><div className="font-semibold text-foreground">{course.studentsEnrolled}</div>students</div></div>
            <ProgressBar value={course.attendanceRate} />
            <div className="mt-5 flex gap-2">
              {course.activeSessionId ? <Link href={`/sessions/${course.activeSessionId}`} data-testid={`link-course-session-${course.id}`} className="flex-1 rounded-lg bg-primary/10 px-3 py-2 text-center text-xs font-bold text-primary">Open live room</Link>
                : manage ? <button onClick={() => setStart(course)} data-testid={`button-course-start-${course.id}`} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:border-primary hover:text-primary">Start session</button>
                  : <span className="flex-1 rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">Course information</span>}
              {manage && <><button onClick={() => setEditing(course)} aria-label={`Edit ${course.code}`} data-testid={`button-course-edit-${course.id}`} className="rounded-lg border border-border px-3 py-2 text-muted-foreground hover:bg-muted"><Pencil size={15} /></button><button onClick={() => removeCourse(course)} aria-label={`Delete ${course.code}`} data-testid={`button-course-delete-${course.id}`} disabled={deleteCourse.isPending || Boolean(course.activeSessionId)} className="rounded-lg border border-border px-3 py-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"><Trash2 size={15} /></button></>}
            </div>
          </div>;
        })}</div> : <EmptyState icon={BookOpen} title="No courses match" body="Try a different code or title." />}
    {start && <StartSessionDialog courseId={start.id} courseCode={start.code} courseTitle={start.title} onClose={() => setStart(null)} />}
    {editing !== undefined && <CourseEditorDialog key={editing?.id || 'new-course'} course={editing} onClose={() => setEditing(undefined)} />}
  </>;
}

function CourseEditorDialog({ course, onClose }: { course: AnyRecord | null; onClose: () => void }) {
  const [error, setError] = useState('');
  const create = useCreateCourse();
  const update = useUpdateCourse();
  const client = useQueryClient();
  const pending = create.isPending || update.isPending;
  const courseColor = course?.color;
  const defaultColor = ['teal', 'amber', 'violet', 'blue'].includes(courseColor) ? courseColor : 'teal';
  const form = useForm<CourseFormValues>({
    resolver: zodResolver(courseFormSchema),
    mode: 'onChange',
    defaultValues: {
      code: course?.code ?? '',
      title: course?.title ?? '',
      department: course?.department ?? 'Computer Science',
      color: defaultColor,
    },
  });

  const submit = (values: CourseFormValues) => {
    setError('');
    const data = { ...values, code: values.code.trim().toUpperCase(), title: values.title.trim(), department: values.department.trim() };
    const onSuccess = () => {
      void client.invalidateQueries({ queryKey: getListCoursesQueryKey() });
      void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      onClose();
    };
    const onError = () => setError('Could not save this course. Check the course code and try again.');
    if (course) update.mutate({ courseId: course.id, data }, { onSuccess, onError });
    else create.mutate({ data }, { onSuccess, onError });
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="course-dialog-title" className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl">
      <div className="flex items-start justify-between">
        <div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary">Course details</div><h2 id="course-dialog-title" className="mt-1 font-display text-2xl">{course ? 'Edit course' : 'Add a course'}</h2></div>
        <button onClick={onClose} aria-label="Close course form" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
      </div>
      <Form {...form}>
        <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(submit)}>
          <FormField control={form.control} name="code" render={({ field }) => <FormItem><FormLabel>Course code</FormLabel><FormControl><Input {...field} placeholder="CSC 401" maxLength={24} data-testid="input-course-code" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel>Course title</FormLabel><FormControl><Input {...field} placeholder="Software Engineering" maxLength={120} data-testid="input-course-title" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="department" render={({ field }) => <FormItem><FormLabel>Department</FormLabel><FormControl><Input {...field} placeholder="Computer Science" maxLength={120} data-testid="input-course-department" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="color" render={({ field }) => <FormItem><FormLabel>Course color</FormLabel><FormControl><select {...field} data-testid="select-course-color" className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none"><option value="teal">Teal</option><option value="amber">Amber</option><option value="violet">Violet</option><option value="blue">Blue</option></select></FormControl><FormMessage /></FormItem>} />
        {error && <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="flex justify-end gap-2 pt-2"><PrimaryButton variant="quiet" testId="button-cancel-course" onClick={onClose}>Cancel</PrimaryButton><PrimaryButton type="submit" testId="button-save-course" disabled={pending || !form.formState.isValid}>{pending ? 'Saving…' : course ? 'Save course' : 'Create course'}</PrimaryButton></div>
        </form>
      </Form>
    </section>
  </div>;
}

function ReportsPage() {
  const { data: courses } = useListCourses(); const courseList = (courses as AnyRecord[] | undefined) || []; const [range, setRange] = useState<'week'|'month'|'semester'>('month'); const [courseId, setCourseId] = useState(''); const reportParams = { range, courseId: courseId || undefined }; const { data, isLoading, isError, refetch } = useGetAttendanceReport(reportParams, { query: { queryKey: getGetAttendanceReportQueryKey(reportParams) } }); const reports = (data as AnyRecord[] | undefined) || [];
  const exportReport = () => { const rows = [['Course','Present','Absent','Sessions','Attendance rate'], ...reports.map(r => [r.courseCode, r.present, r.absent, r.totalSessions, `${r.attendanceRate}%`])]; const blob = new Blob([rows.map(row => row.join(',')).join('\n')], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `attendance-${range}.csv`; anchor.click(); URL.revokeObjectURL(url); };
  return <><PageHeading eyebrow="Attendance intelligence" title="Reports that hold up." body="Compare the signal across courses and time, then export a clean record for your department." action={<PrimaryButton variant="quiet" testId="button-export-report" onClick={exportReport}><Download size={16} /> Export CSV</PrimaryButton>} /><div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center"><div className="flex rounded-xl bg-muted p-1">{(['week','month','semester'] as const).map(option => <button key={option} onClick={() => setRange(option)} data-testid={`button-range-${option}`} className={cx('rounded-lg px-3 py-2 text-xs font-bold capitalize', range === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>{option}</button>)}</div><select value={courseId} onChange={e => setCourseId(e.target.value)} data-testid="select-report-course" className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none sm:ml-auto sm:min-w-52"><option value="">All courses</option>{courseList.map(c => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select></div>{isError ? <EmptyState icon={CircleAlert} title="Report unavailable" body="We couldn't assemble this report right now." action={<PrimaryButton testId="button-retry-report" onClick={() => refetch()}><RefreshCw size={15} /> Retry</PrimaryButton>} /> : isLoading ? <div className="rounded-2xl border border-border bg-card p-6"><Skeleton className="h-10 w-full" /><Skeleton className="mt-4 h-10 w-full" /><Skeleton className="mt-4 h-10 w-full" /></div> : reports.length ? <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="hidden grid-cols-[1.5fr_.7fr_.7fr_.7fr_.8fr] gap-4 border-b border-border bg-muted/40 px-6 py-3 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground sm:grid"><span>Course</span><span>Present</span><span>Absent</span><span>Sessions</span><span>Rate</span></div>{reports.map((report: AnyRecord) => <div key={report.courseId} className="grid gap-3 border-b border-border px-5 py-4 last:border-0 sm:grid-cols-[1.5fr_.7fr_.7fr_.7fr_.8fr] sm:items-center sm:gap-4 sm:px-6"><div><div className="font-mono-ui text-[11px] font-semibold text-primary">{report.courseCode}</div><div className="text-sm font-semibold">{report.courseTitle}</div></div><div><span className="text-xs text-muted-foreground sm:hidden">Present · </span><span className="text-sm font-semibold">{report.present}</span></div><div><span className="text-xs text-muted-foreground sm:hidden">Absent · </span><span className="text-sm font-semibold">{report.absent}</span></div><div><span className="text-xs text-muted-foreground sm:hidden">Sessions · </span><span className="text-sm font-semibold">{report.totalSessions}</span></div><div className="flex items-center gap-2"><span className="text-sm font-bold text-primary">{report.attendanceRate}%</span><div className="hidden w-16 sm:block"><ProgressBar value={report.attendanceRate} /></div></div></div>)}</div> : <EmptyState icon={BarChart3} title="No attendance data yet" body="Complete a session to begin building your report history." />}</>;
}

function AdminUsersPage() {
  const { data: user } = useGetCurrentUser();
  const current = user as AnyRecord | undefined;
  const { data: users, isLoading, isError, refetch } = useListUsers({
    query: { queryKey: getListUsersQueryKey(), refetchInterval: 30_000 },
  });
  const updateRole = useUpdateUserRole();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const people = (users as AnyRecord[] | undefined) || [];

  const changeRole = (userId: string, role: UserRoleInputRole) => {
    setError('');
    updateRole.mutate(
      { userId, data: { role } },
      {
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () => setError('Could not update this role. Your own administrator role cannot be removed.'),
      },
    );
  };

  if (current?.role !== 'admin') {
    return <EmptyState icon={Shield} title="Administrator access required" body="Only an administrator can view and change account roles." />;
  }

  return <>
    <PageHeading eyebrow="Access management" title="Users and roles." body="Assign lecturer access to verified accounts. New accounts start with student permissions." />
    {error && <div role="alert" className="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
    {isError ? <EmptyState icon={CircleAlert} title="User list unavailable" body="The administrator user list could not be loaded." action={<PrimaryButton testId="button-retry-users" onClick={() => refetch()}><RefreshCw size={15} /> Retry</PrimaryButton>} />
      : isLoading ? <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
        : <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-[1.3fr_1.3fr_.8fr_.7fr] gap-4 border-b border-border bg-muted/40 px-5 py-3 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground sm:grid"><span>Name</span><span>Email</span><span>Account</span><span>Role</span></div>
          {people.length ? people.map(person => <div key={person.id} className="grid gap-3 border-b border-border px-5 py-4 last:border-0 sm:grid-cols-[1.3fr_1.3fr_.8fr_.7fr] sm:items-center sm:gap-4">
            <div><div className="text-sm font-semibold">{person.name}</div><div className="font-mono-ui text-[10px] text-muted-foreground">{person.matricNumber || 'No matric number'}</div></div>
            <div className="break-all text-xs text-muted-foreground">{person.email}</div>
            <div className="text-xs capitalize text-muted-foreground">{person.department || '—'}</div>
            <label className="text-xs font-semibold sm:sr-only" htmlFor={`role-${person.id}`}>Application role
              <select id={`role-${person.id}`} value={person.role} disabled={updateRole.isPending || person.id === current.id} onChange={event => changeRole(person.id, event.target.value as UserRoleInputRole)} data-testid={`select-user-role-${person.id}`} className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-2 text-xs capitalize disabled:opacity-60 sm:mt-0">
                <option value="student">Student</option><option value="lecturer">Lecturer</option><option value="admin">Administrator</option>
              </select>
            </label>
          </div>) : <div className="p-8"><EmptyState icon={UsersRound} title="No user accounts yet" body="Verified accounts will appear here after sign-up." /></div>}
        </section>}
  </>;
}

function AttendanceScanner({ onScan, onClose, statusMessage, isChecking }: { onScan: (value: string) => Promise<void>; onClose: () => void; statusMessage?: string; isChecking?: boolean }) {
  const onScanRef = useRef(onScan);
  const processingRef = useRef(false);
  const seenTokensRef = useRef(new Set<string>());
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const cameraRef = useRef<Html5Qrcode | null>(null);
  const startTaskRef = useRef<Promise<void> | null>(null);
  const cleanupTaskRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let mounted = true;
    let scanner: Html5Qrcode | null = null;

    const start = async () => {
      try {
        await cleanupTaskRef.current;
        if (!mounted) return;
        const availableCameras = await Html5Qrcode.getCameras();
        if (!mounted) return;
        setCameras(availableCameras);
        if (availableCameras.length === 0) {
          throw new Error('No camera was found. Connect a camera or try another device.');
        }

        const camera = availableCameras.find(({ id }) => id === selectedCameraId)
          ?? availableCameras.find(({ label }) => /back|rear|environment/i.test(label))
          ?? availableCameras[0];
        scanner = new Html5Qrcode('attendance-camera-view');
        cameraRef.current = scanner;
        await scanner.start(
          camera.id,
          {
            fps: 12,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.82);
              return { width: size, height: size };
            },
            aspectRatio: 1,
          },
          (decoded) => {
            if (!mounted || processingRef.current || seenTokensRef.current.has(decoded)) return;
            if (!decoded.startsWith('aq1.') || decoded.length > 2048) {
              setError('This is not a valid student attendance QR code.');
              return;
            }
            processingRef.current = true;
            seenTokensRef.current.add(decoded);
            setError('');
            void onScanRef.current(decoded).finally(() => {
              window.setTimeout(() => {
                processingRef.current = false;
              }, 900);
            });
          },
          () => undefined,
        );
        if (!mounted) return;
        setReady(true);
        setError('');
      } catch (cause) {
        if (mounted) {
          const reason = cause instanceof Error ? cause.message : 'Camera access was not available.';
          setError(`${reason} Check browser camera permission, then try another camera if available.`);
        }
      }
    };

    const startTask = start();
    startTaskRef.current = startTask;
    return () => {
      mounted = false;
      cleanupTaskRef.current = (async () => {
        await startTask.catch(() => undefined);
        if (scanner?.isScanning) await scanner.stop().catch(() => undefined);
        try {
          scanner?.clear();
        } catch {
          // The camera may already be released by the browser.
        }
        if (cameraRef.current === scanner) cameraRef.current = null;
      })();
    };
  }, [selectedCameraId]);

  const closeScanner = async () => {
    setClosing(true);
    let scanner = cameraRef.current;
    if (scanner) {
      await startTaskRef.current?.catch(() => undefined);
      scanner = cameraRef.current;
    }
    if (scanner?.isScanning) await scanner.stop().catch(() => undefined);
    onClose();
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/45 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="scanner-title" className="w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary">Camera check-in</div>
          <h2 id="scanner-title" className="mt-1 font-display text-2xl">Scan student QR codes</h2>
          <p className="mt-1 text-sm text-muted-foreground">Point the camera at each student’s personal, expiring QR code.</p>
        </div>
        <button onClick={() => void closeScanner()} disabled={closing} aria-label="Close scanner" className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"><X size={18} /></button>
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl bg-slate-950 p-2">
        <div id="attendance-camera-view" className="min-h-[280px] w-full" />
      </div>
      {cameras.length > 1 && <label className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Camera</span>
        <select
          aria-label="Select attendance camera"
          value={selectedCameraId || cameras.find(({ label }) => /back|rear|environment/i.test(label))?.id || cameras[0]?.id || ''}
          onChange={(event) => {
            setReady(false);
            setError('');
            setSelectedCameraId(event.target.value);
          }}
          className="max-w-[75%] rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
        >
          {cameras.map((camera, index) => <option key={camera.id} value={camera.id}>{camera.label || `Camera ${index + 1}`}</option>)}
        </select>
      </label>}
      <p aria-live="polite" className={cx('mt-3 text-sm', error || statusMessage?.toLowerCase().includes('invalid') ? 'text-destructive' : statusMessage ? 'text-emerald-700' : 'text-muted-foreground')}>
        {error || (isChecking ? 'Checking this code with the attendance server…' : statusMessage || (ready ? 'Camera is ready. Scan one code after another without closing this window.' : 'Requesting camera access…'))}
      </p>
    </section>
  </div>;
}

function StudentQrDialog({ session, onClose }: { session: { id: string; code: string; title: string }; onClose: () => void }) {
  const issueQr = useIssueStudentQr();
  const [qr, setQr] = useState<{ qrToken: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const stoppedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let requesting = false;
    const requestToken = () => {
      if (requesting || stoppedRef.current) return;
      requesting = true;
      issueQr.mutate(
        { sessionId: session.id },
        {
          onSuccess: (result) => {
            if (mounted) setQr(result);
            requesting = false;
          },
          onError: () => {
            stoppedRef.current = true;
            if (mounted) setQr(null);
            requesting = false;
          },
        },
      );
    };

    requestToken();
    const refreshTimer = window.setInterval(requestToken, 20_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [issueQr.mutate, session.id]);

  const secondsRemaining = qr
    ? Math.max(0, Math.ceil((Date.parse(qr.expiresAt) - now) / 1000))
    : 0;
  const failed = issueQr.isError && !qr;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="student-qr-title" className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-2xl">
      <div className="flex items-start justify-between text-left">
        <div>
          <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-primary">Student check-in code</div>
          <h2 id="student-qr-title" className="mt-1 font-display text-2xl">{session.code}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{session.title}</p>
        </div>
        <button onClick={onClose} aria-label="Close student QR code" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
      </div>
      <div className="mx-auto mt-6 flex aspect-square w-full max-w-[270px] items-center justify-center rounded-2xl border border-border bg-white p-4">
        {qr && secondsRemaining > 0
          ? <QRCodeSVG value={qr.qrToken} size={230} level="H" includeMargin data-testid="img-student-attendance-qr" />
          : issueQr.isPending ? <div className="space-y-3 text-sm text-muted-foreground"><Skeleton className="mx-auto h-48 w-48" />Preparing your code…</div>
            : failed ? <div role="alert" className="px-4 text-sm text-destructive">This session may have ended, or your attendance may already be recorded. Close this window and refresh the page.</div>
              : <div className="text-sm text-muted-foreground">Refreshing your code…</div>}
      </div>
      <p aria-live="polite" data-testid="text-student-qr-expiry" className="mt-4 text-sm text-muted-foreground">
        {qr && secondsRemaining > 0 ? `Refreshes automatically · expires in ${secondsRemaining}s` : failed ? 'A new code is unavailable.' : 'Requesting a secure code…'}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Show this code to your lecturer. It is encrypted, tied to this active class, and valid for 30 seconds.</p>
    </section>
  </div>;
}

function StudentPage() {
  const { data: user } = useGetCurrentUser();
  const student = user as AnyRecord | undefined;
  const studentId = student?.id || '';
  const { data, isLoading, isError, refetch } = useGetStudentAttendance(studentId, {
    query: { queryKey: getGetStudentAttendanceQueryKey(studentId), enabled: Boolean(studentId) },
  });
  const { data: courses, isLoading: coursesLoading, isError: coursesError } = useListCourses(
    undefined,
    { query: { queryKey: getListCoursesQueryKey(), refetchInterval: 15000 } },
  );
  const records = (data as AnyRecord[] | undefined) || [];
  const courseList = (courses as AnyRecord[] | undefined) || [];
  const activeSessions = courseList.filter(course => course.activeSessionId);
  const [qrSession, setQrSession] = useState<{ id: string; code: string; title: string } | null>(null);

  if (!student) return <EmptyState title="Loading your account" body="Your verified student profile is being loaded." />;
  if (student.role !== 'student') {
    return <EmptyState icon={Shield} title="Student view only" body="This page is available to student accounts. Your application role is managed by an administrator." />;
  }

  return <>
    <PageHeading
      eyebrow="Student attendance"
      title="Your presence, verified."
      body="Show your personal, short-lived QR code to the lecturer when your class session is open."
    />
    <div className="grid gap-6 lg:grid-cols-[.72fr_1.28fr]">
      <section className="rounded-3xl bg-sidebar p-6 text-sidebar-foreground shadow-xl sm:p-8">
        <div className="flex items-center justify-between">
          <div className="font-display text-xl">Attend<span className="text-sidebar-primary">ly</span></div>
          <Badge tone="live">Signed in</Badge>
        </div>
        <div className="mt-6 border-b border-sidebar-border pb-5">
          <div className="text-lg font-semibold">{student.name}</div>
          <div className="mt-1 text-xs text-sidebar-foreground/65">{student.matricNumber || student.email}</div>
          <div className="mt-1 text-xs text-sidebar-foreground/55">{student.department}</div>
        </div>
        <div className="mt-5">
          <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-sidebar-primary">Open class sessions</div>
          <div className="mt-3 space-y-2">
            {coursesLoading ? <Skeleton className="h-20 bg-sidebar-accent" />
              : coursesError ? <div role="alert" className="rounded-xl bg-destructive/15 p-3 text-xs text-red-100">Active sessions could not be loaded. Refresh the page to try again.</div>
                : activeSessions.length ? activeSessions.map(course => <div key={course.id} className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3">
                  <div className="min-w-0 flex-1"><div className="font-mono-ui text-[10px] font-semibold text-sidebar-primary">{course.code}</div><div className="truncate text-sm font-semibold">{course.title}</div></div>
                  <button onClick={() => setQrSession({ id: course.activeSessionId, code: course.code, title: course.title })} data-testid={`button-show-student-qr-${course.id}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sidebar-primary px-3 py-2 text-xs font-semibold text-sidebar-primary-foreground hover:brightness-95"><QrCode size={14} /> Show my QR</button>
                </div>)
                  : <div className="rounded-xl border border-dashed border-sidebar-border p-4 text-xs leading-5 text-sidebar-foreground/65">Your lecturer’s active class will appear here. The list refreshes automatically.</div>}
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 border-t border-sidebar-border pt-4 text-xs text-sidebar-foreground/60"><ShieldCheck size={14} className="text-sidebar-primary" /> Personal QR · encrypted · expires after 30 seconds</div>
      </section>
      <section className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-5 sm:p-6">
          <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Personal record</div>
          <h2 className="mt-1 font-display text-2xl">Attendance history</h2>
        </div>
        {isError ? <div className="p-6"><EmptyState icon={CircleAlert} title="History unavailable" body="We couldn't retrieve your record." action={<PrimaryButton testId="button-retry-student" onClick={() => refetch()}><RefreshCw size={15} /> Retry</PrimaryButton>} /></div>
          : isLoading ? <div className="space-y-3 p-6">{[1, 2, 3].map(i => <Skeleton className="h-14" key={i} />)}</div>
            : records.length ? <div>{records.map((record: AnyRecord) => <div key={record.id} className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-0 sm:px-6"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><BookOpen size={16} /></div><div className="min-w-0 flex-1"><div className="font-mono-ui text-[11px] font-semibold text-primary">{record.courseCode}</div><div className="truncate text-sm font-semibold">{record.courseTitle || 'Attendance record'}</div><div className="text-[11px] text-muted-foreground">{formatDate(record.scannedAt)} · {formatTime(record.scannedAt)}</div></div><Badge tone={record.status === 'present' ? 'good' : record.status === 'late' ? 'warn' : 'danger'}>{record.status}</Badge></div>)}</div>
              : <div className="p-6"><EmptyState icon={CalendarDays} title="No scans recorded yet" body="Your attendance history will appear after your lecturer verifies your QR code." /></div>}
      </section>
    </div>
    {qrSession && <StudentQrDialog session={qrSession} onClose={() => setQrSession(null)} />}
  </>;
}

function SettingsPage() {
  const { data: user } = useGetCurrentUser();
  const current = user as AnyRecord | undefined;
  return <>
    <PageHeading eyebrow="Workspace settings" title="Account settings." body="Your profile is synced from your verified sign-in account. Application access is controlled by your assigned role." />
    <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Profile</div>
        <div className="mt-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-lg font-bold text-primary">{current?.initials || 'AC'}</div>
          <div><h2 className="font-display text-2xl">{current?.name || 'Your account'}</h2><p className="text-sm text-muted-foreground">{current?.email || ''}</p></div>
        </div>
        <div className="mt-7 space-y-4">
          <label className="block text-sm font-semibold">Department<input value={current?.department || ''} readOnly data-testid="input-profile-department" className="mt-2 w-full rounded-xl border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground outline-none" /></label>
          <label className="block text-sm font-semibold">Student number<input value={current?.matricNumber || 'Not provided'} readOnly data-testid="input-profile-matric-number" className="mt-2 w-full rounded-xl border border-input bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground outline-none" /></label>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">Access and security</div>
        <h2 className="mt-1 font-display text-2xl">Your application role</h2>
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-primary/5 p-4"><ShieldCheck className="text-primary" size={20} /><div><div className="text-sm font-semibold capitalize">{current?.role || 'Loading role'}</div><div className="mt-0.5 text-xs text-muted-foreground">Role changes are managed by an administrator.</div></div></div>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">Sign-in and email verification are handled by Clerk. Attendance scans are accepted only for your signed-in account and an active session code.</p>
        {current?.role === 'admin' && <Link href="/admin" data-testid="link-settings-admin-users" className="mt-5 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><UsersRound size={16} /> Manage user roles</Link>}
      </section>
    </div>
  </>;
}
function PreferenceRow({ icon: Icon, title, body, value, onChange, testId }: { icon: any; title: string; body: string; value: boolean; onChange: () => void; testId: string }) { return <div className="flex items-center gap-3 py-4"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon size={16} /></div><div className="flex-1"><div className="text-sm font-semibold">{title}</div><div className="text-xs text-muted-foreground">{body}</div></div><button role="switch" aria-checked={value} onClick={onChange} data-testid={testId} className={cx('relative h-6 w-11 rounded-full p-1 transition-colors', value ? 'bg-primary' : 'bg-muted')}><span className={cx('block h-4 w-4 rounded-full bg-card transition-transform', value ? 'translate-x-5' : 'translate-x-0')} /></button></div>; }

function PublicLandingPage() {
  return <main className="min-h-[100dvh] bg-background text-foreground">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
      <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar text-sidebar-primary"><ScanLine size={20} /></div><div><div className="font-display text-xl font-bold">Attend<span className="text-primary">ly</span></div><div className="font-mono-ui text-[9px] uppercase tracking-[.2em] text-muted-foreground">presence, verified</div></div></div>
      <div className="flex items-center gap-2"><Link href="/sign-in" data-testid="link-landing-sign-in" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted">Sign in</Link><Link href="/sign-up" data-testid="link-landing-sign-up" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95">Create account</Link></div>
    </header>
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
      <div><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 font-mono-ui text-[10px] uppercase tracking-[.16em] text-primary"><ShieldCheck size={13} /> Verified attendance</div>
        <h1 className="max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-[-.04em] sm:text-6xl">A clearer record of who’s in the room.</h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">Attendly gives students a fast QR check-in and gives lecturers a live, time-limited attendance record for each class session.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-up" data-testid="button-landing-create-account" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95">Create your account <ChevronRight size={16} /></Link><Link href="/sign-in" data-testid="button-landing-sign-in" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold hover:bg-muted">Sign in to Attendly</Link></div>
        <p className="mt-5 text-xs text-muted-foreground">New accounts begin with student access. An administrator assigns lecturer or administrator roles.</p>
      </div>
      <div className="relative mx-auto w-full max-w-lg">
        <div className="absolute -inset-5 rounded-[2rem] bg-primary/10 blur-2xl" />
        <div className="relative rounded-3xl border border-border bg-card p-5 shadow-xl sm:p-7">
          <div className="flex items-center justify-between border-b border-border pb-4"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-muted-foreground">How it works</div><div className="mt-1 font-display text-2xl">A simple class check-in</div></div><span className="rounded-xl bg-primary/10 p-3 text-primary"><QrCode size={22} /></span></div>
          <div className="mt-5 space-y-4">
            {[['01', 'Lecturer opens a session', 'The class check-in window becomes available.'], ['02', 'Student presents a personal QR', 'The lecturer scans it with the session camera.'], ['03', 'Attendance is recorded', 'Encrypted codes expire quickly; duplicate scans are rejected.']].map(([number, title, body]) => <div key={number} className="flex gap-4 rounded-2xl border border-border/70 p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-mono-ui text-xs font-bold text-primary">{number}</div><div><div className="text-sm font-semibold">{title}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{body}</div></div></div>)}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-sidebar px-4 py-3 text-xs text-sidebar-foreground"><ShieldCheck size={16} className="text-sidebar-primary" /> Verified sign-in · role-based access · expiring session codes</div>
        </div>
      </div>
    </section>
  </main>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data, isLoading, isError } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), enabled: Boolean(isSignedIn) } });
  const current = data as AnyRecord | undefined;
  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">Loading secure sign-in…</div>;
  if (!isSignedIn) return <PublicLandingPage />;
  if (isLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">Loading your attendance workspace…</div>;
  if (isError || !current) return <main className="mx-auto flex min-h-[100dvh] max-w-xl items-center px-5"><EmptyState icon={CircleAlert} title="Account setup is incomplete" body="Your verified account could not be connected to an attendance profile. Please contact your system administrator." /></main>;
  return <AppShell>{current.role === 'student' ? <StudentPage /> : <Dashboard />}</AppShell>;
}

function WorkspaceRoutes() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">Loading secure sign-in…</div>;
  if (!isSignedIn) return <Redirect to="/" />;
  return <RoutedErrorBoundary><AppShell><Switch>
    <Route path="/sessions" component={SessionsPage} />
    <Route path="/sessions/:sessionId" component={SessionDetail} />
    <Route path="/courses" component={CoursesPage} />
    <Route path="/reports" component={ReportsPage} />
    <Route path="/student" component={StudentPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route path="/admin" component={AdminUsersPage} />
    <Route component={NotFound} />
  </Switch></AppShell></RoutedErrorBoundary>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const currentId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== currentId) client.clear();
      previousUserId.current = currentId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your attendance workspace.' } },
      signUp: { start: { title: 'Create your account', subtitle: 'Get started with verified class attendance.' } },
    }}
    routerPush={path => setLocation(stripBase(path))}
    routerReplace={path => setLocation(stripBase(path), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <TooltipProvider>
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/" component={HomeRoute} />
          <Route component={WorkspaceRoutes} />
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() { return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>; }
export default App;