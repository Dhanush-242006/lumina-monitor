import express from "express";
import http from "http";
import https from "https";
import net from "net";
import path from "path";
import axios from "axios";
import fs from "fs";
import tls from "tls";
import nodemailer from "nodemailer";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjectStatus = "operational" | "degraded" | "down" | "unknown";
type ProjectType = "website" | "api" | "server" | "database";
type LogType = "success" | "info" | "warning" | "error";
type IssueSeverity = "low" | "medium" | "high" | "critical";

interface ProjectValidation {
  keyword?: string;         // response body MUST contain this string
  forbiddenKeyword?: string; // response body must NOT contain this string
  jsonPath?: string;         // dot-path like "data.status"
  jsonExpected?: string;     // expected value at that JSON path
}

interface MethodResult {
  status: number | null;
  responseTime: number | null;
  ok: boolean;
  error?: string;
  checkedAt: number;
}

interface Project {
  id: string;
  name: string;
  url: string;
  type: ProjectType;
  checkInterval: number;
  status: ProjectStatus;
  lastChecked: number | null;
  uptimePct: number;
  enabled: boolean;
  notifyEmail?: string;
  checkCount: number;
  successCount: number;
  history: number[];
  lastStatusCode?: number;
  lastResponseTime?: number;
  responseTimeThreshold?: number;  // ms — alert if slower than this
  validation?: ProjectValidation;
  sslDaysLeft?: number | null;
  sslCheckedAt?: number | null;
  methodResults?: Record<string, MethodResult>;
  credentials?: {
    authHeader?: string;
    customHeaders?: Record<string, string>;
    method?: "GET" | "POST" | "HEAD" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
    body?: string;         // raw JSON or text body for POST/PUT/PATCH — used to test form/API actions
  };
  // ── Accuracy fields ────────────────────────────────────────────────────
  consecutiveFailures?: number;   // # of consecutive non-operational checks (confirmation gate)
  responseTimeSamples?: number[]; // last 20 response times — used for anomaly baseline
  finalUrl?: string;              // resolved URL after following all redirects
  // ── Website metadata ──────────────────────────────────────────────────
  description?: string;
  websiteInfo?: {
    company?: string;
    tagline?: string;
    about?: string;
    services?: string[];
    technologies?: string[];
    region?: string;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    socialLinks?: { platform: string; url: string }[];
    keyPages?: { label: string; url: string }[];
    lastAnalyzed?: number;
  };
  // ── Auto Health Scan result (saved when project is created) ───────────
  lastScanResult?: Record<string, unknown>;
}

interface LogEntry {
  id: string;
  projectId: string;
  timestamp: number;
  type: LogType;
  message: string;
  statusCode?: number;
  responseTime?: number;
}

interface Issue {
  id: string;
  projectId: string;
  startedAt: number;
  resolvedAt?: number;
  severity: IssueSeverity;
  message: string;
  status: "open" | "resolved";
}

interface AppNotification {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: number;
  message: string;
  severity: IssueSeverity;
  read: boolean;
}

interface AppSettings {
  emailFrom?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailUser?: string;
  emailPass?: string;
  emailEnabled?: boolean;
  statusPageTitle?: string;
  statusPagePublic?: boolean;
  geminiApiKey?: string;
  geminiModel?: string;
  groqApiKey?: string;
  groqModel?: string;
  vercelToken?: string;
  // ── Slack integration ──────────────────────────────────────────────────
  slackWebhookUrl?: string;
  slackEnabled?: boolean;
  slackChannelAlerts?: string;    // e.g. #website-alerts
  slackChannelErrors?: string;    // e.g. #server-errors
  slackChannelDevops?: string;    // e.g. #devops
  // ── General webhook ────────────────────────────────────────────────────
  webhookUrl?: string;
  webhookEnabled?: boolean;
  // ── Supabase integration ───────────────────────────────────────────────
  supabaseAccessToken?: string;
  supabaseProjectRef?: string;
  supabaseAnonKey?: string;
  // ── Branding ───────────────────────────────────────────────────────────
  tileImage?: string;
  favicon?: string;
}

interface HealthRecord {
  id: string;
  projectId: string;
  timestamp: number;
  status: ProjectStatus;
  responseTime: number;
  statusCode?: number;
  errorMessage?: string;
  checkType: "http" | "tcp";
}

interface MaintenanceWindow {
  id: string;
  label: string;
  startIso: string;    // ISO datetime
  endIso: string;
  repeat: "once" | "daily" | "weekly";
  projectId?: string;  // if undefined → applies to all projects
}

interface SavedFilter {
  id: string;
  name: string;
  query: string;
  type?: "all" | "error" | "warning" | "success" | "info";
  color?: string;
}

// ─── Synthetic Test types ─────────────────────────────────────────────────────

interface SyntheticAssertion {
  type: "status" | "body_contains" | "response_time" | "header";
  target?: string;
  operator: "eq" | "lt" | "gt" | "contains" | "not_contains";
  value: string;
}

interface SyntheticStep {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  assertions: SyntheticAssertion[];
}

interface SyntheticTest {
  id: string;
  name: string;
  description?: string;
  steps: SyntheticStep[];
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunStatus?: "pass" | "fail" | "error";
}

interface StepRunResult {
  stepId: string;
  name: string;
  url: string;
  method: string;
  statusCode: number | null;
  responseTime: number;
  assertions: (SyntheticAssertion & { passed: boolean; actual: string })[];
  passed: boolean;
  error?: string;
}

interface SyntheticRunResult {
  id: string;
  testId: string;
  runAt: number;
  duration: number;
  status: "pass" | "fail" | "error";
  steps: StepRunResult[];
  passedSteps: number;
  totalSteps: number;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Ingest Event (structured log from external apps) ────────────────────────

interface IngestEvent {
  id: string;
  receivedAt: number;
  timestamp: string;            // ISO string from source app
  event: string;                // "login", "api_call", "signup", etc.
  user_id?: string;             // user identifier (never raw passwords)
  tenant_id?: string;           // optional multi-tenant grouping
  endpoint?: string;            // e.g. "/auth/login"
  method?: string;              // "POST", "GET", …
  status?: "success" | "failure" | string;
  http_status?: number;
  latency_ms?: number;
  source_ip?: string;
  error_code?: string;
  extra?: Record<string, unknown>; // any additional custom fields
}

const FILES = {
  projects: path.join(DATA_DIR, "projects.json"),
  logs: path.join(DATA_DIR, "logs.json"),
  issues: path.join(DATA_DIR, "issues.json"),
  notifications: path.join(DATA_DIR, "notifications.json"),
  settings: path.join(DATA_DIR, "settings.json"),
  events: path.join(DATA_DIR, "events.json"),  // ← ingest store
  maintenanceWindows: path.join(DATA_DIR, "maintenance-windows.json"),
  savedFilters: path.join(DATA_DIR, "saved-filters.json"),
  healthRecords: path.join(DATA_DIR, "health-records.json"),
  syntheticTests:   path.join(DATA_DIR, "synthetic-tests.json"),
  syntheticResults: path.join(DATA_DIR, "synthetic-results.json"),
};

function readJson<T>(file: string, def: T): T {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch { return def; }
}
function writeJson(file: string, data: unknown) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

const readProjects = () => readJson<Project[]>(FILES.projects, []);
const readLogs = () => readJson<LogEntry[]>(FILES.logs, []);
const readIssues = () => readJson<Issue[]>(FILES.issues, []);
const readNotifications = () => readJson<AppNotification[]>(FILES.notifications, []);
const readSettings = () => readJson<AppSettings>(FILES.settings, {});
const readEvents = () => readJson<IngestEvent[]>(FILES.events, []);
const readMaintenanceWindows = () => readJson<MaintenanceWindow[]>(FILES.maintenanceWindows, []);
const readSavedFilters    = () => readJson<SavedFilter[]>(FILES.savedFilters, []);
const readHealthRecords   = () => readJson<HealthRecord[]>(FILES.healthRecords, []);
const readSyntheticTests  = () => readJson<SyntheticTest[]>(FILES.syntheticTests, []);
const readSyntheticResults = () => readJson<SyntheticRunResult[]>(FILES.syntheticResults, []);

// ─── WebSocket broadcast ─────────────────────────────────────────────────────

let wss: WebSocketServer;

function broadcast(event: string, data: unknown) {
  if (!wss) return;
  const msg = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ─── Status-page SSE (Server-Sent Events) ────────────────────────────────────
// Every visitor on /status gets real-time pushes the instant a check completes.

import type { Response as ExpressResponse } from "express";
const sseClients = new Set<ExpressResponse>();

function pushStatusUpdate() {
  if (sseClients.size === 0) return;
  const projects = readProjects();
  const issues   = readIssues();
  const hasIssues = projects.some((p) => p.status === "down" || p.status === "degraded");
  const openIssues = issues.filter((i) => i.status === "open");
  const payload = JSON.stringify({ projects, issues, hasIssues, openCount: openIssues.length });
  sseClients.forEach((res) => {
    try { res.write(`data: ${payload}\n\n`); } catch {}
  });
}

// ─── Email ───────────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, text: string) {
  const s = readSettings();
  if (!s.emailEnabled || !s.emailSmtpHost || !s.emailUser || !s.emailPass) return;
  try {
    const t = nodemailer.createTransport({
      host: s.emailSmtpHost,
      port: s.emailSmtpPort || 587,
      secure: (s.emailSmtpPort || 587) === 465,
      auth: { user: s.emailUser, pass: s.emailPass },
    });
    await t.sendMail({ from: s.emailFrom || s.emailUser, to, subject, text });
  } catch (e: any) { console.error("[EMAIL]", e.message); }
}

// ─── Slack Alert ─────────────────────────────────────────────────────────────

async function sendSlackAlert(
  project: Project,
  newStatus: ProjectStatus,
  message: string,
  isResolved = false
) {
  const s = readSettings();
  if (!s.slackEnabled || !s.slackWebhookUrl) return;

  const color = isResolved      ? "#3ecf8e"
              : newStatus === "down"     ? "#f43f5e"
              : newStatus === "degraded" ? "#f59e0b"
              : "#3ecf8e";

  const emoji = isResolved      ? "✅"
              : newStatus === "down"     ? "🔴"
              : newStatus === "degraded" ? "🟡"
              : "🟢";

  const statusLabel = isResolved ? "RECOVERED" : newStatus.toUpperCase().replace("_", " ");

  const payload = {
    text: `${emoji} *${project.name}* is ${statusLabel}`,
    attachments: [
      {
        color,
        fields: [
          { title: "Project",  value: project.name,  short: true },
          { title: "Status",   value: statusLabel,    short: true },
          { title: "URL",      value: project.url,    short: false },
          { title: "Detail",   value: message.slice(0, 300), short: false },
          { title: "Uptime",   value: `${project.uptimePct.toFixed(2)}%`, short: true },
          { title: "Time",     value: new Date().toLocaleString(), short: true },
        ],
        footer: "Lumina Monitor",
        footer_icon: "https://lumina.monitor/favicon.ico",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    await axios.post(s.slackWebhookUrl, payload, { timeout: 8000 });
    console.log(`[SLACK] Sent alert for ${project.name} → ${statusLabel}`);
  } catch (e: any) {
    console.error("[SLACK] Failed to send:", e.message);
  }
}

// ─── General Webhook Alert ────────────────────────────────────────────────────

async function sendWebhookAlert(
  project: Project,
  newStatus: ProjectStatus,
  message: string,
  isResolved = false
) {
  const s = readSettings();
  if (!s.webhookEnabled || !s.webhookUrl) return;

  const payload = {
    event:        isResolved ? "issue_resolved" : "issue_opened",
    projectId:    project.id,
    projectName:  project.name,
    projectUrl:   project.url,
    projectType:  project.type,
    status:       isResolved ? "operational" : newStatus,
    message,
    uptimePct:    project.uptimePct,
    timestamp:    new Date().toISOString(),
    source:       "lumina-monitor",
  };

  try {
    await axios.post(s.webhookUrl, payload, {
      timeout: 8000,
      headers: { "Content-Type": "application/json", "User-Agent": "LuminaMonitor/1.0" },
    });
    console.log(`[WEBHOOK] Fired for ${project.name} → ${isResolved ? "resolved" : newStatus}`);
  } catch (e: any) {
    console.error("[WEBHOOK] Failed:", e.message);
  }
}

// ─── Maintenance Window Check ─────────────────────────────────────────────────
// Returns true if the project is currently in a maintenance window
// (alerts should be suppressed during this period).

function isInMaintenanceWindow(projectId: string): boolean {
  const windows = readMaintenanceWindows();
  if (!windows.length) return false;

  const now = new Date();

  for (const w of windows) {
    // window must apply to this project or all projects
    if (w.projectId && w.projectId !== projectId) continue;

    try {
      const start = new Date(w.startIso);
      const end   = new Date(w.endIso);
      const durMs = end.getTime() - start.getTime();
      if (durMs <= 0) continue;

      if (w.repeat === "once") {
        if (now >= start && now <= end) return true;
      } else if (w.repeat === "daily") {
        // Compare only time-of-day
        const startTime = start.getHours() * 3600 + start.getMinutes() * 60 + start.getSeconds();
        const endTime   = end.getHours()   * 3600 + end.getMinutes()   * 60 + end.getSeconds();
        const nowTime   = now.getHours()   * 3600 + now.getMinutes()   * 60 + now.getSeconds();
        if (endTime >= startTime) {
          if (nowTime >= startTime && nowTime <= endTime) return true;
        } else {
          // Wraps midnight
          if (nowTime >= startTime || nowTime <= endTime) return true;
        }
      } else if (w.repeat === "weekly") {
        // Same day-of-week + time range
        if (now.getDay() === start.getDay()) {
          const startTime = start.getHours() * 3600 + start.getMinutes() * 60;
          const endTime   = end.getHours()   * 3600 + end.getMinutes()   * 60;
          const nowTime   = now.getHours()   * 3600 + now.getMinutes()   * 60;
          if (nowTime >= startTime && nowTime <= endTime) return true;
        }
      }
    } catch { continue; }
  }

  return false;
}

// ─── SSL certificate check ───────────────────────────────────────────────────

async function checkSslCert(urlStr: string): Promise<number | null> {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname;
    const port = parseInt(url.port) || 443;
    return new Promise((resolve) => {
      const socket = tls.connect(
        { host: hostname, port, servername: hostname, rejectUnauthorized: false },
        () => {
          const cert = socket.getPeerCertificate();
          socket.destroy();
          if (!cert?.valid_to) { resolve(null); return; }
          const daysLeft = Math.floor(
            (new Date(cert.valid_to).getTime() - Date.now()) / 86400000
          );
          resolve(daysLeft);
        }
      );
      socket.setTimeout(5000, () => { socket.destroy(); resolve(null); });
      socket.on("error", () => resolve(null));
    });
  } catch { return null; }
}

// ─── Soft-error detection ─────────────────────────────────────────────────────
// Catches pages that return HTTP 200 but actually display an error (soft 404,
// blank app-shell, maintenance page, login wall, etc.).

function detectSoftError(body: string): string | null {
  if (!body || typeof body !== "string") return null;

  // ── 1. <title> tag ──────────────────────────────────────────────────────────
  const titleM = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const titleText = titleM ? titleM[1].trim() : "";
  const titleLow  = titleText.toLowerCase();

  const TITLE_PATTERNS: [RegExp, string][] = [
    [/\b404\b/,           "404 in page title"],
    [/not found/,         "\"Not Found\" in page title"],
    [/page not found/,    "\"Page Not Found\" in page title"],
    [/\b403\b/,           "403 in page title"],
    [/forbidden/,         "\"Forbidden\" in page title"],
    [/\b500\b/,           "500 in page title"],
    [/server error/,      "\"Server Error\" in page title"],
    [/\b503\b/,           "503 in page title"],
    [/service unavailable/, "\"Service Unavailable\" in page title"],
    [/\b401\b/,           "401 in page title"],
    [/unauthorized/,      "\"Unauthorized\" in page title"],
    [/access denied/,     "\"Access Denied\" in page title"],
    [/^error$/,           "\"Error\" in page title"],
    [/application error/, "\"Application Error\" in page title"],
    [/something went wrong/, "\"Something went wrong\" in page title"],
    [/oops/,              "\"Oops\" error page title"],
  ];

  for (const [re, label] of TITLE_PATTERNS) {
    if (re.test(titleLow)) {
      const excerpt = titleText.length > 60 ? titleText.slice(0, 60) + "…" : titleText;
      return `Soft error — ${label}: "${excerpt}"`;
    }
  }

  // ── 2. <h1> / <h2> heading ─────────────────────────────────────────────────
  const h1M = body.match(/<h[12][^>]*>([^<]{1,120})<\/h[12]>/i);
  if (h1M) {
    const h1Low = h1M[1].toLowerCase().trim();
    if (/\b404\b|not found|page not found|forbidden|unauthorized|access denied|application error/.test(h1Low)) {
      const excerpt = h1M[1].trim();
      return `Soft error in heading: "${excerpt.length > 60 ? excerpt.slice(0, 60) + "…" : excerpt}"`;
    }
  }

  // ── 3. Known error-body text patterns ──────────────────────────────────────
  const BODY_PATTERNS: [RegExp, string][] = [
    [/the requested url was not found on this server/i, "Soft 404 — requested URL not found"],
    [/this page (doesn['']?t|does not) exist/i,        "Soft 404 — page does not exist"],
    [/page (not found|doesn['']?t exist)/i,            "Soft 404 — page not found"],
    [/404 (not found|error)/i,                         "Soft 404 error in body"],
    [/error\s*:\s*page not found/i,                    "Soft 404 — Error: Page not found"],
    [/no\s+page\s+found/i,                             "Soft 404 — no page found"],
    [/the page you.{0,30}(looking for|requested).{0,40}(not|doesn)/i, "Soft 404 — page not found message"],
    [/something went wrong/i,                          "Application error — something went wrong"],
    [/we('?re| are) (currently )?under maintenance/i,  "Under maintenance — site unavailable"],
    [/scheduled maintenance/i,                         "Scheduled maintenance page detected"],
    [/temporarily unavailable/i,                       "Service temporarily unavailable"],
  ];

  for (const [re, label] of BODY_PATTERNS) {
    if (re.test(body)) return label;
  }

  return null; // no soft error detected
}

// ─── Login / Auth issue detection ────────────────────────────────────────────
// Catches authentication problems that don't produce a non-200 HTTP status:
//   • Redirect to a login page (session expired, auth wall)
//   • Login error messages in the body (wrong password, account locked, 2FA)
//   • Login form appearing where real content was expected
//   • Session-expired / logged-out messages

function detectLoginIssue(body: string, finalUrl?: string, originalUrl?: string): string | null {

  // ── 1. Redirect landed on a login page ───────────────────────────────────────
  if (finalUrl && originalUrl) {
    try {
      const finalPath  = new URL(finalUrl).pathname.toLowerCase();
      const origPath   = new URL(originalUrl).pathname.toLowerCase();
      if (finalPath !== origPath) {
        const LOGIN_PATHS = [
          "/login", "/signin", "/sign-in", "/log-in", "/logon",
          "/auth/login", "/auth/signin", "/users/sign_in", "/user/login",
          "/account/login", "/accounts/login", "/session/new", "/sessions/new",
          "/sso", "/oauth", "/authenticate", "/saml/login",
        ];
        // Exact match or path starts with a login segment
        if (LOGIN_PATHS.some((p) => finalPath === p || finalPath.startsWith(p + "/") || finalPath.startsWith(p + "?"))) {
          return `🔒 Auth redirect → redirected to login page (${new URL(finalUrl).pathname})`;
        }
        // Looser: path segment contains login/signin/sign-in
        if (/\/(login|signin|sign[-_]in|logon|log[-_]in)(\/|$|\?|#)/.test(finalPath)) {
          return `🔒 Auth redirect → redirected to login page (${new URL(finalUrl).pathname})`;
        }
      }
    } catch { /* invalid URL — skip */ }
  }

  if (!body || typeof body !== "string") return null;

  // ── 2. <title> indicates a login/auth page ──────────────────────────────────
  const titleM   = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const titleLow = titleM ? titleM[1].trim().toLowerCase() : "";

  const AUTH_TITLE: [RegExp, string][] = [
    [/^(login|sign in|log in|signin|log-in|sign-in)$/, `Login wall — title is "${titleM?.[1].trim()}"`],
    [/\bsession expired\b/,        "Session expired (title)"],
    [/\bauthentication required\b/, "Authentication required (title)"],
    [/\bplease (sign|log) in\b/,   "Login required (title)"],
    [/\baccess denied\b/,          "Access denied (title)"],
    [/\bnot authorized\b/,         "Not authorized (title)"],
    [/\bunauthorized\b/,           "Unauthorized access (title)"],
  ];
  for (const [re, label] of AUTH_TITLE) {
    if (re.test(titleLow)) return `🔒 ${label}`;
  }

  // ── 3. Body text patterns ────────────────────────────────────────────────────
  const AUTH_BODY: [RegExp, string][] = [
    // Session / logout
    [/your session has? (expired|timed?\s*out)/i,           "Session expired — please log in again"],
    [/session (has )?expired/i,                             "Session expired"],
    [/session (timed?\s*out|invalid|ended)/i,               "Session timed out or ended"],
    [/you (have been|'?ve been|were|are) (signed?|logged?) out/i, "You have been signed out"],
    [/automatically (signed?|logged?) out/i,                "Automatically signed out"],
    [/you('?ve| have) been (kicked|removed|logged out)/i,   "Session terminated"],
    // Login walls
    [/please (sign|log)\s*in (to|and)\s*(continue|access|view|proceed)/i, "Login required to access content"],
    [/sign\s*in (to|and)\s*(continue|access|view|proceed)/i, "Sign in required to continue"],
    [/log\s*in (to|and)\s*(continue|access|view|proceed)/i, "Log in required to continue"],
    [/you must (log|sign)\s*in/i,                           "Must be logged in to view this page"],
    [/login (required|to continue|to access|to view|is required)/i, "Login required"],
    [/authentication (required|is required)/i,              "Authentication required"],
    [/not (authenticated|logged in)/i,                      "User not authenticated"],
    [/only (logged.?in|authenticated|registered) (users?|members?|accounts?)/i, "Restricted to logged-in users"],
    // Credential errors
    [/invalid (username( or | and |\/)?password|credentials?|login)/i, "Login error — invalid credentials"],
    [/(incorrect|wrong) (password|credentials?|email|username)/i, "Login error — incorrect credentials"],
    [/password (is )?incorrect/i,                           "Login error — incorrect password"],
    [/(email|username).{0,20}(not found|does not exist|is not registered)/i, "Login error — account not found"],
    [/login (failed|unsuccessful|error)/i,                  "Login failed"],
    [/sign.?in (failed|unsuccessful|error)/i,               "Sign-in failed"],
    [/authentication (failed|unsuccessful|error)/i,         "Authentication failed"],
    // Account lockout / rate limiting
    [/too many (failed |login |sign.?in )?(attempts?|tries)/i, "Account locked — too many failed login attempts"],
    [/account (has been |is )?(locked|suspended|disabled|banned|deactivated)/i, "Account locked or suspended"],
    [/temporarily (locked|blocked|banned|disabled)/i,       "Account temporarily locked"],
    [/try again in \d+/i,                                   "Rate-limited — retry delay imposed"],
    // 2FA / MFA
    [/enter (your )?(verification|otp|one.?time) code/i,    "2FA/MFA code required"],
    [/two.?factor (authentication|verification)/i,          "Two-factor authentication required"],
    [/authentication app|authenticator code/i,              "Authenticator app required"],
    [/we('?ve| have) sent (a |an )?(code|otp|pin|link) to/i, "OTP/magic link sent — waiting for verification"],
    // Permission
    [/you (don'?t|do not) have (permission|access) (to|for)/i, "Permission denied"],
    [/access (is )?denied/i,                                "Access denied"],
    [/not (authorized|authorised) to (view|access|perform)/i, "Not authorized"],
    [/\bforbidden\b/i,                                      "Forbidden — access not allowed"],
  ];
  for (const [re, label] of AUTH_BODY) {
    if (re.test(body)) return `🔒 ${label}`;
  }

  // ── 4. Login-form heuristic ──────────────────────────────────────────────────
  // A short page with a password input and a sign-in button is almost certainly
  // a login wall that the SPA/server returned with HTTP 200.
  const hasPasswordInput = /<input[^>]+type=["']?password["']?/i.test(body);
  if (hasPasswordInput) {
    const hasLoginButton = /<(button|input)[^>]*(sign[\s-]?in|log[\s-]?in|login|submit)/i.test(body);
    const visibleText    = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (hasLoginButton && visibleText.length < 4000) {
      return "🔒 Login wall — page contains a login form (session may have expired)";
    }
  }

  return null; // no auth issue detected
}

// ─── Functional failure detection ────────────────────────────────────────────
// Catches broken functionality that still returns HTTP 200:
//   JSON APIs   → success:false, ok:false, status:"error", errors[], error field
//   HTML pages  → payment failed, processing error, database error, no results,
//                 feature unavailable, timeout messages, gateway errors

function detectFunctionalFailure(data: unknown): string | null {

  // ── A. JSON / object response analysis ───────────────────────────────────────
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // Top-level success/ok flag
    if (obj.success === false || obj.ok === false) {
      const msg = obj.message ?? obj.error ?? obj.reason ?? obj.detail ?? obj.description ?? "";
      return `⚙ API failure — success=false${msg ? `: "${String(msg).slice(0, 100)}"` : ""}`;
    }

    // Top-level error field
    if (obj.error !== undefined && obj.error !== null && obj.error !== false) {
      const errText = typeof obj.error === "string" ? obj.error
                    : typeof obj.error === "object" ? JSON.stringify(obj.error).slice(0, 100)
                    : String(obj.error);
      if (errText.length > 0 && errText !== "false") {
        return `⚙ API error: "${errText.slice(0, 100)}"`;
      }
    }

    // status / state field
    if (typeof obj.status === "string") {
      const s = obj.status.toLowerCase();
      if (["error", "fail", "failed", "failure", "critical", "fatal"].includes(s)) {
        const msg = obj.message ?? obj.detail ?? "";
        return `⚙ API status="${obj.status}"${msg ? `: "${String(msg).slice(0, 100)}"` : ""}`;
      }
    }

    // errors array
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const first = typeof obj.errors[0] === "string" ? obj.errors[0]
                  : typeof obj.errors[0] === "object" ? (obj.errors[0] as any)?.message ?? JSON.stringify(obj.errors[0])
                  : String(obj.errors[0]);
      return `⚙ API returned ${obj.errors.length} error(s): "${String(first).slice(0, 100)}"`;
    }

    // code field looks like an error
    if (typeof obj.code === "string" && /error|fail|exception|denied|invalid|unauthorized/i.test(obj.code)) {
      return `⚙ API error code: "${obj.code}"`;
    }

    // Nested data / result wrapper (e.g. { "data": { "success": false } })
    const nested = obj.data ?? obj.result ?? obj.response ?? obj.payload;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const n = nested as Record<string, unknown>;
      if (n.success === false || n.ok === false) {
        const msg = n.message ?? n.error ?? "";
        return `⚙ Nested API failure${msg ? `: "${String(msg).slice(0, 100)}"` : ""}`;
      }
      if (typeof n.error === "string" && n.error.length > 0) {
        return `⚙ Nested API error: "${n.error.slice(0, 100)}"`;
      }
    }
  }

  // ── B. HTML / plain-text functional failure phrases ───────────────────────────
  if (typeof data === "string") {
    const FUNCTIONAL: [RegExp, string][] = [
      // Processing / generic action errors
      [/an error occurred (processing|completing|handling|with) your (request|order|payment|submission|transaction)/i,
          "Could not process your request"],
      [/could not (process|complete|handle|finish|submit) (the |your )?(request|order|payment|form|transaction)/i,
          "Processing failed"],
      [/unable to (process|complete|finish|submit|save|create|update|delete)/i,
          "Unable to complete action"],
      [/failed to (submit|save|create|update|delete|send|process)/i,
          "Action failed to complete"],
      [/your (request|submission|order|transaction) (could not be|was not|has not been) (processed|completed|saved|submitted)/i,
          "Request not processed"],

      // Payment / checkout
      [/(payment|transaction|checkout|purchase|order) (failed|was declined|could not be processed|unsuccessful)/i,
          "Payment or transaction failed"],
      [/card (was |has been )?(declined|rejected|not accepted)/i,
          "Card declined"],
      [/insufficient funds?/i,
          "Insufficient funds"],
      [/payment (gateway|processor) (error|unavailable|timed? out)/i,
          "Payment gateway error"],

      // Data / search / database
      [/database (error|connection (error|failed|lost|refused|unavailable))/i,
          "Database connection error"],
      [/failed to (load|fetch|retrieve|get|read) (data|results?|records?|items?)/i,
          "Failed to load data from backend"],
      [/no (results?|items?|products?|records?|entries?) (found|available|returned|to display)/i,
          "No results returned — possible broken query or empty dataset"],
      [/data (not available|unavailable|could not be loaded)/i,
          "Data unavailable"],
      [/(query|search) (failed|error|timed? out)/i,
          "Search or query failed"],

      // Feature / service availability
      [/(the )?(service|feature|function|module|component|integration) is (not available|unavailable|currently down|broken|offline)/i,
          "Feature or service is unavailable"],
      [/feature (not available|unavailable|temporarily disabled|has been disabled)/i,
          "Feature temporarily unavailable"],
      [/this feature is (currently )?unavailable/i,
          "Feature currently unavailable"],

      // Server / infrastructure errors
      [/internal server error/i,                            "Internal server error in response body"],
      [/gateway (error|timeout|bad gateway)/i,              "Gateway error"],
      [/upstream (error|connection|service)/i,              "Upstream service error"],
      [/(server|service|backend) (is )?(unavailable|overloaded|not responding)/i,
          "Server/service not responding"],
      [/(timeout|timed? out) (waiting for|while|connecting to) (the )?(server|database|service|api|backend)/i,
          "Backend timeout"],
      [/connection (to|with) (the )?(database|server|service|api) (failed|refused|lost|reset)/i,
          "Backend connection failed"],

      // Application / generic runtime errors
      [/sorry,? (we('?re| are) experiencing|there (was |is )?(a |an )?)(technical |unexpected )?(difficulty|problem|issue|error)/i,
          "Service experiencing technical difficulties"],
      [/something (has )?gone wrong/i,                      "Something went wrong in the application"],
      [/unexpected (error|exception|failure)/i,             "Unexpected application error"],
      [/runtime (error|exception)/i,                        "Runtime error"],
      [/unhandled (exception|error|rejection)/i,            "Unhandled exception"],
      [/null (pointer|reference) (exception|error)/i,       "Null pointer/reference error"],
      [/stack (trace|overflow)/i,                           "Stack trace / overflow error"],
    ];

    for (const [re, label] of FUNCTIONAL) {
      if (re.test(data)) return `⚙ ${label}`;
    }
  }

  return null; // no functional failure detected
}

// ─── Response body validation ─────────────────────────────────────────────────

function resolveJsonPath(obj: unknown, dotPath: string): unknown {
  return dotPath.split(".").reduce((acc: any, key) => acc?.[key], obj);
}

function validateBody(body: unknown, validation: ProjectValidation): string | null {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);

  if (validation.keyword) {
    if (!bodyStr.includes(validation.keyword)) {
      return `Expected keyword "${validation.keyword}" not found in response body`;
    }
  }

  if (validation.forbiddenKeyword) {
    if (bodyStr.includes(validation.forbiddenKeyword)) {
      return `Forbidden keyword "${validation.forbiddenKeyword}" detected in response body`;
    }
  }

  if (validation.jsonPath) {
    try {
      const parsed = typeof body === "object" ? body : JSON.parse(bodyStr);
      const actual = resolveJsonPath(parsed, validation.jsonPath);
      if (validation.jsonExpected !== undefined && String(actual) !== String(validation.jsonExpected)) {
        return `JSON path "${validation.jsonPath}" = "${actual}" (expected "${validation.jsonExpected}")`;
      }
    } catch {
      return `Response body is not valid JSON (can't check path "${validation.jsonPath}")`;
    }
  }

  return null; // null = validation passed
}

// ─── TCP Port Check ───────────────────────────────────────────────────────────

interface TcpCheckResult {
  connected: boolean;
  responseTime: number;
  error?: string;
}

async function checkTcpPort(host: string, port: number, timeoutMs = 8000): Promise<TcpCheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (r: TcpCheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => finish({ connected: true, responseTime: Date.now() - start }));
    socket.on("timeout", () => finish({ connected: false, responseTime: Date.now() - start, error: "timeout" }));
    socket.on("error", (e: NodeJS.ErrnoException) =>
      finish({ connected: false, responseTime: Date.now() - start, error: e.code || e.message })
    );
  });
}

/**
 * Parse host and port from various URL formats:
 *   mysql://user:pass@host:3306/db  → host:3306
 *   postgresql://host:5432          → host:5432
 *   redis://host:6379               → host:6379
 *   192.168.1.1:22                  → 192.168.1.1:22
 *   host:3306                       → host:3306
 *   ssh://server.com:22             → server.com:22
 *   tcp://host:9000                 → host:9000
 */
function parseHostPort(urlStr: string, fallbackPort: number): { host: string; port: number } | null {
  const s = urlStr.trim();
  if (!s) return null;

  // Has a scheme (mysql://, tcp://, ssh://, postgresql://, etc.)
  if (/^\w+:\/\//i.test(s)) {
    try {
      // URL class can't handle unknown protocols — swap in http:// for parsing
      const u = new URL(s.replace(/^\w+:\/\//, "http://"));
      const host = u.hostname;
      const port = u.port ? parseInt(u.port, 10) : fallbackPort;
      if (!host) return null;
      return { host, port };
    } catch { return null; }
  }

  // host:port or ip:port (without scheme)
  const ci = s.lastIndexOf(":");
  if (ci > 0) {
    const portPart = s.slice(ci + 1);
    if (/^\d{1,5}$/.test(portPart)) {
      const port = parseInt(portPart, 10);
      if (port > 0 && port < 65536) return { host: s.slice(0, ci), port };
    }
  }

  // Bare hostname — use fallback port
  return { host: s, port: fallbackPort };
}

/** Returns the default TCP port for common database protocols */
function getDbDefaultPort(url: string): number {
  const m = url.match(/^(\w+):\/\//i);
  const proto = m?.[1]?.toLowerCase() ?? "";
  const MAP: Record<string, number> = {
    mysql: 3306,
    mariadb: 3306,
    postgresql: 5432,
    postgres: 5432,
    mongodb: 27017,
    mongo: 27017,
    redis: 6379,
    mssql: 1433,
    sqlserver: 1433,
    oracle: 1521,
    cassandra: 9042,
    memcached: 11211,
    couchdb: 5984,
    elasticsearch: 9200,
    clickhouse: 8123,
  };
  return MAP[proto] ?? 5432;
}

// ─── Monitoring Engine ───────────────────────────────────────────────────────

function determineSeverity(status: ProjectStatus, responseTime: number): IssueSeverity {
  if (status === "down") return "critical";
  if (responseTime > 5000) return "high";
  if (responseTime > 2000) return "medium";
  return "low";
}

function updateDailyHistory(history: number[], val: number): number[] {
  const h = Array.isArray(history) ? [...history] : [];
  if (h.length === 0 || h.length < 90) { h.push(val); }
  else { if (h.length >= 90) h.shift(); h.push(val); }
  return h;
}

async function checkProject(project: Project): Promise<void> {
  const start = Date.now();
  let newStatus: ProjectStatus = "unknown";
  let statusCode: number | undefined;
  let responseTime = 0;
  let logMessage = "";
  let logType: LogType = "info";

  const threshold = project.responseTimeThreshold || 3000;
  const isHttpUrl = /^https?:\/\//i.test(project.url);

  // ── Type tag used in log messages (shown in Console) ─────────────────────
  const TYPE_TAG: Record<string, string> = {
    website:  "[HTTP]",
    api:      "[API]",
    server:   "[TCP]",
    database: "[DB]",
  };
  const typeTag = TYPE_TAG[project.type] ?? "[HTTP]";

  // ─────────────────────────────────────────────────────────────────────────
  // DECISION: check method is driven by URL format, NOT project type.
  //   • http:// or https://  →  full HTTP check  (any project type)
  //   • everything else       →  TCP port check   (any project type)
  //
  // This means:
  //   Website  https://example.com     → HTTP  ✓
  //   API      https://api.example.com → HTTP  ✓
  //   Server   https://srv.example.com → HTTP  ✓
  //   Database https://db.example.com  → HTTP  ✓  (e.g. PlanetScale / Neon HTTP APIs)
  //   Server   192.168.1.1:22          → TCP   ✓
  //   Database mysql://host:3306       → TCP   ✓
  //   Database host:5432               → TCP   ✓
  // ─────────────────────────────────────────────────────────────────────────

  if (!isHttpUrl) {
    // ── TCP / port-reachability check ─────────────────────────────────────
    const defaultPort = getDbDefaultPort(project.url);   // 5432 for unknown
    const hp = parseHostPort(project.url, defaultPort);

    if (!hp) {
      responseTime = Date.now() - start;
      newStatus = "down";
      logType = "error";
      logMessage = `${typeTag} Invalid URL — cannot parse host/port. Use: host:port, mysql://host:3306, or https://...`;
    } else {
      const result = await checkTcpPort(hp.host, hp.port);
      responseTime = result.responseTime;

      if (result.connected) {
        newStatus = responseTime > threshold ? "degraded" : "operational";
        logType = newStatus === "operational" ? "success" : "warning";
        logMessage = `${typeTag} Port ${hp.port} reachable on ${hp.host} — ${responseTime}ms${
          responseTime > threshold ? ` (Slow — threshold ${threshold}ms)` : ""
        }`;
      } else {
        newStatus = "down";
        logType = "error";
        const e = result.error ?? "";
        if (e === "timeout") {
          logMessage = `${typeTag} Connection timeout — ${hp.host}:${hp.port} did not respond in ${responseTime}ms`;
        } else if (e === "ECONNREFUSED") {
          logMessage = `${typeTag} Port ${hp.port} refused on ${hp.host} — nothing listening`;
        } else if (e === "ENOTFOUND") {
          logMessage = `${typeTag} DNS failure — cannot resolve "${hp.host}"`;
        } else if (e === "ENETUNREACH" || e === "EHOSTUNREACH") {
          logMessage = `${typeTag} Network unreachable — ${hp.host}:${hp.port}`;
        } else {
          logMessage = `${typeTag} TCP check failed for ${hp.host}:${hp.port} — ${e}`;
        }
      }
    }
  } else {
    // ── Full HTTP check (all project types with http/https URL) ───────────
    let detectedFinalUrl: string | undefined;

    try {
      const headers: Record<string, string> = {
        "User-Agent": "LuminaMonitor/1.0",
        "Accept": "application/json, text/html, */*",
        ...project.credentials?.customHeaders,
      };
      if (project.credentials?.authHeader) {
        headers["Authorization"] = project.credentials.authHeader;
      }

      const method = project.credentials?.method || "GET";

      // Parse optional request body (used to simulate form/API submissions)
      let requestData: unknown = undefined;
      if (project.credentials?.body && ["POST", "PUT", "PATCH"].includes(method)) {
        try {
          requestData = JSON.parse(project.credentials.body);
          if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
        } catch {
          requestData = project.credentials.body; // send as raw text
          if (!headers["Content-Type"]) headers["Content-Type"] = "text/plain";
        }
      }

      const response = await axios({
        method,
        url: project.url,
        timeout: 10000,
        headers,
        validateStatus: null,  // never throw on HTTP errors — handle ourselves
        maxRedirects: 10,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        ...(requestData !== undefined ? { data: requestData } : {}),
      });

      responseTime = Date.now() - start;
      statusCode = response.status;

      // ── Redirect chain detection ────────────────────────────────────────
      try {
        const respUrl = (response.request as any)?.res?.responseUrl as string | undefined;
        if (respUrl && respUrl !== project.url) {
          detectedFinalUrl = respUrl;
          const origHost  = new URL(project.url).hostname;
          const finalHost = new URL(respUrl).hostname;
          if (origHost !== finalHost) {
            logMessage += ` | ↪ Cross-domain redirect → ${finalHost}`;
          }
        }
      } catch {}

      if (statusCode >= 500) {
        newStatus = "down";
        logType = "error";
        logMessage = `${typeTag} ${statusCode} ${response.statusText} — ${responseTime}ms (Server Error)`;
      } else if (statusCode === 401 || statusCode === 403) {
        newStatus = "degraded";
        logType = "warning";
        logMessage = `${typeTag} ${statusCode} ${response.statusText} — ${responseTime}ms (Auth Required)`;
      } else if (statusCode === 405) {
        newStatus = "degraded";
        logType = "warning";
        logMessage = `${typeTag} ${statusCode} Method Not Allowed — ${responseTime}ms (Try a different HTTP method)`;
      } else if (statusCode >= 400) {
        newStatus = "degraded";
        logType = "warning";
        logMessage = `${typeTag} ${statusCode} ${response.statusText} — ${responseTime}ms (Client Error)`;
      } else {
        // ── 2xx / 3xx ──────────────────────────────────────────────────
        newStatus = responseTime > threshold ? "degraded" : "operational";
        logType = newStatus === "operational" ? "success" : "warning";
        logMessage = `${typeTag} ${statusCode} ${response.statusText} — ${responseTime}ms${
          responseTime > threshold ? ` (Slow — threshold ${threshold}ms)` : ""
        }`;

        // ── Body validation (custom rules) ─────────────────────────────
        if (project.validation && method !== "HEAD") {
          const validationError = validateBody(response.data, project.validation);
          if (validationError) {
            newStatus = "degraded";
            logType = "warning";
            logMessage += ` | Validation: ${validationError}`;
          }
        }

        // ── Empty / minimal body detection (non-API types only) ───────────
        if (project.type !== "api" && method !== "HEAD" && newStatus === "operational") {
          const bodyStr = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
          if (bodyStr.trim().length < 80) {
            newStatus = "degraded";
            logType = "warning";
            logMessage += ` | Empty body (${bodyStr.trim().length} chars) — possible blank page`;
          }
        }

        // ── Soft-error detection ────────────────────────────────────────
        // Catches pages that return HTTP 200 but render a 404/error/maintenance
        // page in the body — e.g. "Error: Page not found / The requested URL
        // was not found on this server."
        if (method !== "HEAD" && newStatus === "operational") {
          const rawBody = typeof response.data === "string"
            ? response.data
            : typeof response.data === "object" ? JSON.stringify(response.data) : "";
          const softErr = detectSoftError(rawBody);
          if (softErr) {
            newStatus = "degraded";
            logType   = "warning";
            logMessage += ` | ⚠ ${softErr}`;
          }
        }

        // ── Login / Auth issue detection ────────────────────────────────
        // Catches: session expiry, login walls, wrong-password errors, 2FA
        // challenges, account lockouts, auth redirects — all of which a server
        // may return as HTTP 200.
        if (method !== "HEAD" && newStatus === "operational") {
          const rawBody = typeof response.data === "string"
            ? response.data
            : typeof response.data === "object" ? JSON.stringify(response.data) : "";
          const authIssue = detectLoginIssue(rawBody, detectedFinalUrl, project.url);
          if (authIssue) {
            newStatus = "degraded";
            logType   = "warning";
            logMessage += ` | ${authIssue}`;
          }
        }

        // ── Functional failure detection ────────────────────────────────
        // Catches broken functionality that returns HTTP 200 but signals an
        // error in the response body — JSON API errors (success:false, errors[],
        // error field, status:"error") and HTML patterns (payment failed,
        // database error, processing failed, feature unavailable, etc.).
        if (method !== "HEAD" && newStatus === "operational") {
          const funcErr = detectFunctionalFailure(response.data);
          if (funcErr) {
            newStatus = "degraded";
            logType   = "warning";
            logMessage += ` | ${funcErr}`;
          }
        }

        // ── Response time anomaly detection ────────────────────────────
        // Only fires when we have ≥8 baseline samples to compare against
        if (newStatus === "operational") {
          const prevSamples = project.responseTimeSamples || [];
          if (prevSamples.length >= 8) {
            const sorted = [...prevSamples].sort((a, b) => a - b);
            const p75 = sorted[Math.floor(sorted.length * 0.75)];
            const p25 = sorted[Math.floor(sorted.length * 0.25)];
            const iqr = p75 - p25;
            // Tukey outlier upper fence: p75 + 2.5*IQR, but also 3× p75 floor
            const anomalyThreshold = Math.max(p75 + 2.5 * iqr, p75 * 3);
            if (responseTime > anomalyThreshold && responseTime > 1500) {
              newStatus = "degraded";
              logType = "warning";
              logMessage += ` | ⚡ RT spike: ${responseTime}ms vs baseline p75 ${Math.round(p75)}ms`;
            }
          }
        }
      }
    } catch (err: any) {
      responseTime = Date.now() - start;
      newStatus = "down";
      logType = "error";
      if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        logMessage = `Timeout after ${responseTime}ms — server did not respond`;
      } else if (err.code === "ENOTFOUND") {
        logMessage = `DNS resolution failed — hostname not found`;
      } else if (err.code === "ECONNREFUSED") {
        logMessage = `Connection refused — nothing listening at this address`;
      } else if (err.code === "CERT_HAS_EXPIRED" || err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
        logMessage = `SSL certificate error — ${err.code}`;
        newStatus = "degraded";
        logType = "warning";
      } else {
        logMessage = `Connection failed — ${err.message}`;
      }
    }

    // Store final URL if we detected a redirect
    if (detectedFinalUrl) {
      // We'll write it to the project record below
      (project as any)._detectedFinalUrl = detectedFinalUrl;
    }
  }

  // ── Multi-method sweep (all 6 methods in parallel, HTTP endpoints only) ──
  let methodResults: Record<string, MethodResult> | undefined;
  if (isHttpUrl) {
    const ALL_METHODS = ["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE"] as const;
    const baseHeaders: Record<string, string> = {
      "User-Agent": "LuminaMonitor/1.0",
      "Accept": "application/json, text/html, */*",
      ...project.credentials?.customHeaders,
    };
    if (project.credentials?.authHeader) baseHeaders["Authorization"] = project.credentials.authHeader;

    const results = await Promise.all(
      ALL_METHODS.map(async (m): Promise<[string, MethodResult]> => {
        const t0 = Date.now();
        try {
          const r = await axios({
            method: m,
            url: project.url,
            timeout: 5000,
            headers: baseHeaders,
            validateStatus: null,
            maxContentLength: 1024,
            maxRedirects: 3,
            data: ["POST", "PUT", "PATCH"].includes(m) ? {} : undefined,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          });
          return [m, { status: r.status, responseTime: Date.now() - t0, ok: r.status < 500, checkedAt: Date.now() }];
        } catch (err: any) {
          // Map raw axios/node error codes → human-readable labels
          const raw = err.code as string | undefined;
          const isTimeout = raw === "ECONNABORTED" || raw === "ETIMEDOUT" || err.message?.includes("timeout");
          const label = isTimeout                  ? "Timeout"
                      : raw === "ENOTFOUND"        ? "DNS Error"
                      : raw === "ECONNREFUSED"     ? "Refused"
                      : raw === "ECONNRESET"       ? "Reset"
                      : raw === "ENETUNREACH"      ? "Unreachable"
                      : raw === "CERT_HAS_EXPIRED" ? "SSL Expired"
                      : raw                        ? raw
                      : "Error";
          return [m, { status: null, responseTime: Date.now() - t0, ok: false, error: label, checkedAt: Date.now() }];
        }
      })
    );
    methodResults = Object.fromEntries(results);
  }

  // SSL check (only for https:// endpoints — website & api mostly)
  let sslDaysLeft: number | null = null;
  if (isHttpUrl && project.url.startsWith("https://")) {
    sslDaysLeft = await checkSslCert(project.url);
    if (sslDaysLeft !== null && sslDaysLeft <= 14 && newStatus === "operational") {
      newStatus = "degraded";
      logType = "warning";
      logMessage += ` | SSL cert expires in ${sslDaysLeft} day${sslDaysLeft !== 1 ? "s" : ""}`;
    }
  }

  // Persist project update
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx === -1) return;

  const prev = projects[idx];

  // ── Consecutive failure confirmation gate ─────────────────────────────────
  // Require 2 consecutive failed checks before transitioning from operational.
  // This eliminates false positives from single-check network blips.
  const prevConsFailures = prev.consecutiveFailures ?? 0;
  const newConsFailures  = newStatus !== "operational" ? prevConsFailures + 1 : 0;

  if (newStatus !== "operational" && prevConsFailures === 0 && prev.status === "operational") {
    // First failure after being operational — hold status, await next check
    newStatus = "operational";
    logType   = "warning";
    logMessage += " · Unconfirmed — awaiting next check to confirm";
  }

  // ── Update response time sample ring buffer ───────────────────────────────
  const newSamples = [...(prev.responseTimeSamples || []), responseTime].slice(-20);

  // ── Collect final URL if redirect was detected ────────────────────────────
  const detectedFinalUrl: string | undefined = (project as any)._detectedFinalUrl;

  const isNewIssue =
    (newStatus === "degraded" || newStatus === "down") &&
    (prev.status === "operational" || prev.status === "unknown");
  const isResolved =
    newStatus === "operational" &&
    (prev.status === "degraded" || prev.status === "down");

  projects[idx] = {
    ...prev,
    status: newStatus,
    lastChecked: Date.now(),
    lastStatusCode: statusCode,
    lastResponseTime: responseTime,
    checkCount: (prev.checkCount || 0) + 1,
    successCount: (prev.successCount || 0) + (newStatus === "operational" ? 1 : 0),
    uptimePct:
      Math.round(
        (((prev.successCount || 0) + (newStatus === "operational" ? 1 : 0)) /
          ((prev.checkCount || 0) + 1)) *
          10000
      ) / 100,
    history: updateDailyHistory(prev.history, newStatus === "operational" ? 1 : 0),
    sslDaysLeft: sslDaysLeft !== null ? sslDaysLeft : prev.sslDaysLeft,
    sslCheckedAt: sslDaysLeft !== null ? Date.now() : prev.sslCheckedAt,
    ...(methodResults ? { methodResults } : {}),
    // Accuracy fields
    consecutiveFailures: newConsFailures,
    responseTimeSamples: newSamples,
    ...(detectedFinalUrl ? { finalUrl: detectedFinalUrl } : {}),
  };
  writeJson(FILES.projects, projects);

  // Persist log
  const logs = readLogs();
  const newLog: LogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: project.id,
    timestamp: Date.now(),
    type: logType,
    message: logMessage,
    statusCode,
    responseTime,
  };
  logs.unshift(newLog);
  writeJson(FILES.logs, logs.slice(0, 5000));

  // ── Append health record (time-series store for metrics dashboard) ───────
  const healthRecs = readHealthRecords();
  const newRec: HealthRecord = {
    id: `hr_${project.id.slice(-6)}_${String(healthRecs.length)}`,
    projectId: project.id,
    timestamp: newLog.timestamp,   // reuse the timestamp we already have
    status: newStatus,
    responseTime,
    statusCode,
    errorMessage: (logType === "error" || logType === "warning") ? logMessage.slice(0, 200) : undefined,
    checkType: isHttpUrl ? "http" : "tcp",
  };
  healthRecs.unshift(newRec);
  writeJson(FILES.healthRecords, healthRecs.slice(0, 50000));

  // Broadcast individual log to Console view in real-time
  broadcast("log", { ...newLog, projectName: project.name });

  // Handle issues + notifications
  let newNotif: AppNotification | null = null;
  const issues = readIssues();

  // Guard: only create a new issue if there isn't already an open one for this project
  // (prevents duplicate notifications from overlapping checks)
  const alreadyHasOpenIssue = issues.some(
    (i) => i.projectId === project.id && i.status === "open"
  );

  // ── Check maintenance window (suppress alerts but still log) ────────────────
  const inMaintenance = isInMaintenanceWindow(project.id);

  if (isNewIssue && !alreadyHasOpenIssue) {
    const severity = determineSeverity(newStatus, responseTime);
    const newIssue: Issue = {
      id: `issue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      projectId: project.id,
      startedAt: Date.now(),
      severity,
      message: logMessage,
      status: "open",
    };
    issues.unshift(newIssue);
    writeJson(FILES.issues, issues);

    newNotif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      projectId: project.id,
      projectName: project.name,
      timestamp: Date.now(),
      message: `${project.name}: ${logMessage}`,
      severity,
      read: false,
    };
    const notifs = readNotifications();
    notifs.unshift(newNotif);
    writeJson(FILES.notifications, notifs.slice(0, 200));

    if (!inMaintenance) {
      if (project.notifyEmail) {
        sendEmail(
          project.notifyEmail,
          `[Lumina Alert] ${project.name} is ${newStatus.toUpperCase()}`,
          `Issue detected at ${new Date().toISOString()}\n\nProject: ${project.name}\nURL: ${project.url}\nStatus: ${newStatus}\nDetail: ${logMessage}\n\n— Lumina Monitor`
        );
      }
      // Fire Slack + webhook alerts
      sendSlackAlert(projects[idx], newStatus, logMessage, false);
      sendWebhookAlert(projects[idx], newStatus, logMessage, false);
    } else {
      console.log(`[MONITOR] ${project.name} — alert suppressed (maintenance window active)`);
    }
  }

  if (isResolved) {
    const open = issues.find((i) => i.projectId === project.id && i.status === "open");
    if (open) {
      open.status = "resolved";
      open.resolvedAt = Date.now();
      writeJson(FILES.issues, issues);
    }

    if (!inMaintenance) {
      // Auto-resolve notifications via Slack + webhook
      sendSlackAlert(projects[idx], "operational", `${project.name} is back to operational`, true);
      sendWebhookAlert(projects[idx], "operational", `${project.name} recovered`, true);

      if (project.notifyEmail) {
        sendEmail(
          project.notifyEmail,
          `[Lumina] ${project.name} RECOVERED`,
          `Issue resolved at ${new Date().toISOString()}\n\nProject: ${project.name}\nURL: ${project.url}\nStatus: Operational\n\n— Lumina Monitor`
        );
      }
    }
  }

  // Broadcast to all WebSocket clients
  broadcast("projects_update", readProjects());
  if (newNotif) broadcast("notification", newNotif);

  // Push real-time update to every /status SSE subscriber
  pushStatusUpdate();

  console.log(`[MONITOR] ${project.name} → ${newStatus} (${responseTime}ms)${sslDaysLeft !== null ? ` | SSL ${sslDaysLeft}d` : ""}`);
}

// Master loop — every 60 seconds, check due projects
// runningChecks prevents overlapping concurrent writes when a slow check
// hasn't finished before the next interval fires.
const runningChecks = new Set<string>();
setInterval(() => {
  const now = Date.now();
  for (const project of readProjects()) {
    if (!project.enabled) continue;
    if (runningChecks.has(project.id)) continue; // skip if already in-flight
    const due = !project.lastChecked || now - project.lastChecked >= project.checkInterval * 60000;
    if (due) {
      runningChecks.add(project.id);
      checkProject(project)
        .catch((e) => console.error("[MONITOR ERROR]", e))
        .finally(() => runningChecks.delete(project.id));
    }
  }
}, 60000);

// ─── Public Status Page ───────────────────────────────────────────────────────

function timeAgoStr(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60000)   return "just now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  return `${Math.floor(d / 3600000)}h ago`;
}

function durationStr(ms: number): string {
  const d = Date.now() - ms;
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildStatusPage(projects: Project[], issues: Issue[], settings: AppSettings): string {
  const title      = settings.statusPageTitle || "System Status";
  const hasIssues  = projects.some((p) => p.status === "down" || p.status === "degraded");
  const openIssues = issues.filter((i) => i.status === "open");
  const recentResolved = issues
    .filter((i) => i.status === "resolved" && i.resolvedAt && Date.now() - i.resolvedAt < 24 * 3600000)
    .slice(0, 5);

  // ── helpers ────────────────────────────────────────────────────────────────

  const dotSvg = (status: string) => {
    const color = status === "operational" ? "#3ecf8e"
                : status === "degraded"    ? "#f59e0b"
                : status === "down"        ? "#f43f5e"
                : "#d1d5db";
    const pulse = (status === "down" || status === "degraded")
      ? `@keyframes ping{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.2);opacity:0}}`
      : "";
    return `<span style="position:relative;display:inline-flex;width:12px;height:12px;flex-shrink:0">
      ${pulse ? `<style>${pulse}</style><span style="position:absolute;inset:0;border-radius:50%;background:${color};animation:ping 1.2s ease-out infinite;opacity:.6"></span>` : ""}
      <span style="position:relative;display:inline-flex;width:12px;height:12px;border-radius:50%;background:${color}"></span>
    </span>`;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, [string, string]> = {
      operational: ["#ecfdf5","#059669"],
      degraded:    ["#fffbeb","#d97706"],
      down:        ["#fff1f2","#e11d48"],
      unknown:     ["#f9fafb","#9ca3af"],
    };
    const [bg, color] = map[status] ?? map.unknown;
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${bg};color:${color}">${label}</span>`;
  };

  const severityColor = (sev: string) =>
    sev === "critical" ? "#e11d48"
    : sev === "high"   ? "#ea580c"
    : sev === "medium" ? "#d97706"
    : "#2563eb";

  // ── incident cards ──────────────────────────────────────────────────────────

  const incidentCards = openIssues.map((i) => {
    const proj    = projects.find((p) => p.id === i.projectId);
    const sc      = severityColor(i.severity);
    return `
    <div id="incident-${i.id}" class="incident-card" style="background:#fff;border:1px solid #fecdd3;border-left:4px solid ${sc};border-radius:12px;padding:16px 20px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;background:${sc}1a;color:${sc};padding:2px 8px;border-radius:20px">${i.severity}</span>
          <span style="font-size:14px;font-weight:700;color:#111">${proj?.name ?? "Unknown"}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:6px">🕐 Started ${new Date(i.startedAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
          <span style="font-size:11px;color:#e11d48;font-weight:700;background:#fff1f2;padding:2px 8px;border-radius:6px">Ongoing for ${durationStr(i.startedAt)}</span>
        </div>
      </div>
      <p style="margin:10px 0 0;font-size:12px;color:#374151;line-height:1.5">${i.message}</p>
    </div>`;
  }).join("");

  const resolvedCards = recentResolved.map((i) => {
    const proj = projects.find((p) => p.id === i.projectId);
    const dur  = i.resolvedAt
      ? Math.round((i.resolvedAt - i.startedAt) / 60000)
      : 0;
    return `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #3ecf8e;border-radius:12px;padding:14px 18px;margin-bottom:10px;opacity:.85">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;color:#059669;background:#dcfce7;padding:2px 8px;border-radius:20px">Resolved</span>
          <span style="font-size:13px;font-weight:700;color:#111">${proj?.name ?? "Unknown"}</span>
        </div>
        <span style="font-size:11px;color:#6b7280">Resolved ${timeAgoStr(i.resolvedAt!)} · lasted ${dur}m</span>
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#374151">${i.message}</p>
    </div>`;
  }).join("");

  // ── project rows ───────────────────────────────────────────────────────────

  const rows = projects.map((p) => {
    const sslBadge = p.sslDaysLeft != null
      ? p.sslDaysLeft <= 7
        ? `<span style="font-size:10px;color:#e11d48;font-weight:700;background:#fff1f2;padding:2px 6px;border-radius:6px;margin-left:8px">SSL ${p.sslDaysLeft}d!</span>`
        : p.sslDaysLeft <= 14
        ? `<span style="font-size:10px;color:#d97706;font-weight:700;background:#fffbeb;padding:2px 6px;border-radius:6px;margin-left:8px">SSL ${p.sslDaysLeft}d</span>`
        : ""
      : "";
    return `
    <div data-proj="${p.id}" style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f3f4f6;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:10px">
        ${dotSvg(p.status)}
        <span style="font-weight:600;font-size:14px">${p.name}</span>
        ${sslBadge}
      </div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <span style="font-size:12px;color:#9ca3af;font-family:monospace">${p.uptimePct.toFixed(2)}%</span>
        <span style="font-size:11px;color:#9ca3af">${p.lastChecked ? timeAgoStr(p.lastChecked) : "pending"}</span>
        ${statusBadge(p.status)}
      </div>
    </div>`;
  }).join("");

  // ── overall banner ─────────────────────────────────────────────────────────

  const bannerBg    = hasIssues ? "#fff1f2" : "#f0fdf4";
  const bannerColor = hasIssues ? "#e11d48" : "#059669";
  const bannerIcon  = hasIssues
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${bannerColor}" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${bannerColor}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  const bannerText  = hasIssues
    ? `${openIssues.length} active incident${openIssues.length !== 1 ? "s" : ""} — investigating`
    : "All Systems Operational";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title id="page-title">${hasIssues ? `(${openIssues.length}) ` : ""}${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#111827;min-height:100vh}
    .wrap{max-width:700px;margin:0 auto;padding:48px 20px 80px}
    @keyframes slideIn{from{transform:translateY(-12px);opacity:0}to{transform:translateY(0);opacity:1}}
    .incident-card{animation:slideIn .3s ease}
    .live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#3ecf8e;margin-right:5px}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    .live-dot{animation:blink 2s ease-in-out infinite}
    @media(max-width:500px){.wrap{padding:28px 14px 60px}}
  </style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:36px">
    <div style="width:38px;height:38px;background:#3ecf8e;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    </div>
    <h1 style="font-size:22px;font-weight:800;letter-spacing:-.4px">${title}</h1>
  </div>

  <!-- Overall status banner -->
  <div id="status-banner" style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-radius:14px;background:${bannerBg};margin-bottom:28px;border:1px solid ${hasIssues ? "#fecdd3" : "#bbf7d0"}">
    ${bannerIcon}
    <span id="status-text" style="font-weight:700;font-size:14px;color:${bannerColor};flex:1">${bannerText}</span>
    <span style="font-size:11px;color:#9ca3af;display:flex;align-items:center"><span class="live-dot"></span>Live</span>
  </div>

  <!-- Active Incidents -->
  <div id="incidents-wrapper" style="${openIssues.length === 0 ? "display:none" : ""}">
    <p style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#e11d48;margin-bottom:12px">
      🚨 Active Incidents (${openIssues.length})
    </p>
    <div id="incidents-list">${incidentCards}</div>
  </div>

  <!-- Services -->
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:0 20px;margin-bottom:24px">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 0 4px">
      <p style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af">Services (${projects.length})</p>
      <span style="font-size:11px;color:#9ca3af" id="last-checked">Checked ${new Date().toLocaleTimeString()}</span>
    </div>
    <div id="services-list">${rows || '<p style="padding:20px 0;color:#9ca3af;font-size:14px">No services configured yet.</p>'}</div>
  </div>

  <!-- Recently resolved (last 24h) -->
  ${recentResolved.length > 0 ? `
  <div style="margin-bottom:24px">
    <p style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#059669;margin-bottom:10px">✓ Recently Resolved</p>
    ${resolvedCards}
  </div>` : ""}

  <!-- Footer -->
  <p id="footer-ts" style="text-align:center;font-size:11px;color:#9ca3af;margin-top:8px">
    Last updated ${new Date().toLocaleString()} · Real-time via SSE
  </p>
</div>

<script>
// ── Real-time updates via Server-Sent Events ──────────────────────────────────
(function() {
  var title = ${JSON.stringify(title)};

  function ago(ms) {
    var d = Date.now() - ms;
    if (d < 60000)   return 'just now';
    if (d < 3600000) return Math.floor(d/60000) + 'm ago';
    return Math.floor(d/3600000) + 'h ago';
  }
  function dur(ms) {
    var d = Date.now() - ms;
    if (d < 3600000) return Math.floor(d/60000) + 'm';
    var h = Math.floor(d/3600000), m = Math.floor((d%3600000)/60000);
    return m > 0 ? h+'h '+m+'m' : h+'h';
  }
  function dotHtml(status) {
    var color = status==='operational'?'#3ecf8e':status==='degraded'?'#f59e0b':status==='down'?'#f43f5e':'#d1d5db';
    var pulse = (status==='down'||status==='degraded')
      ? '<span style="position:absolute;inset:0;border-radius:50%;background:'+color+';animation:ping 1.2s ease-out infinite;opacity:.6"></span>'
      : '';
    return '<span style="position:relative;display:inline-flex;width:12px;height:12px;flex-shrink:0">'
      + pulse
      + '<span style="position:relative;display:inline-flex;width:12px;height:12px;border-radius:50%;background:'+color+'"></span>'
      + '</span>';
  }
  function badgeHtml(status) {
    var map = {operational:['#ecfdf5','#059669'],degraded:['#fffbeb','#d97706'],down:['#fff1f2','#e11d48'],unknown:['#f9fafb','#9ca3af']};
    var c = map[status]||map.unknown;
    var label = status.charAt(0).toUpperCase()+status.slice(1);
    return '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:'+c[0]+';color:'+c[1]+'">'+label+'</span>';
  }
  function sevColor(s){return s==='critical'?'#e11d48':s==='high'?'#ea580c':s==='medium'?'#d97706':'#2563eb';}

  function applyUpdate(data) {
    var projects   = data.projects   || [];
    var issues     = data.issues     || [];
    var hasIssues  = data.hasIssues  || false;
    var openIssues = issues.filter(function(i){return i.status==='open';});

    // ── Overall banner ──────────────────────────────────────────────────────
    var banner  = document.getElementById('status-banner');
    var bannerT = document.getElementById('status-text');
    if (banner && bannerT) {
      var bg = hasIssues ? '#fff1f2' : '#f0fdf4';
      var bc = hasIssues ? '#e11d48' : '#059669';
      var brd = hasIssues ? '#fecdd3' : '#bbf7d0';
      var txt = hasIssues
        ? openIssues.length + ' active incident'+(openIssues.length!==1?'s':'')+' — investigating'
        : 'All Systems Operational';
      banner.style.background = bg;
      banner.style.borderColor = brd;
      bannerT.textContent = txt;
      bannerT.style.color = bc;
    }

    // ── Document title (shows count in browser tab) ─────────────────────────
    document.title = hasIssues ? '('+openIssues.length+') '+title : title;

    // ── Incidents section ───────────────────────────────────────────────────
    var wrapper = document.getElementById('incidents-wrapper');
    var list    = document.getElementById('incidents-list');
    if (wrapper && list) {
      if (openIssues.length === 0) {
        wrapper.style.display = 'none';
      } else {
        wrapper.style.display = '';
        wrapper.querySelector('p').textContent = '🚨 Active Incidents (' + openIssues.length + ')';
        var html = openIssues.map(function(i) {
          var proj = projects.find(function(p){return p.id===i.projectId;});
          var sc = sevColor(i.severity);
          return '<div id="incident-'+i.id+'" class="incident-card" style="background:#fff;border:1px solid #fecdd3;border-left:4px solid '+sc+';border-radius:12px;padding:16px 20px;margin-bottom:12px">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">'
            + '<div style="display:flex;align-items:center;gap:10px">'
            + '<span style="font-size:10px;font-weight:800;text-transform:uppercase;background:'+sc+'1a;color:'+sc+';padding:2px 8px;border-radius:20px">'+i.severity+'</span>'
            + '<span style="font-size:14px;font-weight:700;color:#111">'+(proj?proj.name:'Unknown')+'</span>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:8px">'
            + '<span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:6px">🕐 '+new Date(i.startedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+'</span>'
            + '<span style="font-size:11px;color:#e11d48;font-weight:700;background:#fff1f2;padding:2px 8px;border-radius:6px">'+dur(i.startedAt)+'</span>'
            + '</div></div>'
            + '<p style="margin:10px 0 0;font-size:12px;color:#374151;line-height:1.5">'+i.message+'</p>'
            + '</div>';
        }).join('');
        list.innerHTML = html;
      }
    }

    // ── Services list ───────────────────────────────────────────────────────
    var serviceList = document.getElementById('services-list');
    if (serviceList && projects.length > 0) {
      var shtml = projects.map(function(p) {
        var sslBadge = '';
        if (p.sslDaysLeft != null) {
          if (p.sslDaysLeft <= 7)
            sslBadge = '<span style="font-size:10px;color:#e11d48;font-weight:700;background:#fff1f2;padding:2px 6px;border-radius:6px;margin-left:8px">SSL '+p.sslDaysLeft+'d!</span>';
          else if (p.sslDaysLeft <= 14)
            sslBadge = '<span style="font-size:10px;color:#d97706;font-weight:700;background:#fffbeb;padding:2px 6px;border-radius:6px;margin-left:8px">SSL '+p.sslDaysLeft+'d</span>';
        }
        return '<div data-proj="'+p.id+'" style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f3f4f6;flex-wrap:wrap;gap:8px">'
          + '<div style="display:flex;align-items:center;gap:10px">'
          + dotHtml(p.status)
          + '<span style="font-weight:600;font-size:14px">'+p.name+'</span>'
          + sslBadge
          + '</div>'
          + '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
          + '<span style="font-size:12px;color:#9ca3af;font-family:monospace">'+p.uptimePct.toFixed(2)+'%</span>'
          + '<span style="font-size:11px;color:#9ca3af">'+(p.lastChecked ? ago(p.lastChecked) : 'pending')+'</span>'
          + badgeHtml(p.status)
          + '</div></div>';
      }).join('');
      serviceList.innerHTML = shtml;
    }

    // ── Timestamps ──────────────────────────────────────────────────────────
    var lc = document.getElementById('last-checked');
    var ft = document.getElementById('footer-ts');
    var now = new Date().toLocaleString();
    if (lc) lc.textContent = 'Updated '+new Date().toLocaleTimeString();
    if (ft) ft.textContent = 'Last updated '+now+' · Real-time via SSE';
  }

  // ── Connect to SSE endpoint ────────────────────────────────────────────────
  if (typeof EventSource !== 'undefined') {
    var es = new EventSource('/status/events');
    es.onmessage = function(e) {
      try { applyUpdate(JSON.parse(e.data)); } catch(err) {}
    };
    es.onerror = function() {
      // SSE failed — fall back to a 30s hard reload
      setTimeout(function(){ location.reload(); }, 30000);
    };
  } else {
    // Older browsers — reload every 30s
    setTimeout(function(){ location.reload(); }, 30000);
  }
})();
</script>
</body>
</html>`;
}

// ─── Auto Website Info Analysis ──────────────────────────────────────────────
// Multi-layer extraction that works for SPAs, static sites, and APIs:
//   Layer 1 — Meta tags: <title>, <meta description>, Open Graph, Twitter Card,
//             JSON-LD structured data, <link rel="manifest">
//   Layer 2 — Subpage fetch: /about, /contact, /sitemap.xml, /manifest.json,
//             /robots.txt (for Sitemap: hint)
//   Layer 3 — Groq AI synthesis: all harvested text → structured JSON
//   Layer 4 — Domain-inference fallback: if page is empty/SPA, infer from hostname

/** Pull every useful signal from raw HTML */
function extractHtmlSignals(html: string, baseUrl: string): Record<string, string> {
  const signals: Record<string, string> = {};

  const get = (re: RegExp) => re.exec(html)?.[1]?.trim() || "";

  // <title>
  signals.title = get(/<title[^>]*>([^<]{1,200})<\/title>/i);

  // <meta name="description">
  signals.description = get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
    || get(/<meta[^>]+content=["']([^"']{1,500})["'][^>]+name=["']description["']/i);

  // Open Graph
  signals.ogTitle       = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);
  signals.ogDescription = get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["']/i);
  signals.ogSiteName    = get(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i);
  signals.ogType        = get(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']{1,100})["']/i);
  signals.ogUrl         = get(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']{1,300})["']/i);

  // Twitter card
  signals.twitterTitle = get(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']{1,200})["']/i);
  signals.twitterDesc  = get(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']{1,500})["']/i);

  // Keywords
  signals.keywords = get(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{1,400})["']/i);

  // Application name
  signals.appName = get(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']{1,200})["']/i);

  // Generator (e.g. WordPress, Ghost, Next.js)
  signals.generator = get(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,200})["']/i);

  // JSON-LD structured data (first occurrence)
  const jsonLdMatch = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      signals.jsonLd = JSON.stringify(ld).slice(0, 2000);
    } catch { /* invalid JSON */ }
  }

  // <link rel="canonical">
  signals.canonical = get(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']{1,300})["']/i);

  // Visible text (scripts/styles stripped)
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, 4000);
  signals.bodyText = visibleText;

  // Nav links — extract href + anchor text for keyPages hints
  const navLinks: string[] = [];
  const linkRe = /<a[^>]+href=["']([^"'#?]{3,200})["'][^>]*>([^<]{2,80})<\/a>/gi;
  let lm;
  while ((lm = linkRe.exec(html)) !== null && navLinks.length < 20) {
    const href = lm[1].trim();
    const text = lm[2].replace(/<[^>]+>/g, "").trim();
    if (text && href && !href.startsWith("javascript") && !href.startsWith("mailto")) {
      const abs = href.startsWith("http") ? href : (baseUrl.replace(/\/$/, "") + "/" + href.replace(/^\//, ""));
      navLinks.push(`${text} → ${abs}`);
    }
  }
  if (navLinks.length) signals.navLinks = navLinks.join("\n");

  return signals;
}

/** Try to fetch a URL silently; return empty string on failure */
async function tryFetch(url: string): Promise<string> {
  try {
    const r = await axios.get(url, {
      timeout: 6000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LuminaMonitor/1.0)" },
      validateStatus: null,
      maxContentLength: 200_000,
    });
    if (r.status >= 400) return "";
    return typeof r.data === "string" ? r.data : JSON.stringify(r.data);
  } catch { return ""; }
}

async function analyzeWebsiteInfo(projectId: string): Promise<void> {
  const projects = readProjects();
  const proj = projects.find((p) => p.id === projectId);
  if (!proj) return;

  if (!/^https?:\/\//i.test(proj.url)) return;

  const s = readSettings();
  const apiKey = s.groqApiKey || process.env.GROQ_API_KEY || "";
  const model  = s.groqModel  || "llama-3.3-70b-versatile";
  if (!apiKey) return;

  try {
    const origin = (() => { try { return new URL(proj.url).origin; } catch { return proj.url; } })();
    const hostname = (() => { try { return new URL(proj.url).hostname; } catch { return proj.url; } })();

    // ── Layer 1: Fetch homepage ──────────────────────────────────────────────
    const homeHtml = await tryFetch(proj.url);
    const homeSignals = homeHtml ? extractHtmlSignals(homeHtml, origin) : {};

    // ── Layer 2: Parallel subpage fetch ──────────────────────────────────────
    // Try /about, /contact, manifest.json, sitemap.xml, robots.txt
    // These pages often have the richest content and are server-rendered
    const subUrls = [
      `${origin}/about`,
      `${origin}/about-us`,
      `${origin}/contact`,
      `${origin}/contact-us`,
      `${origin}/services`,
      `${origin}/manifest.json`,
      `${origin}/site.webmanifest`,
      `${origin}/sitemap.xml`,
      `${origin}/robots.txt`,
    ];

    const subContents = await Promise.all(subUrls.map(tryFetch));

    // Extract signals from each subpage
    const subTexts: string[] = [];
    let manifestData = "";

    subContents.forEach((content, i) => {
      if (!content) return;
      const url = subUrls[i];

      if (url.endsWith(".json") || url.endsWith(".webmanifest")) {
        // Web app manifest — great source for app name and description
        try {
          const mf = JSON.parse(content);
          manifestData = `App Manifest: name="${mf.name || ""}", short_name="${mf.short_name || ""}", description="${mf.description || ""}"`;
        } catch { /* not valid JSON */ }
      } else if (url.endsWith("sitemap.xml")) {
        // Extract URLs from sitemap for keyPages hints
        const urls = (content.match(/<loc>([^<]+)<\/loc>/gi) || []).slice(0, 15).map((u) => u.replace(/<\/?loc>/gi, ""));
        if (urls.length) subTexts.push("Sitemap URLs: " + urls.join(", "));
      } else if (url.endsWith("robots.txt")) {
        const sitemapLine = content.split("\n").find((l) => l.toLowerCase().startsWith("sitemap:"));
        if (sitemapLine) subTexts.push(sitemapLine);
      } else {
        // HTML subpage — extract signals
        const sig = extractHtmlSignals(content, origin);
        const snippet = [sig.ogDescription || sig.description || "", sig.bodyText || ""]
          .filter(Boolean).join(" ").slice(0, 1500);
        if (snippet.trim()) subTexts.push(`[${url}] ${snippet}`);
      }
    });

    // ── Layer 3: Build rich context for the AI ────────────────────────────────
    const contextParts: string[] = [
      `URL: ${proj.url}`,
      `Project name: ${proj.name}`,
      `Hostname: ${hostname}`,
    ];

    // Homepage signals
    if (homeSignals.title)          contextParts.push(`Page title: ${homeSignals.title}`);
    if (homeSignals.ogSiteName)     contextParts.push(`Site name: ${homeSignals.ogSiteName}`);
    if (homeSignals.appName)        contextParts.push(`App name: ${homeSignals.appName}`);
    if (homeSignals.ogTitle)        contextParts.push(`OG title: ${homeSignals.ogTitle}`);
    if (homeSignals.ogDescription)  contextParts.push(`OG description: ${homeSignals.ogDescription}`);
    if (homeSignals.description)    contextParts.push(`Meta description: ${homeSignals.description}`);
    if (homeSignals.twitterTitle)   contextParts.push(`Twitter title: ${homeSignals.twitterTitle}`);
    if (homeSignals.twitterDesc)    contextParts.push(`Twitter description: ${homeSignals.twitterDesc}`);
    if (homeSignals.keywords)       contextParts.push(`Keywords: ${homeSignals.keywords}`);
    if (homeSignals.generator)      contextParts.push(`Generator/Platform: ${homeSignals.generator}`);
    if (homeSignals.jsonLd)         contextParts.push(`Structured data (JSON-LD): ${homeSignals.jsonLd}`);
    if (manifestData)               contextParts.push(manifestData);
    if (homeSignals.navLinks)       contextParts.push(`Navigation links:\n${homeSignals.navLinks}`);
    if (homeSignals.bodyText)       contextParts.push(`Homepage visible text:\n${homeSignals.bodyText}`);
    if (subTexts.length)            contextParts.push(`Additional pages:\n${subTexts.join("\n\n")}`);

    const context = contextParts.join("\n\n").slice(0, 12000);

    // ── Layer 4: Groq AI synthesis ────────────────────────────────────────────
    const systemPrompt = `You are an expert web intelligence analyst. Your job is to extract structured information about a website/service from all available signals.

IMPORTANT RULES:
1. You MUST always fill every field — never leave fields empty or return "{}"
2. If you cannot find explicit info, INFER from the URL, domain name, page title, meta tags, nav links, and visible text
3. For "technologies": always infer from visible signals (React/Vue/Angular = SPA; WordPress/Ghost = CMS; Vercel/Netlify = cloud hosting; etc.)
4. For "services": infer from the domain name and any text — be specific and helpful
5. For "keyPages": build from the nav links and sitemap URLs provided
6. For "region": default to "Global" unless you see evidence of a specific region
7. Always return valid JSON — no markdown, no explanations, just the JSON object

Return a JSON object with ALL these fields:
{
  "company": "Company or product name (use project name if nothing else found)",
  "tagline": "Short tagline or slogan (infer from title/description if not explicit)",
  "about": "2-4 sentences describing what this website/service does",
  "services": ["at least 2-3 services or features, inferred if needed"],
  "technologies": ["tech stack inferred from signals — framework, hosting, language"],
  "region": "Geographic region (default: Global)",
  "contactEmail": "email if found, else omit",
  "contactPhone": "phone if found, else omit",
  "address": "address if found, else omit",
  "socialLinks": [{"platform": "...", "url": "..."}, ...],
  "keyPages": [{"label": "Home", "url": "${origin}"}, ... up to 6 pages from nav/sitemap]
}`;

    const userPrompt = `Analyze this website and extract ALL information:\n\n${context}`;

    const groqRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 35000,
      }
    );

    const raw = groqRes.data.choices?.[0]?.message?.content ?? "";
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) return;

    const info = JSON.parse(jsonStr);

    // Persist
    const allProjects = readProjects();
    const idx = allProjects.findIndex((p) => p.id === projectId);
    if (idx === -1) return;

    allProjects[idx].websiteInfo = {
      company:      info.company      || proj.name,
      tagline:      info.tagline      || undefined,
      about:        info.about        || undefined,
      services:     Array.isArray(info.services)     && info.services.length     ? info.services     : undefined,
      technologies: Array.isArray(info.technologies) && info.technologies.length ? info.technologies : undefined,
      region:       info.region       || "Global",
      contactEmail: info.contactEmail || undefined,
      contactPhone: info.contactPhone || undefined,
      address:      info.address      || undefined,
      socialLinks:  Array.isArray(info.socialLinks)  && info.socialLinks.length  ? info.socialLinks  : undefined,
      keyPages:     Array.isArray(info.keyPages)     && info.keyPages.length     ? info.keyPages     : undefined,
      lastAnalyzed: Date.now(),
    };

    if (!allProjects[idx].description && info.about) {
      allProjects[idx].description = info.about;
    }

    writeJson(FILES.projects, allProjects);
    broadcast("projects_update", allProjects);
    console.log(`[WEBSITE INFO] ✓ Analyzed ${proj.name} — signals: meta=${!!(homeSignals.ogDescription||homeSignals.description)}, subpages=${subTexts.length}, manifest=${!!manifestData}`);

  } catch (e: any) {
    console.warn(`[WEBSITE INFO] ✗ ${proj.url} — ${e.message}`);
  }
}

// ─── Express App ──────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  app.use(express.json());

  // ── Projects ──────────────────────────────────────────────────────────────

  app.get("/api/projects", (_req, res) => res.json(readProjects()));

  app.post("/api/projects", (req, res) => {
    const body = req.body as Partial<Project>;
    if (!body.name || !body.url) return res.status(400).json({ error: "name and url are required" });
    const projects = readProjects();
    const p: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: body.name, url: body.url,
      type: body.type || "website",
      checkInterval: body.checkInterval || 5,
      status: "unknown", lastChecked: null,
      uptimePct: 100, enabled: body.enabled !== false,
      notifyEmail: body.notifyEmail,
      checkCount: 0, successCount: 0, history: [],
      responseTimeThreshold: body.responseTimeThreshold,
      validation: body.validation,
      credentials: body.credentials,
    };
    projects.push(p);
    writeJson(FILES.projects, projects);
    // Run health check + website info analysis in parallel (non-blocking)
    checkProject(p).catch(() => {});
    analyzeWebsiteInfo(p.id).catch(() => {});
    res.status(201).json(p);
  });

  // POST /api/projects/:id/analyze-website  — re-run website info analysis on demand
  app.post("/api/projects/:id/analyze-website", async (req, res) => {
    const project = readProjects().find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    if (!/^https?:\/\//i.test(project.url)) {
      return res.status(400).json({ error: "Website info analysis only works for HTTP/HTTPS URLs" });
    }
    const s = readSettings();
    if (!s.groqApiKey && !process.env.GROQ_API_KEY) {
      return res.status(400).json({ error: "Groq API key not configured. Go to Settings → Groq AI to add your key." });
    }
    // Run async — return immediately, client will pick up via WebSocket broadcast
    analyzeWebsiteInfo(project.id).catch(() => {});
    res.json({ ok: true, message: "Analysis started — the project will update in a few seconds" });
  });

  app.put("/api/projects/:id", (req, res) => {
    const projects = readProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    projects[idx] = { ...projects[idx], ...req.body, id: projects[idx].id };
    writeJson(FILES.projects, projects);
    broadcast("projects_update", projects);
    res.json(projects[idx]);
  });

  app.delete("/api/projects/:id", (req, res) => {
    writeJson(FILES.projects, readProjects().filter((p) => p.id !== req.params.id));
    writeJson(FILES.logs, readLogs().filter((l) => l.projectId !== req.params.id));
    writeJson(FILES.issues, readIssues().filter((i) => i.projectId !== req.params.id));
    broadcast("projects_update", readProjects());
    res.json({ ok: true });
  });

  app.post("/api/projects/:id/check", async (req, res) => {
    const project = readProjects().find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Not found" });
    await checkProject(project);
    res.json(readProjects().find((p) => p.id === req.params.id));
  });

  // ── Response Body Preview (used by Edit modal to detect validation keywords) ──

  app.post("/api/preview", async (req, res) => {
    const { url, method = "GET", authHeader, customHeaders } = req.body as {
      url: string;
      method?: string;
      authHeader?: string;
      customHeaders?: Record<string, string>;
    };

    if (!url) return res.status(400).json({ error: "url is required" });

    try {
      const headers: Record<string, string> = {
        "User-Agent": "LuminaMonitor/1.0",
        "Accept": "application/json, text/html, */*",
        ...customHeaders,
      };
      if (authHeader) headers["Authorization"] = authHeader;

      const response = await axios({
        method: method || "GET",
        url,
        timeout: 10000,
        headers,
        validateStatus: null,
        maxContentLength: 100000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });

      const statusCode = response.status;
      const contentType = (response.headers["content-type"] || "") as string;
      const isJson = contentType.includes("application/json");

      let body: string;
      if (isJson) {
        body = JSON.stringify(response.data, null, 2);
      } else if (typeof response.data === "string") {
        body = response.data;
      } else {
        body = JSON.stringify(response.data);
      }

      // Strip HTML tags for a cleaner preview (keep text content)
      const stripped = body
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      res.json({
        statusCode,
        contentType,
        isJson,
        rawBody: body.slice(0, 3000),           // raw (JSON or HTML) — first 3000 chars
        textBody: stripped.slice(0, 2000),        // stripped readable text
        bodyLength: body.length,
      });
    } catch (err: any) {
      res.json({
        error: err.message,
        statusCode: null,
        rawBody: "",
        textBody: "",
      });
    }
  });

  // ── Logs ──────────────────────────────────────────────────────────────────

  // Global log stream (with project name) — used by Console view
  app.get("/api/logs", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 300;
    const projects = readProjects();
    const nameMap: Record<string, string> = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const logs = readLogs()
      .slice(0, limit)
      .map((l) => ({ ...l, projectName: nameMap[l.projectId] || "Unknown" }));
    res.json(logs);
  });

  app.get("/api/projects/:id/logs", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(readLogs().filter((l) => l.projectId === req.params.id).slice(0, limit));
  });

  // ── Issues ────────────────────────────────────────────────────────────────

  app.get("/api/projects/:id/issues", (req, res) => {
    res.json(readIssues().filter((i) => i.projectId === req.params.id));
  });

  // ── Notifications ─────────────────────────────────────────────────────────

  app.get("/api/notifications", (_req, res) => res.json(readNotifications()));

  app.post("/api/notifications/read-all", (_req, res) => {
    writeJson(FILES.notifications, readNotifications().map((n) => ({ ...n, read: true })));
    res.json({ ok: true });
  });

  app.delete("/api/notifications/:id", (req, res) => {
    writeJson(FILES.notifications, readNotifications().filter((n) => n.id !== req.params.id));
    res.json({ ok: true });
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  app.get("/api/settings", (_req, res) => {
    const s = readSettings();
    res.json({
      ...s,
      emailPass:            s.emailPass            ? "••••••••" : "",
      geminiApiKey:         s.geminiApiKey         ? "••••••••" : "",
      groqApiKey:           s.groqApiKey           ? "••••••••" : "",
      vercelToken:          s.vercelToken          ? "••••••••" : "",
      slackWebhookUrl:      s.slackWebhookUrl      ? "••••••••" : "",
      supabaseAccessToken:  s.supabaseAccessToken  ? "••••••••" : "",
      supabaseAnonKey:      s.supabaseAnonKey      ? "••••••••" : "",
    });
  });

  app.post("/api/settings", (req, res) => {
    const cur = readSettings();
    const body = req.body as Partial<AppSettings>;
    if (body.emailPass           === "••••••••") delete body.emailPass;
    if (body.geminiApiKey        === "••••••••") delete body.geminiApiKey;
    if (body.groqApiKey          === "••••••••") delete body.groqApiKey;
    if (body.vercelToken         === "••••••••") delete body.vercelToken;
    if (body.slackWebhookUrl     === "••••••••") delete body.slackWebhookUrl;
    if (body.supabaseAccessToken === "••••••••") delete body.supabaseAccessToken;
    if (body.supabaseAnonKey     === "••••••••") delete body.supabaseAnonKey;
    writeJson(FILES.settings, { ...cur, ...body });
    res.json({ ok: true });
  });

  // Serve custom favicon if one is stored in settings
  app.get("/favicon.ico", (_req, res) => {
    const s = readSettings();
    if (s.favicon && s.favicon.startsWith("data:")) {
      const [header, b64] = s.favicon.split(",");
      const mimeMatch = header.match(/data:([^;]+)/);
      const mime = mimeMatch ? mimeMatch[1] : "image/x-icon";
      const buf = Buffer.from(b64, "base64");
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.end(buf);
    } else {
      res.status(404).end();
    }
  });

  // Expose Gemini API key (unmasked) only for frontend AI usage
  app.get("/api/settings/gemini-key", (_req, res) => {
    const s = readSettings();
    const key = s.geminiApiKey || process.env.GEMINI_API_KEY || "";
    res.json({ key, model: s.geminiModel || "gemini-2.0-flash" });
  });

  // Expose Groq API key (unmasked) — used by analyze endpoints
  app.get("/api/settings/groq-key", (_req, res) => {
    const s = readSettings();
    const key = s.groqApiKey || process.env.GROQ_API_KEY || "";
    res.json({ key, model: s.groqModel || "llama-3.3-70b-versatile" });
  });

  // ── Public Status Page ────────────────────────────────────────────────────

  app.get("/status", (_req, res) => {
    const settings = readSettings();
    const html = buildStatusPage(readProjects(), readIssues(), settings);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  // ── Status Page SSE endpoint — real-time push to every /status visitor ────
  // The client JS in buildStatusPage() connects here via EventSource.
  // Every time checkProject() finishes, pushStatusUpdate() writes to all open
  // response streams so the page updates the instant a check completes.
  app.get("/status/events", (req, res) => {
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering if present
    res.flushHeaders();

    // Register this client
    sseClients.add(res);

    // Send current state immediately so the page is accurate on connect
    const projects   = readProjects();
    const issues     = readIssues();
    const hasIssues  = projects.some((p) => p.status === "down" || p.status === "degraded");
    const openIssues = issues.filter((i) => i.status === "open");
    res.write(`data: ${JSON.stringify({ projects, issues, hasIssues, openCount: openIssues.length })}\n\n`);

    // Keep connection alive with a heartbeat comment every 25 s
    // (proxies/load-balancers often close idle connections at 30 s)
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25000);

    // Clean up when the client disconnects
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      projects: readProjects().map((p) => ({
        id: p.id, name: p.name, url: p.url, type: p.type,
        status: p.status, uptimePct: p.uptimePct,
        lastChecked: p.lastChecked, sslDaysLeft: p.sslDaysLeft,
      })),
      openIssues: readIssues().filter((i) => i.status === "open"),
    });
  });

  // ── Health Check APIs ─────────────────────────────────────────────────────

  // GET /health — liveness probe (Kubernetes / uptime-monitor friendly)
  app.get("/health", (_req, res) => {
    const projects = readProjects().filter((p) => p.enabled);
    const counts = { operational: 0, degraded: 0, down: 0, unknown: 0 };
    projects.forEach((p) => { counts[p.status as keyof typeof counts] = (counts[p.status as keyof typeof counts] || 0) + 1; });
    const healthy = counts.down === 0;
    res.status(healthy ? 200 : 503).json({
      status:    healthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime:    Math.floor(process.uptime()),
      projects:  { total: projects.length, ...counts },
      memory:    { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
    });
  });

  // GET /api/health — detailed monitor health (version + ws clients)
  app.get("/api/health", (_req, res) => {
    const projects = readProjects().filter((p) => p.enabled);
    const counts = { operational: 0, degraded: 0, down: 0, unknown: 0 };
    projects.forEach((p) => { counts[p.status as keyof typeof counts] = (counts[p.status as keyof typeof counts] || 0) + 1; });
    const healthy = counts.down === 0;
    const avgUptime = projects.length > 0
      ? projects.reduce((s, p) => s + p.uptimePct, 0) / projects.length : 100;
    res.status(healthy ? 200 : 503).json({
      status:           healthy ? "healthy" : "unhealthy",
      timestamp:        new Date().toISOString(),
      uptime:           Math.floor(process.uptime()),
      version:          "1.0.0",
      websocketClients: wss?.clients?.size ?? 0,
      avgUptimePct:     parseFloat(avgUptime.toFixed(2)),
      projects:         { total: projects.length, ...counts },
      memory: {
        rss:      `${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`,
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`,
      },
    });
  });

  // GET /api/health/:id — per-project health check
  app.get("/api/health/:id", (req, res) => {
    const p = readProjects().find((p) => p.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const healthy = p.status === "operational";
    res.status(healthy ? 200 : p.status === "down" ? 503 : 200).json({
      id:               p.id,
      name:             p.name,
      url:              p.url,
      type:             p.type,
      status:           p.status,
      healthy,
      uptimePct:        p.uptimePct,
      lastChecked:      p.lastChecked ? new Date(p.lastChecked).toISOString() : null,
      lastStatusCode:   p.lastStatusCode  ?? null,
      lastResponseTime: p.lastResponseTime ?? null,
      sslDaysLeft:      p.sslDaysLeft      ?? null,
      checkCount:       p.checkCount,
      successCount:     p.successCount,
    });
  });

  // GET /api/uptime — uptime summary for all projects
  app.get("/api/uptime", (_req, res) => {
    const projects = readProjects();
    const overall = projects.length > 0
      ? projects.reduce((s, p) => s + p.uptimePct, 0) / projects.length : 100;
    res.json({
      overall: parseFloat(overall.toFixed(2)),
      timestamp: new Date().toISOString(),
      projects: projects.map((p) => ({
        id:               p.id,
        name:             p.name,
        type:             p.type,
        status:           p.status,
        uptimePct:        p.uptimePct,
        lastResponseTime: p.lastResponseTime ?? null,
        lastChecked:      p.lastChecked ? new Date(p.lastChecked).toISOString() : null,
      })),
    });
  });

  // GET /api/badge/:id — shields.io-compatible JSON badge
  app.get("/api/badge/:id", (req, res) => {
    const p = readProjects().find((p) => p.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Project not found" });
    const color   = p.status === "operational" ? "brightgreen" : p.status === "degraded" ? "yellow" : p.status === "down" ? "red" : "lightgrey";
    const message = p.status === "operational" ? `${p.uptimePct.toFixed(1)}% uptime` : p.status;
    res.json({ schemaVersion: 1, label: p.name, message, color, cacheSeconds: 30 });
  });

  // GET /api/badge/:id/svg — inline SVG status badge
  app.get("/api/badge/:id/svg", (req, res) => {
    const p = readProjects().find((p) => p.id === req.params.id);
    const label   = p ? p.name   : "unknown";
    const message = p ? p.status : "not found";
    const fill    = p?.status === "operational" ? "#4ade80" : p?.status === "degraded" ? "#fbbf24" : p?.status === "down" ? "#f87171" : "#9ca3af";
    const lw = Math.max(label.length   * 6.8 + 12, 30);
    const mw = Math.max(message.length * 6.8 + 12, 50);
    const tw = lw + mw;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="20">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <rect rx="3" width="${tw}" height="20" fill="#555"/>
  <rect rx="3" x="${lw}" width="${mw}" height="20" fill="${fill}"/>
  <rect rx="3" width="${tw}" height="20" fill="url(#s)"/>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${message}</text>
    <text x="${lw + mw / 2}" y="14">${message}</text>
  </g>
</svg>`;
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(svg);
  });

  // ── Vercel Integration (all requests proxied — token stays server-side) ───

  const vercelGet = async (token: string, path: string, params: Record<string, string> = {}) => {
    const url = new URL("https://api.vercel.com" + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const r = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return r.data;
  };

  const getVercelToken = () => {
    const s = readSettings();
    return s.vercelToken || process.env.VERCEL_TOKEN || "";
  };

  app.get("/api/vercel/projects", async (_req, res) => {
    const token = getVercelToken();
    if (!token) return res.status(400).json({ error: "Vercel token not configured" });
    try {
      const data = await vercelGet(token, "/v9/projects", { limit: "100" });
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.response?.data?.error?.message || e.message }); }
  });

  app.get("/api/vercel/deployments", async (req, res) => {
    const token = getVercelToken();
    if (!token) return res.status(400).json({ error: "Vercel token not configured" });
    const p: Record<string, string> = { limit: String(req.query.limit || 30) };
    if (req.query.projectId) p.projectId = String(req.query.projectId);
    if (req.query.target)    p.target    = String(req.query.target);
    if (req.query.state)     p.state     = String(req.query.state);
    try {
      const data = await vercelGet(token, "/v6/deployments", p);
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.response?.data?.error?.message || e.message }); }
  });

  app.get("/api/vercel/logs", async (req, res) => {
    const token = getVercelToken();
    if (!token) return res.status(400).json({ error: "Vercel token not configured" });
    const { deploymentId, since, until, limit = "500" } = req.query as Record<string, string>;
    if (!deploymentId) return res.status(400).json({ error: "deploymentId required" });
    const p: Record<string, string> = { limit, direction: "backward" };
    if (since) p.since = since;
    if (until) p.until = until;
    try {
      const data = await vercelGet(token, `/v2/deployments/${deploymentId}/events`, p);
      res.json(Array.isArray(data) ? data : data.events ?? []);
    } catch (e: any) { res.status(500).json({ error: e.response?.data?.error?.message || e.message }); }
  });

  // Expose Vercel token status (masked)
  app.get("/api/settings/vercel-status", (_req, res) => {
    const token = getVercelToken();
    res.json({ configured: !!token });
  });

  // ── Groq AI Analysis (proxied — key never leaves server) ─────────────────

  app.post("/api/analyze-groq", async (req, res) => {
    const s = readSettings();
    const apiKey = s.groqApiKey || process.env.GROQ_API_KEY || "";
    if (!apiKey) return res.status(400).json({ error: "GROQ_API_KEY not configured. Go to Settings → AI Analysis to add your key." });

    const { context, url, headers: siteHeaders, statusCode, responseTime, sslDays } = req.body as {
      context: string; url: string;
      headers?: Record<string, string>;
      statusCode?: number; responseTime?: number; sslDays?: number | null;
    };

    const model = s.groqModel || "llama-3.3-70b-versatile";

    const systemPrompt = `You are an expert system architecture analyzer. Given a project URL, its HTTP response, and page content, analyze and return a JSON object with a "components" array describing all detected system components.

Each component must have:
- id: short unique slug (e.g. "frontend", "backend-api", "database", "auth")
- name: human-friendly name
- description: one sentence explaining what this component is
- details: technical details (stack, versions, hosting, etc)
- healthDetails: array of 2-4 health observation strings
- status: one of "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "not_found"
- uptimePct: estimated uptime percentage (number 0-100)
- history: array of 20 integers (0=down, 1=up) simulating recent check history

Typical components to detect: Frontend, Backend API, Database, Authentication, CDN/Hosting, Cache, Storage, CI/CD, Monitoring.
Only include components you can reasonably infer from the evidence. Do NOT make up components.`;

    const userPrompt = `Analyze this project:
URL: ${url}
HTTP Status: ${statusCode ?? "unknown"}
Response Time: ${responseTime ? `${responseTime}ms` : "unknown"}
SSL Days Left: ${sslDays != null ? sslDays : "unknown"}
Server Headers: ${siteHeaders ? Object.entries(siteHeaders).slice(0, 10).map(([k,v]) => `${k}: ${v}`).join(", ") : "none"}

Page Content (first 3000 chars):
${context.slice(0, 3000)}`;

    try {
      const groqRes = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 4096,
          temperature: 0.2,
        },
        {
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: 30000,
        }
      );
      const content = groqRes.data.choices?.[0]?.message?.content ?? "{}";
      let parsed: { components?: unknown[] };
      try { parsed = JSON.parse(content); } catch { return res.status(500).json({ error: "Groq returned invalid JSON" }); }
      res.json({ components: Array.isArray(parsed.components) ? parsed.components : Array.isArray(parsed) ? parsed : [] });
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message || "Groq request failed";
      res.status(500).json({ error: msg });
    }
  });

  // ── Real health check for Step 4 of AI Analysis ───────────────────────────

  app.post("/api/analyze-health-check", async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url) return res.status(400).json({ error: "url required" });

    let origin: string;
    try { origin = new URL(url).origin; } catch { return res.status(400).json({ error: "invalid url" }); }

    const healthPaths = ["/health", "/api/health", "/ping", "/status", "/api/status", "/healthz", "/ready"];
    const results: { path: string; status: number; responseTime: number; ok: boolean; body?: string }[] = [];

    for (const hpath of healthPaths) {
      try {
        const t0 = Date.now();
        const r = await axios.get(origin + hpath, {
          timeout: 4000,
          validateStatus: null,
          maxContentLength: 2000,
        });
        const body = typeof r.data === "object" ? JSON.stringify(r.data).slice(0, 200) : String(r.data).slice(0, 200);
        results.push({ path: hpath, status: r.status, responseTime: Date.now() - t0, ok: r.status < 400, body });
      } catch {
        // not found — skip silently
      }
    }

    // Also check matching Lumina-monitored projects
    const projects = readProjects();
    const matchingProjects = projects.filter((p) => {
      try { return new URL(p.url).hostname === new URL(url).hostname; } catch { return false; }
    });

    // Check SSL days from existing project data
    const sslProject = matchingProjects[0];

    res.json({
      healthEndpoints: results,
      matchingProjects: matchingProjects.map((p) => ({
        id: p.id, name: p.name, status: p.status,
        uptimePct: p.uptimePct, lastResponseTime: p.lastResponseTime,
        sslDaysLeft: p.sslDaysLeft,
      })),
      sslDaysLeft: sslProject?.sslDaysLeft ?? null,
      overallHealthy: results.some((r) => r.ok),
    });
  });

  // ── Existing AI Analysis ──────────────────────────────────────────────────

  app.post("/api/analyze-link", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    try {
      const response = await axios.get(url, { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0 LuminaMonitor/1.0" } });
      res.json({ status: "up", statusCode: response.status, headers: response.headers, htmlSnippet: response.data.toString().substring(0, 5000) });
    } catch (error: any) {
      res.json({ status: "down", error: error.message, statusCode: error.response?.status });
    }
  });

  // ── Log Ingestion ─────────────────────────────────────────────────────────
  // POST /api/ingest        — single structured event from any app
  // POST /api/ingest/batch  — array of events
  // GET  /api/events        — query stored events (with filters)
  // GET  /api/events/stats  — aggregated latency/error stats

  function sanitiseEvent(raw: Record<string, unknown>): IngestEvent {
    const {
      timestamp, event, user_id, tenant_id, endpoint, method,
      status, http_status, latency_ms, source_ip, error_code,
      ...rest
    } = raw;
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: Date.now(),
      timestamp: typeof timestamp === "string" ? timestamp : new Date().toISOString(),
      event: typeof event === "string" && event ? event : "unknown",
      ...(user_id !== undefined ? { user_id: String(user_id) } : {}),
      ...(tenant_id !== undefined ? { tenant_id: String(tenant_id) } : {}),
      ...(endpoint !== undefined ? { endpoint: String(endpoint) } : {}),
      ...(method !== undefined ? { method: String(method).toUpperCase() } : {}),
      ...(status !== undefined ? { status: String(status) } : {}),
      ...(http_status !== undefined ? { http_status: Number(http_status) } : {}),
      ...(latency_ms !== undefined ? { latency_ms: Number(latency_ms) } : {}),
      ...(source_ip !== undefined ? { source_ip: String(source_ip) } : {}),
      ...(error_code !== undefined ? { error_code: String(error_code) } : {}),
      ...(Object.keys(rest).length ? { extra: rest as Record<string, unknown> } : {}),
    };
  }

  app.post("/api/ingest", (req, res) => {
    try {
      const ev = sanitiseEvent(req.body as Record<string, unknown>);
      const events = readEvents();
      events.unshift(ev);
      writeJson(FILES.events, events.slice(0, 100_000));
      broadcast("ingest_event", ev);
      res.json({ ok: true, id: ev.id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/ingest/batch", (req, res) => {
    try {
      const body = req.body;
      const rawList: Record<string, unknown>[] = Array.isArray(body) ? body : body?.events ?? [];
      if (rawList.length === 0) return res.status(400).json({ error: "No events in body" });
      const sanitised = rawList.slice(0, 1000).map(sanitiseEvent);
      const events = readEvents();
      events.unshift(...sanitised);
      writeJson(FILES.events, events.slice(0, 100_000));
      sanitised.forEach((ev) => broadcast("ingest_event", ev));
      res.json({ ok: true, count: sanitised.length });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/events", (req, res) => {
    const { event, user_id, tenant_id, from, to, limit = "500" } = req.query as Record<string, string>;
    let events = readEvents();

    if (event)     events = events.filter((e) => e.event === event);
    if (user_id)   events = events.filter((e) => e.user_id === user_id);
    if (tenant_id) events = events.filter((e) => e.tenant_id === tenant_id);
    if (from) {
      const fromMs = Number(from);
      events = events.filter((e) => new Date(e.timestamp).getTime() >= fromMs);
    }
    if (to) {
      const toMs = Number(to);
      events = events.filter((e) => new Date(e.timestamp).getTime() <= toMs);
    }

    const lim = Math.min(Math.max(1, Number(limit) || 500), 5000);
    res.json({ events: events.slice(0, lim), total: events.length });
  });

  app.get("/api/events/stats", (req, res) => {
    const { event, user_id, from, to } = req.query as Record<string, string>;
    let events = readEvents();

    if (event)   events = events.filter((e) => e.event === event);
    if (user_id) events = events.filter((e) => e.user_id === user_id);
    if (from)    events = events.filter((e) => new Date(e.timestamp).getTime() >= Number(from));
    if (to)      events = events.filter((e) => new Date(e.timestamp).getTime() <= Number(to));

    const withLatency = events.filter((e) => e.latency_ms !== undefined).map((e) => e.latency_ms!);
    const sorted = [...withLatency].sort((a, b) => a - b);
    const pct = (p: number) => sorted.length ? sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)] : null;
    const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null;

    const errors = events.filter((e) => e.status === "failure" || (e.http_status !== undefined && e.http_status >= 400)).length;
    const successRate = events.length ? Math.round(((events.length - errors) / events.length) * 10000) / 100 : null;

    // Per-user stats
    const byUser: Record<string, { latencies: number[]; errors: number; count: number }> = {};
    for (const ev of events) {
      const uid = ev.user_id || "__anonymous__";
      if (!byUser[uid]) byUser[uid] = { latencies: [], errors: 0, count: 0 };
      byUser[uid].count++;
      if (ev.latency_ms !== undefined) byUser[uid].latencies.push(ev.latency_ms);
      if (ev.status === "failure" || (ev.http_status && ev.http_status >= 400)) byUser[uid].errors++;
    }
    const perUser = Object.entries(byUser)
      .map(([uid, d]) => {
        const s = [...d.latencies].sort((a, b) => a - b);
        const p95 = s.length ? s[Math.min(Math.floor(s.length * 0.95), s.length - 1)] : null;
        const userAvg = s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
        return { user_id: uid, count: d.count, avg_ms: userAvg, p95_ms: p95, errors: d.errors };
      })
      .sort((a, b) => (b.avg_ms ?? 0) - (a.avg_ms ?? 0))
      .slice(0, 100);

    // Time series — bucket into ~20 points
    const bucket = events.length > 0 ? Math.ceil((Date.now() - new Date(events[events.length - 1].timestamp).getTime()) / 20 / 60000) || 1 : 5;
    const buckets: Record<string, { latencies: number[]; count: number; errors: number }> = {};
    for (const ev of events) {
      const ts = new Date(ev.timestamp).getTime();
      const bk = new Date(Math.floor(ts / (bucket * 60000)) * bucket * 60000).toISOString().slice(11, 16);
      if (!buckets[bk]) buckets[bk] = { latencies: [], count: 0, errors: 0 };
      buckets[bk].count++;
      if (ev.latency_ms !== undefined) buckets[bk].latencies.push(ev.latency_ms);
      if (ev.status === "failure" || (ev.http_status && ev.http_status >= 400)) buckets[bk].errors++;
    }
    const timeSeries = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, d]) => {
        const ls = [...d.latencies].sort((a, b) => a - b);
        return {
          time,
          count: d.count,
          errors: d.errors,
          avg_ms: ls.length ? Math.round(ls.reduce((a, b) => a + b, 0) / ls.length) : null,
          p75_ms: ls.length ? ls[Math.min(Math.floor(ls.length * 0.75), ls.length - 1)] : null,
          p95_ms: ls.length ? ls[Math.min(Math.floor(ls.length * 0.95), ls.length - 1)] : null,
        };
      });

    // Distinct event types for the dropdown
    const eventTypes = [...new Set(readEvents().map((e) => e.event))].slice(0, 50);

    res.json({
      total: events.length,
      errors,
      successRate,
      latency: { p50: pct(0.5), p75: pct(0.75), p95: pct(0.95), p99: pct(0.99), avg },
      perUser,
      timeSeries,
      eventTypes,
    });
  });

  app.delete("/api/events", (_req, res) => {
    writeJson(FILES.events, []);
    res.json({ ok: true });
  });

  // ── Maintenance Windows ───────────────────────────────────────────────────

  app.get("/api/maintenance-windows", (_req, res) => {
    res.json(readMaintenanceWindows());
  });

  app.post("/api/maintenance-windows", (req, res) => {
    const body = req.body as Partial<MaintenanceWindow>;
    if (!body.label || !body.startIso || !body.endIso || !body.repeat) {
      return res.status(400).json({ error: "label, startIso, endIso, repeat are required" });
    }
    const windows = readMaintenanceWindows();
    const w: MaintenanceWindow = {
      id: `mw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label:     body.label,
      startIso:  body.startIso,
      endIso:    body.endIso,
      repeat:    body.repeat,
      ...(body.projectId ? { projectId: body.projectId } : {}),
    };
    windows.push(w);
    writeJson(FILES.maintenanceWindows, windows);
    res.status(201).json(w);
  });

  app.put("/api/maintenance-windows/:id", (req, res) => {
    const windows = readMaintenanceWindows();
    const idx = windows.findIndex((w) => w.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    windows[idx] = { ...windows[idx], ...req.body, id: windows[idx].id };
    writeJson(FILES.maintenanceWindows, windows);
    res.json(windows[idx]);
  });

  app.delete("/api/maintenance-windows/:id", (req, res) => {
    writeJson(FILES.maintenanceWindows, readMaintenanceWindows().filter((w) => w.id !== req.params.id));
    res.json({ ok: true });
  });

  // ── Saved Log Filters ─────────────────────────────────────────────────────

  app.get("/api/saved-filters", (_req, res) => {
    res.json(readSavedFilters());
  });

  app.post("/api/saved-filters", (req, res) => {
    const body = req.body as Partial<SavedFilter>;
    if (!body.name || !body.query) {
      return res.status(400).json({ error: "name and query are required" });
    }
    const filters = readSavedFilters();
    const f: SavedFilter = {
      id:    `sf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name:  body.name,
      query: body.query,
      ...(body.type  ? { type:  body.type  } : {}),
      ...(body.color ? { color: body.color } : {}),
    };
    filters.push(f);
    writeJson(FILES.savedFilters, filters);
    res.status(201).json(f);
  });

  app.put("/api/saved-filters/:id", (req, res) => {
    const filters = readSavedFilters();
    const idx = filters.findIndex((f) => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    filters[idx] = { ...filters[idx], ...req.body, id: filters[idx].id };
    writeJson(FILES.savedFilters, filters);
    res.json(filters[idx]);
  });

  app.delete("/api/saved-filters/:id", (req, res) => {
    writeJson(FILES.savedFilters, readSavedFilters().filter((f) => f.id !== req.params.id));
    res.json({ ok: true });
  });

  // ── MTTR (Mean Time to Recovery) ─────────────────────────────────────────

  app.get("/api/mttr", (req, res) => {
    const issues = readIssues();
    const resolved = issues.filter((i) => i.status === "resolved" && i.resolvedAt);
    const projects = readProjects();

    // Overall MTTR in minutes
    const mttrAll = resolved.length
      ? Math.round(resolved.reduce((s, i) => s + (i.resolvedAt! - i.startedAt), 0) / resolved.length / 60000)
      : null;

    // Per-project MTTR
    const perProject: { projectId: string; projectName: string; mttrMinutes: number; incidentCount: number }[] = [];
    const nameMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const byProject: Record<string, Issue[]> = {};
    for (const i of resolved) {
      if (!byProject[i.projectId]) byProject[i.projectId] = [];
      byProject[i.projectId].push(i);
    }
    for (const [pid, items] of Object.entries(byProject)) {
      const avg = Math.round(items.reduce((s, i) => s + (i.resolvedAt! - i.startedAt), 0) / items.length / 60000);
      perProject.push({ projectId: pid, projectName: nameMap[pid] || "Unknown", mttrMinutes: avg, incidentCount: items.length });
    }

    // Recent incidents (last 30)
    const recent = issues
      .slice(0, 30)
      .map((i) => ({
        id: i.id,
        projectId: i.projectId,
        projectName: nameMap[i.projectId] || "Unknown",
        status: i.status,
        severity: i.severity,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt ?? null,
        durationMinutes: i.resolvedAt ? Math.round((i.resolvedAt - i.startedAt) / 60000) : null,
        message: i.message,
      }));

    res.json({
      overallMttrMinutes: mttrAll,
      resolvedCount: resolved.length,
      openCount: issues.filter((i) => i.status === "open").length,
      perProject,
      recent,
    });
  });

  // ── Test Slack (from Settings page) ──────────────────────────────────────

  app.post("/api/test-slack", async (req, res) => {
    const s = readSettings();
    if (!s.slackWebhookUrl) return res.status(400).json({ error: "Slack webhook URL not configured" });
    try {
      await axios.post(s.slackWebhookUrl, {
        text: "✅ *Lumina Monitor* — Slack integration is working correctly!",
        attachments: [{
          color: "#3ecf8e",
          fields: [
            { title: "Source", value: "Lumina Monitor", short: true },
            { title: "Time",   value: new Date().toLocaleString(), short: true },
          ],
          footer: "Test alert from Settings",
        }],
      }, { timeout: 8000 });
      res.json({ ok: true, message: "Test message sent successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to send test message" });
    }
  });

  // ── Supabase Integration ──────────────────────────────────────────────────
  // All Supabase Management API calls are proxied here so tokens never reach the browser.

  const getSupabaseToken = () => readSettings().supabaseAccessToken || process.env.SUPABASE_ACCESS_TOKEN || "";
  const getSupabaseRef   = () => readSettings().supabaseProjectRef  || process.env.SUPABASE_PROJECT_REF  || "";
  const getSupabaseAnon  = () => readSettings().supabaseAnonKey     || process.env.SUPABASE_ANON_KEY      || "";

  const sbMgmt = async (token: string, path: string) => {
    const r = await axios.get(`https://api.supabase.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return r.data;
  };

  // GET /api/supabase/functions — list all edge functions for the configured project
  app.get("/api/supabase/functions", async (_req, res) => {
    const token = getSupabaseToken();
    const ref   = getSupabaseRef();
    if (!token) return res.status(400).json({ error: "Supabase access token not configured. Go to Settings → Supabase." });
    if (!ref)   return res.status(400).json({ error: "Supabase project ref not configured. Go to Settings → Supabase." });
    try {
      const data = await sbMgmt(token, `/projects/${ref}/functions`);
      res.json(Array.isArray(data) ? data : []);
    } catch (e: any) {
      res.status(500).json({ error: e.response?.data?.message || e.message });
    }
  });

  // GET /api/supabase/projects — list all Supabase projects for the token
  app.get("/api/supabase/projects", async (_req, res) => {
    const token = getSupabaseToken();
    if (!token) return res.status(400).json({ error: "Supabase access token not configured." });
    try {
      const data = await sbMgmt(token, "/projects");
      res.json(Array.isArray(data) ? data : []);
    } catch (e: any) {
      res.status(500).json({ error: e.response?.data?.message || e.message });
    }
  });

  // POST /api/supabase/invoke/:fn — invoke an edge function and return the result
  app.post("/api/supabase/invoke/:fn", async (req, res) => {
    const ref  = getSupabaseRef();
    const anon = getSupabaseAnon();
    if (!ref)  return res.status(400).json({ error: "Supabase project ref not configured." });
    const fnName = req.params.fn;
    const url = `https://${ref}.supabase.co/functions/v1/${fnName}`;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(anon ? { Authorization: `Bearer ${anon}` } : {}),
      };
      const t0 = Date.now();
      const r = await axios.post(url, req.body || {}, { headers, timeout: 15000, validateStatus: null });
      res.json({
        status: r.status,
        responseTime: Date.now() - t0,
        headers: r.headers,
        data: r.data,
        ok: r.status < 400,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/supabase/import — auto-import all edge functions as Lumina projects
  app.post("/api/supabase/import", async (req, res) => {
    const token = getSupabaseToken();
    const ref   = getSupabaseRef();
    const anon  = getSupabaseAnon();
    if (!token || !ref) return res.status(400).json({ error: "Supabase token and project ref are required." });

    let functions: any[];
    try {
      functions = await sbMgmt(token, `/projects/${ref}/functions`);
      if (!Array.isArray(functions)) throw new Error("Unexpected response");
    } catch (e: any) {
      return res.status(500).json({ error: e.response?.data?.message || e.message });
    }

    const { functionNames } = req.body as { functionNames?: string[] };
    const toImport = functionNames
      ? functions.filter((f: any) => functionNames.includes(f.slug || f.name))
      : functions;

    const projects = readProjects();
    const imported: string[] = [];

    for (const fn of toImport) {
      const slug = fn.slug || fn.name;
      const fnUrl = `https://${ref}.supabase.co/functions/v1/${slug}`;

      // Skip if already imported
      if (projects.some((p) => p.url === fnUrl)) continue;

      const p: Project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `Supabase: ${slug}`,
        url: fnUrl,
        type: "api",
        checkInterval: 5,
        status: "unknown",
        lastChecked: null,
        uptimePct: 100,
        enabled: true,
        checkCount: 0,
        successCount: 0,
        history: [],
        credentials: anon
          ? { authHeader: `Bearer ${anon}`, method: "GET" }
          : undefined,
        description: fn.verify_jwt !== false
          ? `Supabase edge function (JWT required)`
          : `Supabase edge function (public)`,
      };
      projects.push(p);
      imported.push(slug);
      checkProject(p).catch(() => {});
    }

    writeJson(FILES.projects, projects);
    broadcast("projects_update", projects);
    res.json({ ok: true, imported, total: toImport.length });
  });

  // GET /api/supabase/status — check connection + project info
  app.get("/api/supabase/status", async (_req, res) => {
    const token = getSupabaseToken();
    const ref   = getSupabaseRef();
    if (!token) return res.json({ configured: false, reason: "no_token" });
    if (!ref)   return res.json({ configured: true, hasRef: false, reason: "no_ref" });
    try {
      const [project, functions] = await Promise.all([
        sbMgmt(token, `/projects/${ref}`),
        sbMgmt(token, `/projects/${ref}/functions`),
      ]);
      res.json({
        configured: true,
        hasRef: true,
        project: {
          name: project.name,
          ref:  project.ref,
          region: project.region,
          status: project.status,
        },
        functionCount: Array.isArray(functions) ? functions.length : 0,
      });
    } catch (e: any) {
      res.json({ configured: true, hasRef: true, error: e.response?.data?.message || e.message });
    }
  });

  // ── Full Auto Scan ────────────────────────────────────────────────────────
  // POST /api/full-scan — runs Website + API + Server + Database checks in parallel
  // Returns a comprehensive health report for any URL in ~5-10 seconds

  app.post("/api/full-scan", async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "A valid http/https URL is required" });
    }

    let origin: string;
    let hostname: string;
    try {
      const u = new URL(url);
      origin   = u.origin;
      hostname = u.hostname;
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    const quickGet = async (target: string, timeoutMs = 6000) => {
      const t0 = Date.now();
      try {
        const r = await axios({
          method: "GET", url: target, timeout: timeoutMs,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; LuminaMonitor/1.0; +https://lumina.monitor)" },
          validateStatus: null, maxRedirects: 5, maxContentLength: 500_000,
        });
        return { ok: true, status: r.status, headers: r.headers as Record<string,string>,
                 data: r.data, responseTime: Date.now() - t0,
                 finalUrl: (r.request as any)?.res?.responseUrl as string | undefined };
      } catch (e: any) {
        return { ok: false, status: null, headers: {} as Record<string,string>,
                 data: null, responseTime: Date.now() - t0, error: e.code || e.message };
      }
    };

    const quickHead = async (target: string, timeoutMs = 5000) => {
      const t0 = Date.now();
      try {
        const r = await axios({ method: "HEAD", url: target, timeout: timeoutMs,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; LuminaMonitor/1.0)" },
          validateStatus: null, maxRedirects: 5 });
        return { ok: true, status: r.status, headers: r.headers as Record<string,string>, responseTime: Date.now() - t0 };
      } catch {
        return { ok: false, status: null, headers: {} as Record<string,string>, responseTime: Date.now() - t0 };
      }
    };

    // ── Run all 4 checks in parallel ─────────────────────────────────────────

    const [websiteResult, apiResult, serverResult, dbResult] = await Promise.all([

      // ════════ 1. WEBSITE ════════
      (async () => {
        const issues: string[] = [];
        let score = 100;

        const home = await quickGet(url);
        const ttfb = home.responseTime;

        // SSL
        const sslDays = url.startsWith("https://") ? await checkSslCert(url) : null;
        let ssl: { valid: boolean; daysLeft: number | null } | null = null;
        if (url.startsWith("https://")) {
          ssl = { valid: sslDays !== null && sslDays > 0, daysLeft: sslDays };
          if (!ssl.valid) { issues.push("SSL certificate invalid or expired"); score -= 25; }
          else if (sslDays! <= 14) { issues.push(`SSL expiring in ${sslDays} days`); score -= 10; }
          else if (sslDays! <= 30) { issues.push(`SSL expiring in ${sslDays} days`); score -= 5; }
        } else {
          issues.push("No HTTPS — site uses plain HTTP"); score -= 20;
        }

        // HTTP status
        if (!home.ok || home.status === null) { issues.push("Site unreachable"); score -= 50; }
        else if (home.status >= 500) { issues.push(`Server error: HTTP ${home.status}`); score -= 40; }
        else if (home.status === 404) { issues.push("Page not found (404)"); score -= 30; }
        else if (home.status >= 400) { issues.push(`Client error: HTTP ${home.status}`); score -= 20; }

        // Response time
        if (ttfb > 5000) { issues.push(`Very slow response: ${ttfb}ms`); score -= 15; }
        else if (ttfb > 2000) { issues.push(`Slow response: ${ttfb}ms`); score -= 8; }
        else if (ttfb > 1000) { issues.push(`Response time above 1s: ${ttfb}ms`); score -= 3; }

        // Redirect detection
        const redirects: string[] = [];
        if (home.finalUrl && home.finalUrl !== url) redirects.push(home.finalUrl);

        // robots.txt
        const robotsR = await quickHead(`${origin}/robots.txt`);
        const hasRobots = robotsR.ok && (robotsR.status === 200 || robotsR.status === 301);
        if (!hasRobots) { issues.push("No robots.txt found"); score -= 3; }

        // sitemap.xml
        const sitemapR = await quickHead(`${origin}/sitemap.xml`);
        const hasSitemap = sitemapR.ok && (sitemapR.status === 200 || sitemapR.status === 301);
        if (!hasSitemap) { issues.push("No sitemap.xml found"); score -= 3; }

        // Mixed content (basic check — https site loading http resources)
        let mixedContent = false;
        if (url.startsWith("https://") && typeof home.data === "string") {
          mixedContent = /src=["']http:\/\//i.test(home.data) || /href=["']http:\/\//i.test(home.data);
          if (mixedContent) { issues.push("Mixed content detected (HTTP resources on HTTPS page)"); score -= 8; }
        }

        // Soft-error body check
        if (home.ok && typeof home.data === "string") {
          const softErr = detectSoftError(home.data);
          if (softErr) { issues.push(softErr); score -= 15; }
        }

        const finalScore = Math.max(0, Math.min(100, score));
        return {
          score: finalScore,
          status: finalScore >= 80 ? "healthy" : finalScore >= 50 ? "warning" : "critical",
          httpStatus: home.status,
          responseTime: ttfb,
          ssl, redirects, hasRobots, hasSitemap, mixedContent,
          availability: home.ok && (home.status ?? 0) < 400 ? "up" : "down",
          issues,
        };
      })(),

      // ════════ 2. API ════════
      (async () => {
        const issues: string[] = [];
        const API_PATHS = [
          "/api", "/api/v1", "/api/v2", "/health", "/healthz",
          "/status", "/ping", "/graphql", "/api/health",
          "/api/status", "/ready", "/live", "/metrics",
        ];

        // Fetch homepage to fingerprint it (used to detect SPA + CMS catch-all)
        const homeCheck = await quickGet(url);
        const homeCt    = (homeCheck.headers["content-type"] as string || "").toLowerCase();
        const homeHtml  = typeof homeCheck.data === "string" ? homeCheck.data : "";

        // Detect SPA markers in homepage source
        const isSpa = (
          homeHtml.includes("_next/static") || homeHtml.includes("__next") ||   // Next.js
          homeHtml.includes("vite") || homeHtml.includes("/@vite/") ||           // Vite
          homeHtml.includes("nuxt") || homeHtml.includes("__nuxt") ||            // Nuxt
          homeHtml.includes("react-root") || homeHtml.includes('id="root"') ||   // React
          homeHtml.includes('id="app"') ||                                        // Vue/React
          homeHtml.includes("angular") ||                                         // Angular
          (homeCt.includes("text/html") && homeHtml.length < 2000 &&             // Tiny HTML shell
           /<div[^>]+id=/.test(homeHtml) && homeHtml.includes("<script"))
        );

        // Fingerprint the home body for fallback detection
        const homeBodyFp = homeHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 150);

        const isCatchAllFallback = (status: number, ct: string, data: unknown): boolean => {
          if (!ct.includes("text/html")) return false;
          if (status === 401 || status === 403 || status >= 400) return false;
          if (typeof data !== "string") return false;
          const snippet = data.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 150);
          return snippet === homeBodyFp;
        };

        const results = await Promise.all(API_PATHS.map(async (path) => {
          const target = origin + path;
          const t0 = Date.now();
          try {
            const r = await axios({
              method: "GET", url: target, timeout: 5000,
              headers: { "Accept": "application/json", "User-Agent": "LuminaMonitor/1.0" },
              validateStatus: null, maxContentLength: 100_000,
            });
            const rt = Date.now() - t0;
            const ct = (r.headers["content-type"] as string || "").toLowerCase();
            const isJson = ct.includes("application/json");
            const requiresAuth = r.status === 401 || r.status === 403;
            const catchAll = isCatchAllFallback(r.status, ct, r.data);

            const isRealApi = !catchAll && (
              isJson ||
              requiresAuth ||
              r.status === 204 || r.status === 205 ||
              (path === "/ping" && r.status === 200 && !ct.includes("text/html")) ||
              (path === "/metrics" && ct.includes("text/plain"))
            );

            const found = isRealApi && r.status !== 404 && r.status < 500;
            let health: "ok" | "auth" | "error" | "notfound" | "spa-fallback" | "cms-fallback" = "notfound";
            if (catchAll)            health = isSpa ? "spa-fallback" : "cms-fallback";
            else if (!found)         health = "notfound";
            else if (requiresAuth)   health = "auth";
            else if (r.status < 400) health = "ok";
            else                     health = "error";

            if (health === "ok" && isJson && typeof r.data === "object" && r.data !== null) {
              const obj = r.data as Record<string, unknown>;
              if (obj.success === false || obj.error || obj.errors) health = "error";
              if (obj.authenticated === false || obj.auth === false) health = "auth";
            }

            return { path, status: r.status, responseTime: rt, isJson, requiresAuth, found, health, catchAll };
          } catch {
            return { path, status: null, responseTime: Date.now() - t0,
                     isJson: false, requiresAuth: false, found: false,
                     health: "notfound" as const, catchAll: false };
          }
        }));

        const discovered    = results.filter((r) => r.found);
        const healthyApis   = discovered.filter((r) => r.health === "ok");
        const authApis      = discovered.filter((r) => r.health === "auth");
        const spaFallbacks  = results.filter((r) => r.health === "spa-fallback").length;
        const cmsFallbacks  = results.filter((r) => r.health === "cms-fallback").length;
        const notFoundCount = results.filter((r) => r.health === "notfound").length;
        // "all fallback" = no real API found (catch-all OR 404s, not actual API responses)
        const allFallback   = (spaFallbacks + cmsFallbacks + notFoundCount) === API_PATHS.length && discovered.length === 0;

        // SPA with client-side APIs = SPA detected AND no server-side API endpoints found
        const isSpaWithClientApis = isSpa && discovered.length === 0;
        // A static/CMS site with no APIs at all (not a SPA)
        const isStaticOrCms       = !isSpa && allFallback && spaFallbacks === 0;

        let score = 50;
        if (isSpaWithClientApis) {
          // SPA — APIs are called client-side (Supabase, Firebase, etc.)
          score = 75; // Not penalised — this is normal SPA behaviour
          issues.push("SPA detected — APIs called client-side from JavaScript");
        } else if (isStaticOrCms) {
          score = 40;
        } else if (healthyApis.length > 0) {
          score = Math.min(100, 80 + healthyApis.length * 3);
        } else if (authApis.length > 0) {
          issues.push("API endpoints require authentication");
          score = 55;
        } else if (discovered.length === 0) {
          issues.push("No API endpoints discovered");
          score = 40;
        }

        const avgRt = healthyApis.length
          ? Math.round(healthyApis.reduce((s, r) => s + r.responseTime, 0) / healthyApis.length)
          : null;
        if (avgRt && avgRt > 2000) { issues.push(`High API response time: ${avgRt}ms`); score -= 10; }

        const finalScore = isStaticOrCms ? null : Math.max(0, Math.min(100, score));
        return {
          score:       finalScore,
          status:      isStaticOrCms      ? "not_applicable"
                     : isSpaWithClientApis ? "spa"
                     : finalScore! >= 80   ? "healthy"
                     : finalScore! >= 50   ? "warning"
                     : "critical",
          isSpa,
          isSpaWithClientApis,
          discovered,
          healthyCount:    healthyApis.length,
          authCount:       authApis.length,
          spaFallbacks,
          cmsFallbacks,
          notApplicable:   isStaticOrCms,
          avgResponseTime: avgRt,
          issues:          isStaticOrCms ? [] : issues,
        };
      })(),

      // ════════ 3. SERVER ════════
      (async () => {
        const issues: string[] = [];
        let score = 100;

        const home = await quickGet(url);
        const headers = home.headers;

        // Server technology
        const serverHeader = headers["server"] || headers["x-powered-by"] || "";
        let technology = "Unknown";
        const techMap: [RegExp, string][] = [
          [/cloudflare/i, "Cloudflare"], [/vercel/i, "Vercel"], [/netlify/i, "Netlify"],
          [/nginx/i, "Nginx"],           [/apache/i, "Apache"],  [/iis/i, "IIS"],
          [/litespeed/i, "LiteSpeed"],   [/caddy/i, "Caddy"],    [/gunicorn/i, "Gunicorn"],
          [/express/i, "Express"],       [/next\.js/i, "Next.js"],
        ];
        for (const [re, name] of techMap) {
          if (re.test(serverHeader) || re.test(JSON.stringify(headers))) { technology = name; break; }
        }
        // CDN detection from headers
        let cdn: string | null = null;
        if (headers["cf-ray"])          cdn = "Cloudflare";
        else if (headers["x-vercel-id"]) cdn = "Vercel";
        else if (headers["x-nf-request-id"]) cdn = "Netlify";
        else if (headers["x-amz-cf-id"]) cdn = "AWS CloudFront";
        else if (headers["x-cache"])     cdn = "Generic CDN";
        else if (headers["via"])         cdn = headers["via"];

        // Security headers
        const hsts        = !!(headers["strict-transport-security"]);
        const csp         = !!(headers["content-security-policy"]);
        const xFrame      = !!(headers["x-frame-options"]);
        const xContent    = !!(headers["x-content-type-options"]);
        const referrer    = !!(headers["referrer-policy"]);
        const permissions = !!(headers["permissions-policy"] || headers["feature-policy"]);

        const missingSecHeaders: string[] = [];
        if (!hsts)     { missingSecHeaders.push("HSTS");                score -= 8; }
        if (!csp)      { missingSecHeaders.push("Content-Security-Policy"); score -= 8; }
        if (!xFrame)   { missingSecHeaders.push("X-Frame-Options");     score -= 5; }
        if (!xContent) { missingSecHeaders.push("X-Content-Type-Options"); score -= 5; }
        if (!referrer) { missingSecHeaders.push("Referrer-Policy");     score -= 3; }
        if (missingSecHeaders.length) issues.push(`Missing security headers: ${missingSecHeaders.join(", ")}`);

        // Server banner leaking version
        if (/[\d.]+/.test(serverHeader) && serverHeader.length > 3) {
          issues.push(`Server version exposed in header: "${serverHeader}"`); score -= 5;
        }

        // TTFB assessment
        if (home.responseTime > 3000) { issues.push(`High TTFB: ${home.responseTime}ms`); score -= 10; }
        else if (home.responseTime > 1500) { issues.push(`Elevated TTFB: ${home.responseTime}ms`); score -= 5; }

        const finalScore = Math.max(0, Math.min(100, score));
        return {
          score: finalScore,
          status: finalScore >= 80 ? "healthy" : finalScore >= 50 ? "warning" : "critical",
          technology, cdn,
          ttfb: home.responseTime,
          securityHeaders: { hsts, csp, xFrameOptions: xFrame, xContentTypeOptions: xContent, referrerPolicy: referrer, permissionsPolicy: permissions },
          serverBanner: serverHeader || null,
          issues,
        };
      })(),

      // ════════ 4. DATABASE — multi-signal smart detection ════════
      // Production apps NEVER expose "postgresql" in their responses.
      // We infer the database from 10+ indirect signals instead.
      (async () => {
        const hints: string[] = [];
        const detected: string[] = [];
        const stack: string[] = [];
        const issues: string[] = [];
        const exposedPorts: { port: number; service: string }[] = [];
        let score = 50;

        const addDetected = (name: string, reason: string) => {
          if (!detected.includes(name)) { detected.push(name); hints.push(reason); }
        };
        const addStack = (name: string) => {
          if (!stack.includes(name)) stack.push(name);
        };

        // ── Fetch homepage + several key pages in parallel ─────────────────
        const [home, errorPage, adminPage, wpAdmin, phpMyAdmin] = await Promise.all([
          quickGet(url),
          quickGet(`${origin}/nonexistent-page-xyz-404`),   // trigger 404/500 error page
          quickGet(`${origin}/admin`),
          quickGet(`${origin}/wp-admin`),
          quickGet(`${origin}/phpmyadmin`),
        ]);

        const allHeaders = { ...home.headers };
        const bodyStr = (typeof home.data === "string" ? home.data : JSON.stringify(home.data || "")).toLowerCase();
        const errorBody = (typeof errorPage.data === "string" ? errorPage.data : "").toLowerCase();
        const combinedBody = bodyStr + " " + errorBody;

        // ── SIGNAL 1: Response headers — backend fingerprinting ────────────
        const powered = (allHeaders["x-powered-by"] || "").toLowerCase();
        const serverH = (allHeaders["server"]       || "").toLowerCase();
        const viaH    = (allHeaders["via"]           || "").toLowerCase();

        // Cookies reveal the session technology
        const cookies = [allHeaders["set-cookie"] || ""].join(" ").toLowerCase();
        if (cookies.includes("phpsessid"))         { addStack("PHP");         addDetected("MySQL",      "PHPSESSID cookie → PHP backend typically uses MySQL"); }
        if (cookies.includes("asp.net_sessionid")) { addStack("ASP.NET");     addDetected("SQL Server", "ASP.NET_SessionId cookie → SQL Server"); }
        if (cookies.includes("laravel_session"))   { addStack("Laravel/PHP"); addDetected("MySQL",      "laravel_session cookie → Laravel → MySQL"); }
        if (cookies.includes("django"))            { addStack("Django");       addDetected("PostgreSQL", "Django cookie → typically PostgreSQL or MySQL"); }
        if (cookies.includes("rails") || cookies.includes("_session_id")) {
          addStack("Ruby on Rails"); addDetected("PostgreSQL", "Rails session cookie → typically PostgreSQL");
        }
        if (cookies.includes("connect.sid"))       { addStack("Node.js/Express"); }
        if (cookies.includes("next-auth.session")) { addStack("Next.js"); }

        // X-Powered-By → backend → typical DB
        if (powered.includes("php")) {
          addStack("PHP");
          addDetected("MySQL", "X-Powered-By: PHP → PHP apps almost always use MySQL/MariaDB");
        }
        if (powered.includes("asp.net") || powered.includes("asp")) {
          addStack("ASP.NET");
          addDetected("SQL Server", "X-Powered-By: ASP.NET → typically SQL Server");
        }
        if (powered.includes("express")) { addStack("Node.js/Express"); }
        if (powered.includes("next.js")) { addStack("Next.js"); }

        // Server header → backend → DB
        if (serverH.includes("gunicorn") || serverH.includes("uvicorn") || serverH.includes("daphne")) {
          addStack("Python"); addDetected("PostgreSQL", "Python WSGI server → typically PostgreSQL or SQLite");
        }
        if (serverH.includes("puma") || serverH.includes("unicorn") || serverH.includes("thin")) {
          addStack("Ruby on Rails"); addDetected("PostgreSQL", "Ruby server → Rails → PostgreSQL");
        }
        if (serverH.includes("jetty") || serverH.includes("tomcat") || serverH.includes("jboss")) {
          addStack("Java"); addDetected("Oracle/MySQL", "Java app server → typically Oracle or MySQL");
        }
        if (serverH.includes("werkzeug")) {
          addStack("Python/Flask"); addDetected("PostgreSQL", "Flask dev server → PostgreSQL or SQLite");
        }

        // ── SIGNAL 2: Hosting platform → inferred DB ──────────────────────
        const cfRay   = allHeaders["cf-ray"]          || "";
        const vercelId = allHeaders["x-vercel-id"]    || "";
        const netlify  = allHeaders["x-nf-request-id"] || "";
        const railway  = allHeaders["x-railway-request-id"] || "";
        const heroku   = allHeaders["x-request-id"]   || "";
        const supabaseH = allHeaders["x-supabase-version"] || "";
        const renderH  = allHeaders["x-render-origin-server"] || "";

        if (supabaseH || hostname.includes("supabase")) {
          addDetected("PostgreSQL (Supabase)", "Supabase host/header → PostgreSQL");
        }
        if (hostname.includes("neon.tech")) {
          addDetected("PostgreSQL (Neon)", "Neon.tech domain → managed PostgreSQL");
        }
        if (hostname.includes("planetscale")) {
          addDetected("MySQL (PlanetScale)", "PlanetScale domain → managed MySQL");
        }
        if (hostname.includes("mongodb.net") || hostname.includes("atlas.mongodb")) {
          addDetected("MongoDB Atlas", "MongoDB Atlas domain detected");
        }
        if (hostname.includes("firebase") || hostname.includes("firebaseapp") || hostname.includes("firebaseio")) {
          addDetected("Firebase (Firestore/RTDB)", "Firebase domain → Firestore or Realtime DB");
        }
        if (hostname.includes("appwrite")) {
          addDetected("Appwrite (MariaDB)", "Appwrite domain → MariaDB internally");
        }
        if (railway || hostname.includes("railway.app")) {
          addStack("Railway"); hints.push("Railway hosting — typically provides PostgreSQL/MySQL add-ons");
        }
        if (renderH || hostname.includes("onrender.com")) {
          addStack("Render"); hints.push("Render hosting — typically provides PostgreSQL databases");
        }
        if (hostname.includes("heroku") || heroku) {
          addStack("Heroku"); addDetected("PostgreSQL", "Heroku → Heroku Postgres is the default add-on");
        }

        // ── SIGNAL 3: CMS detection → implied DB ──────────────────────────
        const wpSignals = [
          bodyStr.includes("wp-content"), bodyStr.includes("wp-includes"),
          bodyStr.includes("wordpress"), adminPage.ok && adminPage.status === 200,
          wpAdmin.ok && wpAdmin.status === 200,
        ];
        if (wpSignals.filter(Boolean).length >= 2) {
          addStack("WordPress");
          addDetected("MySQL", `WordPress CMS detected (${wpSignals.filter(Boolean).length} signals) → MySQL`);
        }

        if (bodyStr.includes("ghost-") || bodyStr.includes("data-ghost")) {
          addStack("Ghost CMS");
          addDetected("MySQL/SQLite", "Ghost CMS detected → MySQL (production) or SQLite (dev)");
        }
        if (bodyStr.includes("strapi") || allHeaders["x-powered-by"]?.toLowerCase().includes("strapi")) {
          addStack("Strapi");
          addDetected("PostgreSQL/SQLite", "Strapi CMS detected → PostgreSQL or SQLite");
        }
        if (bodyStr.includes("drupal") || bodyStr.includes("/sites/default/files")) {
          addStack("Drupal");
          addDetected("MySQL/PostgreSQL", "Drupal CMS detected → MySQL or PostgreSQL");
        }
        if (bodyStr.includes("joomla") || bodyStr.includes("/components/com_")) {
          addStack("Joomla");
          addDetected("MySQL", "Joomla CMS detected → MySQL");
        }
        if (phpMyAdmin.ok && phpMyAdmin.status === 200) {
          addDetected("MySQL", "phpMyAdmin accessible at /phpmyadmin — MySQL confirmed");
          issues.push("⚠ phpMyAdmin is publicly accessible — security risk!");
        }

        // ── SIGNAL 4: Inline JS / source code hints ────────────────────────
        const jsHints: [RegExp, string, string][] = [
          [/prisma/i,              "PostgreSQL",  "Prisma ORM detected in page source → typically PostgreSQL"],
          [/typeorm/i,             "PostgreSQL",  "TypeORM detected → PostgreSQL"],
          [/mongoose/i,            "MongoDB",     "Mongoose ODM detected → MongoDB"],
          [/sequelize/i,           "MySQL",       "Sequelize ORM detected → MySQL/PostgreSQL"],
          [/drizzle/i,             "PostgreSQL",  "Drizzle ORM detected → PostgreSQL"],
          [/supabase/i,            "PostgreSQL",  "Supabase client detected → PostgreSQL"],
          [/firebase/i,            "Firebase",    "Firebase SDK detected → Firestore/RTDB"],
          [/dynamodb/i,            "DynamoDB",    "DynamoDB SDK detected"],
          [/redis/i,               "Redis",       "Redis client detected"],
          [/knex/i,                "PostgreSQL",  "Knex.js query builder detected → SQL database"],
          [/pg\.|pg\.pool|pg\.client/i, "PostgreSQL", "node-postgres (pg) detected → PostgreSQL"],
          [/mysql2?\.|mysql\.create/i,  "MySQL",  "mysql/mysql2 detected → MySQL"],
          [/mongodb\+srv/i,        "MongoDB",     "MongoDB connection string pattern detected"],
          [/cockroachdb/i,         "CockroachDB", "CockroachDB detected"],
          [/planetscale/i,         "MySQL (PlanetScale)", "PlanetScale client detected"],
        ];
        for (const [re, db, reason] of jsHints) {
          if (re.test(bodyStr)) addDetected(db, reason);
        }

        // ── SIGNAL 5: Error page analysis — DBs leak in stack traces ───────
        if (errorBody) {
          const errPatterns: [RegExp, string, string][] = [
            [/pg::|psycopg2|psql|postgresql/i, "PostgreSQL", "PostgreSQL error in stack trace"],
            [/mysql_|mysqli|PDO::mysql|mysql2/i, "MySQL", "MySQL error in stack trace"],
            [/mongoclient|mongoerror|mongoose/i, "MongoDB", "MongoDB error in stack trace"],
            [/redis::redis|rediserror/i, "Redis", "Redis error in stack trace"],
            [/sqlite3|sqliteexception/i, "SQLite", "SQLite error in stack trace"],
            [/sqlserver|mssql|sys\.databases/i, "SQL Server", "SQL Server error in stack trace"],
            [/oraclesql|ora-\d{5}/i, "Oracle", "Oracle error in stack trace"],
            [/prisma\.\w+\.find|prismaerror/i, "PostgreSQL", "Prisma error → PostgreSQL"],
            [/relation.+does not exist|column.+does not exist|syntax error.+sql/i, "PostgreSQL", "SQL error in 404 page → database present"],
            [/table.+doesn.t exist|unknown column/i, "MySQL", "MySQL syntax error in error page"],
          ];
          for (const [re, db, reason] of errPatterns) {
            if (re.test(errorBody)) addDetected(db, reason);
          }
        }

        // ── SIGNAL 6: API health/status endpoint — deep parse ─────────────
        const healthEndpoints = [
          "/health", "/api/health", "/status", "/api/status",
          "/health/db", "/api/health/db", "/healthz", "/readyz",
          "/api/v1/health", "/api/v1/status",
        ];
        const healthResults = await Promise.all(
          healthEndpoints.map((ep) =>
            quickGet(origin + ep, 4000).then((r) => ({ ep, r }))
          )
        );
        for (const { ep, r } of healthResults) {
          if (!r.ok || !r.data) continue;
          const body = typeof r.data === "object" ? r.data as Record<string, unknown> : null;
          const bodyTxt = typeof r.data === "string" ? r.data.toLowerCase() : JSON.stringify(r.data).toLowerCase();

          // Look for explicit DB status keys
          const dbKeys = ["database", "db", "postgres", "postgresql", "mysql", "mongo", "mongodb",
                          "redis", "sqlite", "mssql", "sql", "storage", "cache"];
          if (body) {
            for (const key of dbKeys) {
              if (key in body) {
                const val = body[key];
                const status = String(val).toLowerCase();
                const dbName = key === "db" || key === "database" ? "Database" :
                               key === "postgres" || key === "postgresql" ? "PostgreSQL" :
                               key === "mysql" ? "MySQL" :
                               key === "mongo" || key === "mongodb" ? "MongoDB" :
                               key === "redis" ? "Redis" : "Database";
                if (status === "ok" || status === "true" || status === "healthy" || status === "connected") {
                  addDetected(dbName, `"${key}": "${val}" in ${ep} — database confirmed healthy`);
                  score = Math.max(score, 90);
                } else if (status === "false" || status === "down" || status === "error" || status === "unhealthy") {
                  addDetected(dbName, `"${key}": "${val}" in ${ep} — database detected but unhealthy`);
                  issues.push(`Database "${key}" reported as ${val} in ${ep}`);
                  score = 40;
                } else {
                  addDetected(dbName, `"${key}" field found in ${ep} → database present`);
                  score = Math.max(score, 75);
                }
              }
            }
          }

          // Text-based DB detection in health response
          const healthTxtPatterns: [RegExp, string][] = [
            [/postgres|postgresql/i, "PostgreSQL"],
            [/mysql|mariadb/i,       "MySQL"],
            [/mongodb|mongo/i,       "MongoDB"],
            [/redis/i,               "Redis"],
            [/sqlite/i,              "SQLite"],
            [/dynamodb/i,            "DynamoDB"],
            [/firestore/i,           "Firestore"],
          ];
          for (const [re, db] of healthTxtPatterns) {
            if (re.test(bodyTxt)) addDetected(db, `"${db}" mentioned in ${ep} health endpoint`);
          }

          // JSON responses with typical ORM field names imply a DB
          if (body && (body.id !== undefined || body.created_at || body.createdAt || body.updated_at || body.updatedAt)) {
            hints.push(`DB-shaped JSON response from ${ep} (id/created_at fields present)`);
            score = Math.max(score, 70);
          }
        }

        // ── SIGNAL 7: REST API response shape implies DB ───────────────────
        if (home.ok && typeof home.data === "object" && home.data !== null) {
          const obj = home.data as Record<string, unknown>;
          // Array of records with id fields = almost certainly from a DB
          if (Array.isArray(obj)) {
            const first = obj[0] as Record<string, unknown>;
            if (first && (first.id !== undefined || first._id !== undefined)) {
              hints.push("API returns array of records with id fields → database-backed");
              score = Math.max(score, 75);
            }
          } else if (obj.id !== undefined || obj._id !== undefined) {
            hints.push("API response has id field → likely database record");
            score = Math.max(score, 70);
          }
          // GraphQL-style responses
          if (obj.data !== undefined && obj.errors !== undefined) {
            hints.push("GraphQL response shape → database-backed API");
            score = Math.max(score, 75);
          }
        }

        // ── SIGNAL 8a: Deep JS bundle scan ───────────────────────────────────
        // SPAs bundle ALL their code into JS files. The database client (Supabase,
        // Firebase, Prisma etc.) lives in those bundles — NOT in the HTML.
        // We fetch every script tag's src and scan up to 8 bundles for DB patterns.

        const bundlePatterns: [RegExp, string, string][] = [
          // Supabase
          [/supabase\.co/i,                         "PostgreSQL (Supabase)", "supabase.co URL"],
          [/supabase-js|@supabase/i,                "PostgreSQL (Supabase)", "@supabase/supabase-js package"],
          [/createClient[^(]*\([^)]*supabase/i,     "PostgreSQL (Supabase)", "Supabase createClient() call"],
          [/SUPABASE_URL|NEXT_PUBLIC_SUPABASE|VITE_SUPABASE|REACT_APP_SUPABASE/i, "PostgreSQL (Supabase)", "Supabase env variable"],
          [/supabase_anon_key|SUPABASE_ANON_KEY|supabaseAnonKey/i, "PostgreSQL (Supabase)", "Supabase anon key"],
          [/supabaseUrl|supabaseClient|supabase_url/i, "PostgreSQL (Supabase)", "Supabase variable name"],
          [/\.from\(['"`]\w+['"`]\)\.select/,       "PostgreSQL (Supabase)", "Supabase .from().select() query"],
          [/realtime\.supabase\.co|storage\.supabase\.co/, "PostgreSQL (Supabase)", "Supabase realtime/storage URL"],
          // Firebase / Firestore
          [/firebase\.google\.com|firebaseapp\.com|firestore/i, "Firebase (Firestore)", "Firebase SDK URL"],
          [/initializeApp[^)]*apiKey|firebaseConfig/i, "Firebase (Firestore)", "Firebase initializeApp() config"],
          [/getFirestore|collection\(db|addDoc|getDocs/i, "Firebase (Firestore)", "Firestore API calls"],
          // Prisma
          [/PrismaClient|@prisma\/client/i,          "PostgreSQL (Prisma)",  "Prisma client"],
          [/prisma\.\w+\.findMany|prisma\.\w+\.create/i, "PostgreSQL (Prisma)", "Prisma query"],
          // MongoDB / Mongoose
          [/mongoose\.connect|MongoClient|mongodb\+srv/i, "MongoDB",           "MongoDB connection"],
          [/Schema\s*\(\s*\{[^}]+\}\s*\)/,          "MongoDB",               "Mongoose Schema definition"],
          // MySQL
          [/mysql\.createPool|mysql2\.createPool|createConnection.*mysql/i, "MySQL", "MySQL connection pool"],
          // Redis
          [/createClient[^)]*6379|redis\.createClient|ioredis/i, "Redis", "Redis client"],
          // PlanetScale
          [/planetscale|@planetscale/i,              "MySQL (PlanetScale)",   "PlanetScale client"],
          // Neon
          [/neon\.tech|@neondatabase/i,              "PostgreSQL (Neon)",     "Neon database client"],
          // Turso / libSQL
          [/turso|libsql|@libsql/i,                  "SQLite (Turso/libSQL)", "Turso/libSQL client"],
          // Appwrite
          [/appwrite\.io|@appwrite/i,                "Appwrite (MariaDB)",    "Appwrite SDK"],
          // Drizzle ORM
          [/drizzle-orm|drizzleOrm/i,                "PostgreSQL (Drizzle)",  "Drizzle ORM"],
          // Convex
          [/convex\.cloud|@convex-dev/i,             "Convex DB",             "Convex client"],
          // Pocketbase
          [/pocketbase|PocketBase/i,                 "PocketBase (SQLite)",   "PocketBase client"],
        ];

        const supabaseSignals: string[] = [];
        const bundleFoundDbs: string[] = [];

        // Scan the raw HTML source first
        const rawHomeHtml = typeof home.data === "string" ? home.data : "";
        for (const [re, db, reason] of bundlePatterns) {
          if (re.test(rawHomeHtml) || re.test(bodyStr)) {
            if (db.includes("Supabase")) supabaseSignals.push(reason + " (HTML)");
            else bundleFoundDbs.push(`${db}: ${reason} (HTML)`);
          }
        }

        // Collect ALL <script src="..."> tags from HTML (not just 4)
        const jsLinkRe = /<script[^>]+src=["']([^"']*\.js[^"']*)["']/gi;
        const jsSrcs: string[] = [];
        let jsMatch;
        const htmlSource = rawHomeHtml;
        while ((jsMatch = jsLinkRe.exec(htmlSource)) !== null) {
          const src = jsMatch[1];
          // Skip tiny/analytics/tracking scripts
          if (/analytics|gtm|gtag|ads|pixel|facebook|twitter|hotjar|intercom/i.test(src)) continue;
          const absJs = src.startsWith("http") ? src : origin + (src.startsWith("/") ? src : "/" + src);
          if (!jsSrcs.includes(absJs)) jsSrcs.push(absJs);
          if (jsSrcs.length >= 8) break;   // scan up to 8 bundles
        }

        if (jsSrcs.length > 0) {
          // Fetch bundles in parallel — use larger timeout for big JS chunks
          const bundles = await Promise.all(
            jsSrcs.map((u) => quickGet(u, 8000))
          );
          for (const bundle of bundles) {
            if (!bundle.ok || typeof bundle.data !== "string") continue;
            const bt = bundle.data;
            for (const [re, db, reason] of bundlePatterns) {
              if (!re.test(bt)) continue;
              const label = `${reason} (JS bundle)`;
              if (db.includes("Supabase") && !supabaseSignals.includes(label)) {
                supabaseSignals.push(label);
              } else if (!bundleFoundDbs.some((s) => s.startsWith(db))) {
                bundleFoundDbs.push(`${db}: ${label}`);
              }
            }
          }
        }

        // Apply Supabase detections
        if (supabaseSignals.length > 0) {
          // Override CMS-inferred MySQL if Supabase signals are clear
          const mysqlIdx = detected.findIndex((d) => d === "MySQL" || d === "MySQL/MariaDB");
          if (mysqlIdx !== -1 && supabaseSignals.length >= 1) {
            detected.splice(mysqlIdx, 1);
            hints.push("WordPress/MySQL inference overridden by Supabase signals from JS bundle");
          }
          addDetected("PostgreSQL (Supabase)",
            `Supabase confirmed (${supabaseSignals.length} signal${supabaseSignals.length > 1 ? "s" : ""}): ${supabaseSignals.slice(0, 2).join("; ")}`);
          score = Math.max(score, 88);
        }

        // Apply other bundle-detected DBs
        for (const entry of bundleFoundDbs) {
          const db = entry.split(":")[0].trim();
          addDetected(db, entry.split(":").slice(1).join(":").trim());
          score = Math.max(score, 80);
        }

        // ── SIGNAL 8b: Plain-string URL scan in JS bundles ─────────────────
        // Even heavily minified code keeps URLs as literal strings.
        // Look for bare domain patterns that no regex-based approach misses.
        const urlPatterns: [RegExp, string, string][] = [
          [/["'`][a-z0-9-]+\.supabase\.co["'`]/i,  "PostgreSQL (Supabase)", "Supabase project URL string in JS"],
          [/["'`][^"'`]*\.supabase\.co[/]["'`]/i,   "PostgreSQL (Supabase)", "Supabase REST URL in JS"],
          [/["'`]https:\/\/[a-z0-9-]+\.supabase/i,  "PostgreSQL (Supabase)", "Supabase HTTPS URL in JS"],
          [/["'`][^"'`]*firebaseio\.com["'`]/i,      "Firebase (Firestore)", "Firebase RTDB URL in JS"],
          [/["'`][^"'`]*\.firebaseapp\.com["'`]/i,   "Firebase (Firestore)", "Firebase project URL in JS"],
          [/["'`]mongodb\+srv:\/\//i,                "MongoDB",              "MongoDB Atlas connection string"],
          [/["'`][^"'`]*\.neon\.tech["'`]/i,         "PostgreSQL (Neon)",    "Neon database URL in JS"],
          [/["'`][^"'`]*\.turso\.io["'`]/i,          "SQLite (Turso)",       "Turso database URL in JS"],
          [/["'`][^"'`]*\.cockroachlabs\.com["'`]/i, "CockroachDB",          "CockroachDB URL in JS"],
          [/["'`][^"'`]*convex\.cloud["'`]/i,        "Convex DB",            "Convex URL in JS"],
        ];

        // Scan all already-fetched bundles + HTML for plain URL strings
        const allScannedText = [rawHomeHtml, bodyStr].join(" ");
        for (const [re, db, reason] of urlPatterns) {
          if (re.test(allScannedText)) {
            if (db.includes("Supabase")) {
              if (!supabaseSignals.includes(reason)) {
                supabaseSignals.push(reason);
                // Also add to detected if not already there
                if (!detected.some((d) => d.includes("Supabase"))) {
                  addDetected("PostgreSQL (Supabase)", reason);
                  score = Math.max(score, 88);
                }
              }
            } else {
              addDetected(db, reason);
              score = Math.max(score, 80);
            }
          }
        }

        // ── SIGNAL 8: Framework-specific URL patterns ──────────────────────
        if (bodyStr.includes("/__next") || bodyStr.includes("_next/static")) {
          addStack("Next.js");
          hints.push("Next.js detected → likely uses Prisma/PostgreSQL or MongoDB");
        }
        if (bodyStr.includes("__nuxt") || bodyStr.includes("_nuxt")) {
          addStack("Nuxt.js");
        }
        if (bodyStr.includes("inertia") || bodyStr.includes("laravel")) {
          addStack("Laravel"); addDetected("MySQL", "Laravel framework → MySQL");
        }
        if (bodyStr.includes("rails-env") || bodyStr.includes("ruby on rails")) {
          addStack("Ruby on Rails"); addDetected("PostgreSQL", "Rails detected → PostgreSQL");
        }
        if (bodyStr.includes("django") || bodyStr.includes("csrfmiddlewaretoken")) {
          addStack("Django"); addDetected("PostgreSQL", "Django detected → typically PostgreSQL");
        }

        // ── SIGNAL 9: Non-invasive TCP port scan ──────────────────────────
        const isPublicIp = hostname !== "localhost" && !hostname.startsWith("127.") && !hostname.startsWith("192.168.");
        if (isPublicIp) {
          const DB_PORTS: [number, string][] = [
            [3306, "MySQL"], [5432, "PostgreSQL"], [27017, "MongoDB"],
            [6379, "Redis"], [1433, "SQL Server"], [5984, "CouchDB"],
            [9200, "Elasticsearch"], [8123, "ClickHouse"],
          ];
          const portResults = await Promise.all(
            DB_PORTS.map(async ([port, service]) => {
              const r = await checkTcpPort(hostname, port, 1500);
              return r.connected ? { port, service } : null;
            })
          );
          portResults.filter(Boolean).forEach((r) => {
            exposedPorts.push(r!);
            addDetected(r!.service, `Port ${r!.port} publicly open → ${r!.service} confirmed`);
            issues.push(`⚠ ${r!.service} port ${r!.port} is publicly accessible — secure it!`);
            score = Math.min(score, 30);
          });
        }

        // ── SIGNAL 10: Platform + hosting inference ────────────────────────
        // When database is accessed only server-side (Node.js, Express, etc.),
        // the JS bundles contain no DB client code. Infer from platform signals.
        const vercelHosted  = !!(allHeaders["x-vercel-id"] || allHeaders["x-vercel-cache"]);
        const renderHosted  = !!(allHeaders["x-render-origin-server"] || hostname.includes(".onrender.com"));
        const railwayHosted = !!(allHeaders["x-railway-request-id"] || hostname.includes(".railway.app"));
        const herokuHosted  = hostname.includes(".herokuapp.com");
        const netlifyHosted = !!(allHeaders["x-nf-request-id"] || hostname.includes(".netlify.app"));
        const cloudflareHosted = !!(allHeaders["cf-ray"]);

        // Cloud platform → DB inference (works for SPAs, SSR, APIs — any architecture)
        // When database is accessed server-side the JS bundles contain no DB code.
        // But the hosting platform strongly implies which DB is used.
        if (detected.length === 0) {
          if (vercelHosted) {
            addDetected("PostgreSQL",
              "Vercel hosting detected — Vercel Postgres (Neon) is the platform-native database");
            hints.push("Database is server-side only — not visible in JS bundles");
            score = Math.max(score, 68);
          } else if (renderHosted) {
            addDetected("PostgreSQL",
              "Render hosting detected — Render provides managed PostgreSQL databases");
            score = Math.max(score, 65);
          } else if (railwayHosted) {
            addDetected("PostgreSQL / MySQL",
              "Railway hosting detected — Railway offers PostgreSQL and MySQL add-ons");
            score = Math.max(score, 65);
          } else if (herokuHosted) {
            addDetected("PostgreSQL",
              "Heroku hosting detected — Heroku Postgres is the default and most popular add-on");
            score = Math.max(score, 65);
          } else if (netlifyHosted) {
            hints.push("Netlify hosting — typically static/Jamstack, DB lives in a separate service");
          } else {
            // Stack-based inference (non-cloud or unknown hosting)
            const stackStr = stack.join(" ").toLowerCase();
            if (stackStr.includes("php") || stackStr.includes("laravel") || stackStr.includes("wordpress")) {
              addDetected("MySQL", `Inferred from ${stack[0]} — PHP apps almost always use MySQL/MariaDB`);
            } else if (stackStr.includes("python") || stackStr.includes("django") || stackStr.includes("flask")) {
              addDetected("PostgreSQL", `Inferred from ${stack[0]} — Python web apps typically use PostgreSQL`);
            } else if (stackStr.includes("ruby") || stackStr.includes("rails")) {
              addDetected("PostgreSQL", `Inferred from ${stack[0]} — Rails defaults to PostgreSQL`);
            } else if (stackStr.includes("node") || stackStr.includes("express")) {
              addDetected("PostgreSQL / MongoDB", `Node.js backend — common choices: PostgreSQL, MongoDB, Supabase`);
              score = Math.max(score, 60);
            } else if (stackStr.includes("java") || stackStr.includes("spring")) {
              addDetected("MySQL / Oracle", `Inferred from ${stack[0]} — Java apps commonly use MySQL or Oracle`);
            } else if (stackStr.includes("asp") || stackStr.includes(".net")) {
              addDetected("SQL Server", `Inferred from ${stack[0]} — ASP.NET apps typically use SQL Server`);
            }
          }
        }

        // Non-SPA backend inference
        if (detected.length === 0 && stack.length > 0) {
          const stackStr = stack.join(" ").toLowerCase();
          if (stackStr.includes("php") || stackStr.includes("laravel") || stackStr.includes("wordpress")) {
            addDetected("MySQL", `Inferred from ${stack[0]} — PHP apps almost always use MySQL/MariaDB`);
          } else if (stackStr.includes("python") || stackStr.includes("django") || stackStr.includes("flask")) {
            addDetected("PostgreSQL", `Inferred from ${stack[0]} — Python web apps typically use PostgreSQL`);
          } else if (stackStr.includes("ruby") || stackStr.includes("rails")) {
            addDetected("PostgreSQL", `Inferred from ${stack[0]} — Rails defaults to PostgreSQL`);
          } else if (stackStr.includes("java") || stackStr.includes("spring")) {
            addDetected("MySQL / Oracle", `Inferred from ${stack[0]} — Java apps commonly use MySQL or Oracle`);
          } else if (stackStr.includes("asp") || stackStr.includes(".net")) {
            addDetected("SQL Server", `Inferred from ${stack[0]} — ASP.NET apps typically use SQL Server`);
          }
        }

        // Last resort: real web apps almost always have a database
        if (detected.length === 0 && (home.status ?? 0) < 400) {
          if (vercelHosted || renderHosted || railwayHosted) {
            hints.push("Cloud-hosted app — database likely exists but accessed server-side only");
          } else {
            hints.push("No DB signals found — add GET /health → {\"database\":\"ok\"} for accurate detection");
          }
        }

        const finalScore = Math.max(0, Math.min(100,
          exposedPorts.length ? Math.min(score, 30) :
          detected.length >= 2 ? Math.max(score, 80) :
          detected.length === 1 ? Math.max(score, 70) :
          score
        ));

        return {
          score: finalScore,
          status: exposedPorts.length ? "critical" : detected.length > 0 ? "healthy" : "warning",
          detected, stack, exposedPorts, hints, issues,
          confidence: detected.length >= 2 ? "high" : detected.length === 1 ? "medium" : "low",
        };
      })(),
    ]);

    res.json({
      url,
      origin,
      hostname,
      scannedAt: Date.now(),
      website:  websiteResult,
      api:      apiResult,
      server:   serverResult,
      database: dbResult,
      overallScore: (() => {
        // Exclude API from overall if not applicable (CMS/static site with no API layer)
        const scores = [websiteResult.score, serverResult.score, dbResult.score];
        if (!apiResult.notApplicable && apiResult.score !== null) scores.push(apiResult.score);
        return Math.round(scores.reduce((s, v) => s + (v ?? 0), 0) / scores.length);
      })(),
    });
  });

  // ── Database Health Check ─────────────────────────────────────────────────
  // POST /api/db-check  — directly test a database connection and measure latency
  // Supports: PostgreSQL, MySQL, MongoDB, Redis, and any TCP-reachable host:port
  // Returns: connected, latency, dbType, host, port, tlsEnabled, error

  app.post("/api/db-check", async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url) return res.status(400).json({ error: "url is required" });

    // Identify DB type from the connection string
    const proto = (url.match(/^(\w+):\/\//i)?.[1] || "").toLowerCase();
    const DB_TYPE_MAP: Record<string, string> = {
      postgresql: "PostgreSQL", postgres: "PostgreSQL",
      mysql: "MySQL", mariadb: "MariaDB",
      mongodb: "MongoDB", mongo: "MongoDB",
      redis: "Redis", rediss: "Redis",
      mssql: "SQL Server", sqlserver: "SQL Server",
      oracle: "Oracle", cassandra: "Cassandra",
      elasticsearch: "Elasticsearch", clickhouse: "ClickHouse",
    };
    const dbType = DB_TYPE_MAP[proto] || (proto ? proto.toUpperCase() : "Database");

    // Parse host:port
    const defaultPort = getDbDefaultPort(url);
    const hp = parseHostPort(url, defaultPort);
    if (!hp) {
      return res.status(400).json({ error: "Cannot parse host/port from connection string", hint: "Use: postgresql://host:5432 or host:5432" });
    }

    // Check TLS (rediss:// or port 5432 with ssl, etc.)
    const tlsEnabled = proto === "rediss" || url.includes("ssl=true") || url.includes("sslmode=require");

    // Run 3 consecutive TCP pings to get stable latency
    const results: number[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < 3; i++) {
      const r = await checkTcpPort(hp.host, hp.port, 6000);
      if (r.connected) {
        results.push(r.responseTime);
      } else {
        lastError = r.error ?? "Connection failed";
      }
    }

    const connected = results.length > 0;
    const avgLatency = connected
      ? Math.round(results.reduce((s, v) => s + v, 0) / results.length)
      : null;
    const minLatency = connected ? Math.min(...results) : null;
    const maxLatency = connected ? Math.max(...results) : null;

    // Determine health assessment
    const healthStatus =
      !connected                       ? "down"
      : avgLatency! > 2000             ? "critical"
      : avgLatency! > 500              ? "slow"
      : avgLatency! > 200              ? "degraded"
      : "healthy";

    const healthMsg =
      healthStatus === "down"     ? `Cannot reach ${hp.host}:${hp.port} — ${lastError || "connection refused"}`
      : healthStatus === "critical" ? `Very high latency (${avgLatency}ms) — database may be overloaded`
      : healthStatus === "slow"     ? `Slow response (${avgLatency}ms) — check resource usage`
      : healthStatus === "degraded" ? `Elevated latency (${avgLatency}ms) — within acceptable range`
      : `Reachable and responsive (${avgLatency}ms)`;

    // For Supabase/hosted databases, also try an HTTP health endpoint
    let httpHealth: { url: string; status: number; ok: boolean; latency: number } | null = null;
    if (url.includes("supabase.co") || url.includes("neon.tech") || url.includes("planetscale")) {
      try {
        const originMatch = url.match(/https?:\/\/[^/]+/);
        if (originMatch) {
          const t0 = Date.now();
          const r = await axios.get(originMatch[0] + "/health", { timeout: 5000, validateStatus: null });
          httpHealth = { url: originMatch[0] + "/health", status: r.status, ok: r.status < 400, latency: Date.now() - t0 };
        }
      } catch { /* not available */ }
    }

    res.json({
      connected,
      host:       hp.host,
      port:       hp.port,
      dbType,
      tlsEnabled,
      healthStatus,
      healthMsg,
      avgLatency,
      minLatency,
      maxLatency,
      pingCount:  results.length,
      latencies:  results,
      error:      connected ? null : lastError,
      httpHealth,
      recommendations: !connected ? [
        "Verify the host and port are correct",
        "Check your firewall allows inbound connections on port " + hp.port,
        "Ensure the database service is running",
        "Confirm network connectivity between Lumina and the DB host",
      ] : avgLatency! > 500 ? [
        "Query latency is high — check active connections and slow query logs",
        "Consider connection pooling (PgBouncer for PostgreSQL, ProxySQL for MySQL)",
        "Review index usage and query plans for frequent queries",
        "Check CPU / memory utilisation on the database host",
      ] : [],
    });
  });

  // GET /api/db-history/:projectId — latency trend for a DB project (last 50 records)
  app.get("/api/db-history/:projectId", (req, res) => {
    const recs = readHealthRecords()
      .filter((r) => r.projectId === req.params.projectId)
      .slice(0, 50);
    const project = readProjects().find((p) => p.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const latencies = recs.map((r) => r.responseTime).filter(Boolean).sort((a, b) => a - b);
    const avg  = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : null;
    const p50  = latencies.length ? latencies[Math.floor(latencies.length * 0.50)] : null;
    const p95  = latencies.length ? latencies[Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1)] : null;
    const p99  = latencies.length ? latencies[Math.min(Math.floor(latencies.length * 0.99), latencies.length - 1)] : null;
    const errorRate = recs.length ? Math.round(recs.filter((r) => r.status !== "operational").length / recs.length * 100) : 0;

    res.json({
      project: { id: project.id, name: project.name, url: project.url, type: project.type, status: project.status },
      stats: { avg, p50, p95, p99, errorRate, sampleCount: recs.length },
      trend: recs.slice(0, 50).reverse().map((r) => ({
        timestamp:    r.timestamp,
        responseTime: r.responseTime,
        status:       r.status,
        checkType:    r.checkType,
      })),
    });
  });

  // ── Health Records API ────────────────────────────────────────────────────

  app.get("/api/health-records", (req, res) => {
    const { projectId, limit = "200" } = req.query as Record<string, string>;
    let recs = readHealthRecords();
    if (projectId) recs = recs.filter((r) => r.projectId === projectId);
    res.json(recs.slice(0, Math.min(Number(limit), 5000)));
  });

  // GET /api/health-table — one summary row per project (the unified health dashboard)
  app.get("/api/health-table", (_req, res) => {
    const projects = readProjects();
    const issues   = readIssues();
    const allRecs  = readHealthRecords();

    const rows = projects.map((p) => {
      const recs    = allRecs.filter((r) => r.projectId === p.id);
      const recent  = recs.slice(0, 20);
      const errors  = recent.filter((r) => r.status !== "operational").length;
      const lats    = recent.map((r) => r.responseTime).filter(Boolean).sort((a, b) => a - b);
      const avgLat  = lats.length ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : null;
      const p50     = lats.length ? lats[Math.floor(lats.length * 0.5)]  : null;
      const p95     = lats.length ? lats[Math.min(Math.floor(lats.length * 0.95), lats.length - 1)] : null;
      const lastOK  = recs.find((r) => r.status === "operational");
      const oi      = issues.find((i) => i.projectId === p.id && i.status === "open");
      const uLast20 = recent.length
        ? Math.round(recent.filter((r) => r.status === "operational").length / recent.length * 10000) / 100
        : null;
      return {
        projectId:      p.id,
        name:           p.name,
        url:            p.url,
        type:           p.type,
        status:         p.status,
        lastChecked:    p.lastChecked,
        lastSuccess:    lastOK ? lastOK.timestamp : null,
        avgLatency:     avgLat,
        p50Latency:     p50,
        p95Latency:     p95,
        uptimePct:      p.uptimePct,
        uptimeLast20:   uLast20,
        errorCount:     errors,
        retryCount:     p.consecutiveFailures || 0,
        checkCount:     p.checkCount,
        lastStatusCode: p.lastStatusCode || null,
        sslDaysLeft:    p.sslDaysLeft != null ? p.sslDaysLeft : null,
        openIssue:      oi ? { id: oi.id, severity: oi.severity, message: oi.message, startedAt: oi.startedAt } : null,
        checkType:      recs[0] ? recs[0].checkType : (p.url.startsWith("http") ? "http" : "tcp"),
      };
    });

    const healthy  = rows.filter((r) => r.status === "operational").length;
    const degraded = rows.filter((r) => r.status === "degraded").length;
    const down     = rows.filter((r) => r.status === "down").length;
    const avgUptime = rows.length
      ? Math.round(rows.reduce((s, r) => s + r.uptimePct, 0) / rows.length * 100) / 100
      : 100;
    res.json({ rows, summary: { healthy, degraded, down, total: rows.length, avgUptime } });
  });

  app.delete("/api/health-records", (_req, res) => {
    writeJson(FILES.healthRecords, []);
    res.json({ ok: true });
  });

  // ── Test Webhook (from Settings page) ────────────────────────────────────

  app.post("/api/test-webhook", async (req, res) => {
    const s = readSettings();
    if (!s.webhookUrl) return res.status(400).json({ error: "Webhook URL not configured" });
    try {
      await axios.post(s.webhookUrl, {
        event: "test",
        source: "lumina-monitor",
        message: "Lumina Monitor webhook integration is working correctly",
        timestamp: new Date().toISOString(),
      }, {
        timeout: 8000,
        headers: { "Content-Type": "application/json", "User-Agent": "LuminaMonitor/1.0" },
      });
      res.json({ ok: true, message: "Test webhook fired successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to fire test webhook" });
    }
  });

  // ─── APM Analytics ───────────────────────────────────────────────────────────
  // GET /api/apm — aggregate latency percentiles, error rates, apdex, throughput

  app.get("/api/apm", (_req, res) => {
    const projects = readProjects();
    const allRecs  = readHealthRecords();

    const pct = (arr: number[], p: number) =>
      arr.length ? arr[Math.min(Math.floor(arr.length * p / 100), arr.length - 1)] : null;

    const projectStats = projects.map((p) => {
      const recs = allRecs.filter((r) => r.projectId === p.id).slice(0, 500);
      const lats = recs.map((r) => r.responseTime).filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b);

      const p50 = pct(lats, 50);
      const p75 = pct(lats, 75);
      const p95 = pct(lats, 95);
      const p99 = pct(lats, 99);
      const avg = lats.length ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : null;
      const min = lats.length ? lats[0] : null;
      const max = lats.length ? lats[lats.length - 1] : null;

      const errorCount  = recs.filter((r) => r.status !== "operational").length;
      const errorRate   = recs.length ? Math.round(errorCount / recs.length * 1000) / 10 : 0;
      const availability = recs.length ? Math.round((recs.length - errorCount) / recs.length * 10000) / 100 : 100;

      // Apdex score (T = 1500ms)
      const T          = 1500;
      const satisfied  = lats.filter((v) => v <= T).length;
      const tolerating = lats.filter((v) => v > T && v <= T * 4).length;
      const apdex      = lats.length ? Math.round((satisfied + tolerating / 2) / lats.length * 100) / 100 : null;

      // Throughput: checks per hour based on last 24h
      const oneDayAgo    = Date.now() - 86400000;
      const last24h      = recs.filter((r) => r.timestamp > oneDayAgo);
      const checksPerHour = last24h.length ? Math.round(last24h.length / 24 * 10) / 10 : 0;

      // 24-hour hourly time-series buckets
      const now = Date.now();
      const timeSeries = Array.from({ length: 24 }, (_, i) => {
        const hourStart = now - (23 - i) * 3600000;
        const hourEnd   = hourStart + 3600000;
        const hr  = recs.filter((r) => r.timestamp >= hourStart && r.timestamp < hourEnd);
        const hl  = hr.map((r) => r.responseTime).filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b);
        const he  = hr.filter((r) => r.status !== "operational").length;
        return {
          hour:      new Date(hourStart).toISOString(),
          p50:       hl.length ? hl[Math.floor(hl.length * 0.5)]  : null,
          p95:       hl.length ? hl[Math.min(Math.floor(hl.length * 0.95), hl.length - 1)] : null,
          errorRate: hr.length ? Math.round(he / hr.length * 100) : 0,
          count:     hr.length,
        };
      });

      return { id: p.id, name: p.name, url: p.url, type: p.type, status: p.status,
               p50, p75, p95, p99, avg, min, max, errorRate, availability,
               checksTotal: recs.length, checksPerHour, apdex, timeSeries };
    });

    const valid = projectStats.filter((s) => s.p95 !== null);
    const summary = {
      avgP95:          valid.length ? Math.round(valid.reduce((s, v) => s + (v.p95 || 0), 0) / valid.length) : null,
      avgErrorRate:    projectStats.length ? Math.round(projectStats.reduce((s, v) => s + v.errorRate, 0) / projectStats.length * 10) / 10 : 0,
      avgAvailability: projectStats.length ? Math.round(projectStats.reduce((s, v) => s + v.availability, 0) / projectStats.length * 100) / 100 : 100,
      totalProjects:   projectStats.length,
    };

    res.json({ projects: projectStats, summary });
  });

  // ─── HTTP Waterfall Trace ──────────────────────────────────────────────────────
  // POST /api/trace { url } — real per-stage timing via Node.js socket events

  app.post("/api/trace", async (req, res) => {
    const { url } = req.body as { url: string };
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL must start with http:// or https://" });
    }
    try {
      const isHttps  = url.startsWith("https");
      const urlObj   = new URL(url);
      const httpsMod = await import("https");
      const httpMod  = await import("http");
      const mod      = isHttps ? httpsMod.default : httpMod.default;

      const timings: Record<string, number> = {};
      let statusCode = 0;
      let bodyLength = 0;
      let resHeaders: Record<string, string | string[] | undefined> = {};

      await new Promise<void>((resolve, reject) => {
        const t0      = Date.now();
        const lap     = () => Date.now() - t0;

        const options = {
          hostname: urlObj.hostname,
          port:     parseInt(urlObj.port) || (isHttps ? 443 : 80),
          path:     (urlObj.pathname || "/") + urlObj.search,
          method:   "GET",
          headers:  { "User-Agent": "LuminaMonitor/Trace/1.0", "Accept": "*/*", "Accept-Encoding": "identity" },
          timeout:  15000,
        };

        const request = (mod as any).request(options, (response: any) => {
          timings.firstByte = lap();
          statusCode  = response.statusCode ?? 0;
          resHeaders  = response.headers ?? {};
          let body    = "";
          response.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          response.on("end", () => {
            timings.total = lap();
            bodyLength = body.length;

            const dns      = timings.lookup  ?? 0;
            const connect  = timings.connect ?? (dns + 5);
            const secure   = timings.secureConnect ?? (isHttps ? connect + 20 : 0);
            const tcp      = Math.max(0, connect - dns);
            const tls      = isHttps ? Math.max(0, secure - connect) : null;
            const ttfb     = Math.max(0, timings.firstByte - (isHttps ? secure : connect));
            const transfer = Math.max(0, timings.total - timings.firstByte);

            res.json({
              url, statusCode,
              timings: { dns, tcp, tls, ttfb, transfer, total: timings.total },
              response: {
                size:        bodyLength,
                contentType: String(resHeaders["content-type"] ?? ""),
                server:      String(resHeaders["server"] ?? ""),
                cacheControl:String(resHeaders["cache-control"] ?? ""),
              },
            });
            resolve();
          });
          response.on("error", reject);
        });

        request.on("socket", (socket: any) => {
          socket.on("lookup",        () => { timings.lookup        = lap(); });
          socket.on("connect",       () => { timings.connect       = lap(); });
          socket.on("secureConnect", () => { timings.secureConnect = lap(); });
        });
        request.on("timeout", () => { request.destroy(); reject(new Error("Request timed out")); });
        request.on("error", reject);
        request.end();
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Trace failed" });
    }
  });

  // ─── Synthetic Tests ──────────────────────────────────────────────────────────

  app.get("/api/synthetic-tests", (_req, res) => {
    const tests   = readSyntheticTests();
    const results = readSyntheticResults();
    res.json(tests.map((t) => ({ ...t, lastRun: results.find((r) => r.testId === t.id) ?? null })));
  });

  app.post("/api/synthetic-tests", (req, res) => {
    const { name, description, steps, enabled } = req.body;
    const test: SyntheticTest = {
      id: `syn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name, description, steps: steps || [],
      enabled: enabled ?? true,
      createdAt: Date.now(),
    };
    const tests = readSyntheticTests();
    tests.unshift(test);
    writeJson(FILES.syntheticTests, tests);
    res.json(test);
  });

  app.put("/api/synthetic-tests/:id", (req, res) => {
    const tests = readSyntheticTests();
    const idx = tests.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    tests[idx] = { ...tests[idx], ...req.body, id: tests[idx].id, createdAt: tests[idx].createdAt };
    writeJson(FILES.syntheticTests, tests);
    res.json(tests[idx]);
  });

  app.delete("/api/synthetic-tests/:id", (req, res) => {
    writeJson(FILES.syntheticTests, readSyntheticTests().filter((t) => t.id !== req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/synthetic-tests/:id/run", async (req, res) => {
    const tests = readSyntheticTests();
    const test  = tests.find((t) => t.id === req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const runStart   = Date.now();
    const stepResults: StepRunResult[] = [];
    let overallStatus: "pass" | "fail" | "error" = "pass";

    for (const step of test.steps) {
      const stepStart: number = Date.now();
      const sr: StepRunResult = {
        stepId: step.id, name: step.name, url: step.url, method: step.method,
        statusCode: null, responseTime: 0, assertions: [], passed: true,
      };
      try {
        const resp = await axios({
          method: step.method, url: step.url, timeout: 15000,
          headers: { "User-Agent": "LuminaMonitor/Synthetic/1.0", ...(step.headers ?? {}) },
          data: step.body ? (() => { try { return JSON.parse(step.body!); } catch { return step.body; } })() : undefined,
          validateStatus: null,
        });
        sr.statusCode   = resp.status;
        sr.responseTime = Date.now() - stepStart;
        const bodyStr   = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data ?? "");

        let stepPassed = true;
        for (const a of step.assertions) {
          let actual = ""; let passed = false;
          if (a.type === "status") {
            actual = String(resp.status);
            passed = a.operator === "eq" ? actual === a.value
                   : a.operator === "lt" ? resp.status < Number(a.value)
                   : a.operator === "gt" ? resp.status > Number(a.value)
                   : false;
          } else if (a.type === "body_contains") {
            actual = bodyStr.slice(0, 200);
            passed = a.operator === "contains"     ? bodyStr.includes(a.value)
                   : a.operator === "not_contains" ? !bodyStr.includes(a.value)
                   : a.operator === "eq"           ? bodyStr.trim() === a.value
                   : false;
          } else if (a.type === "response_time") {
            actual = String(sr.responseTime);
            passed = a.operator === "lt" ? sr.responseTime < Number(a.value)
                   : a.operator === "gt" ? sr.responseTime > Number(a.value)
                   : false;
          } else if (a.type === "header") {
            const hv = String(resp.headers[(a.target ?? "").toLowerCase()] ?? "");
            actual = hv.slice(0, 100);
            passed = a.operator === "contains"     ? hv.includes(a.value)
                   : a.operator === "not_contains" ? !hv.includes(a.value)
                   : a.operator === "eq"           ? hv === a.value
                   : false;
          }
          sr.assertions.push({ ...a, passed, actual });
          if (!passed) stepPassed = false;
        }
        sr.passed = stepPassed;
        if (!stepPassed) overallStatus = "fail";
      } catch (e: any) {
        sr.responseTime = Date.now() - stepStart;
        sr.error  = e.message ?? "Request failed";
        sr.passed = false;
        overallStatus = "error";
      }
      stepResults.push(sr);
      if (!sr.passed) break; // stop on first failure (simulate user journey)
    }

    const result: SyntheticRunResult = {
      id:           `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      testId:       test.id,
      runAt:        runStart,
      duration:     Date.now() - runStart,
      status:       overallStatus,
      steps:        stepResults,
      passedSteps:  stepResults.filter((s) => s.passed).length,
      totalSteps:   test.steps.length,
    };

    const results = readSyntheticResults();
    results.unshift(result);
    writeJson(FILES.syntheticResults, results.slice(0, 500));

    const idx = tests.findIndex((t) => t.id === test.id);
    if (idx !== -1) {
      tests[idx].lastRunAt     = runStart;
      tests[idx].lastRunStatus = overallStatus;
      writeJson(FILES.syntheticTests, tests);
    }
    res.json(result);
  });

  app.get("/api/synthetic-results/:testId", (req, res) => {
    res.json(readSyntheticResults().filter((r) => r.testId === req.params.testId).slice(0, 50));
  });

  // ─── Service Map ──────────────────────────────────────────────────────────────
  // GET /api/service-map — nodes (projects) with health stats for topology view

  app.get("/api/service-map", (_req, res) => {
    const projects = readProjects();
    const issues   = readIssues();
    const allRecs  = readHealthRecords();

    const nodes = projects.map((p) => {
      const recs = allRecs.filter((r) => r.projectId === p.id).slice(0, 20);
      const lats = recs.map((r) => r.responseTime).filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b);
      const p95  = lats.length ? lats[Math.min(Math.floor(lats.length * 0.95), lats.length - 1)] : null;
      const openIssue = issues.find((i) => i.projectId === p.id && i.status === "open");
      return {
        id: p.id, name: p.name, url: p.url, type: p.type,
        status: p.status, uptimePct: p.uptimePct,
        p95Latency:  p95,
        lastChecked: p.lastChecked,
        openIssue:   openIssue ? { severity: openIssue.severity, message: openIssue.message } : null,
      };
    });

    res.json({ nodes, edges: [] });
  });

  // ── Logs API ──────────────────────────────────────────────────────────────

  interface LogEntry {
    id: string;
    timestamp: number;
    level: "DEBUG" | "INFO" | "WARN" | "ERROR";
    service: string;
    serviceId: string;
    message: string;
    content: Record<string, any>;
    tags: string[];
  }

  app.get("/api/log-explorer", (req, res) => {
    const levelsParam = (req.query.levels as string) || "DEBUG,INFO,WARN,ERROR";
    const levels      = levelsParam.split(",").filter(Boolean);
    const search      = ((req.query.search as string) || "").toLowerCase().trim();
    const fromTs      = req.query.from ? parseInt(req.query.from as string) : Date.now() - 30 * 60 * 1000;
    const toTs        = req.query.to   ? parseInt(req.query.to   as string) : Date.now();
    const limitN      = Math.min(500, parseInt((req.query.limit  as string) || "200"));
    const offset      = parseInt((req.query.offset as string) || "0");

    const projects = readProjects();
    const nameMap: Record<string, string> = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const typeMap: Record<string, string> = Object.fromEntries(projects.map((p) => [p.id, p.type]));
    const urlMap:  Record<string, string> = Object.fromEntries(projects.map((p) => [p.id, p.url]));

    // LogType → Level mapping
    const typeToLevel: Record<string, LogEntry["level"]> = {
      success: "INFO",
      info:    "INFO",
      warning: "WARN",
      error:   "ERROR",
    };

    // Read real logs (from monitoring checks) and map them to explorer format
    const rawLogs = readLogs()
      .filter((l) => l.timestamp >= fromTs && l.timestamp <= toTs);

    const explorerLogs: LogEntry[] = rawLogs.map((l) => {
      const level = typeToLevel[l.type] ?? "INFO";
      return {
        id:        l.id,
        timestamp: l.timestamp,
        level,
        service:   nameMap[l.projectId] ?? "Unknown",
        serviceId: l.projectId,
        message:   l.message,
        content: {
          url:          urlMap[l.projectId]  ?? "",
          type:         typeMap[l.projectId] ?? "website",
          statusCode:   l.statusCode   ?? null,
          responseTime: l.responseTime ?? null,
          logType:      l.type,
          timestamp:    new Date(l.timestamp).toISOString(),
        },
        tags: [typeMap[l.projectId] ?? "website"],
      } as LogEntry;
    });

    // Sort newest first
    explorerLogs.sort((a, b) => b.timestamp - a.timestamp);

    // Filter by level and optional search term
    let filtered = explorerLogs.filter((l) => levels.includes(l.level));
    if (search) {
      filtered = filtered.filter((l) =>
        l.message.toLowerCase().includes(search) ||
        l.service.toLowerCase().includes(search) ||
        JSON.stringify(l.content).toLowerCase().includes(search)
      );
    }

    // Histogram — 20 equal-width buckets across the requested time range
    const span     = Math.max(toTs - fromTs, 1);
    const bucketMs = Math.max(1000, Math.floor(span / 20));
    const histogram: { time: number; INFO: number; WARN: number; ERROR: number; DEBUG: number }[] = [];
    for (let t = fromTs; t < toTs; t += bucketMs) {
      const b = { time: t, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
      for (const l of explorerLogs) {
        if (l.timestamp >= t && l.timestamp < t + bucketMs) {
          (b as Record<string, number>)[l.level]++;
        }
      }
      histogram.push(b);
    }

    res.json({
      logs:      filtered.slice(offset, offset + limitN),
      total:     filtered.length,
      histogram,
    });
  });

  // ── Vite / Static ─────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // ── HTTP + WebSocket server ────────────────────────────────────────────────

  const httpServer = http.createServer(app);

  wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (socket) => {
    // Send current state immediately on connect
    socket.send(JSON.stringify({ event: "projects_update", data: readProjects() }));
    socket.on("error", () => {});
  });

  // Keep connections alive
  setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.ping();
    });
  }, 30000);

  const PORT = parseInt(process.env.PORT || "8080", 10);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Lumina Monitor running on http://0.0.0.0:${PORT}`);
    console.log(`Public status page: http://0.0.0.0:${PORT}/status`);

    // Initial health checks (2s delay to let the server fully start)
    setTimeout(async () => {
      for (const p of readProjects().filter((p) => p.enabled)) {
        await checkProject(p).catch(() => {});
      }
    }, 2000);

    // Auto-analyze website info for any existing project that doesn't have it yet
    // Staggers requests 8s apart to avoid hammering Groq rate limits
    setTimeout(async () => {
      const projects = readProjects().filter(
        (p) => /^https?:\/\//i.test(p.url) && !p.websiteInfo
      );
      if (projects.length === 0) return;
      console.log(`[WEBSITE INFO] Auto-analyzing ${projects.length} project(s) without website info…`);
      for (const p of projects) {
        await analyzeWebsiteInfo(p.id).catch(() => {});
        // Small delay between requests so we don't hit Groq rate limits
        await new Promise((r) => setTimeout(r, 8000));
      }
    }, 5000);
  });
}

startServer();
