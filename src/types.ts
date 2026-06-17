// ─── Existing analysis types ──────────────────────────────────────────────────

export type StatusType = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "not_found";

export interface CodeSnippet {
  name: string;
  code: string;
  language: string;
  type: "function" | "component" | "config";
}

export interface SystemComponent {
  id: string;
  name: string;
  description: string;
  details: string;
  healthDetails: string[];
  status: StatusType;
  uptimePct: number;
  history: number[];
  snippets?: CodeSnippet[];
}

export interface CodeExplanation {
  summary: string;
  logic: string[];
  performance: string;
  security: string;
}

export interface Update {
  timestamp: string;
  title: string;
  message: string;
}

export interface Incident {
  id: string;
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved" | "completed" | "scheduled";
  severity: "low" | "medium" | "high";
  startedAt: string;
  resolvedAt?: string;
  updates: Update[];
}

export interface Metric {
  timestamp: string;
  value: number;
}

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertRule {
  id: string;
  componentId: string | "all";
  triggerStatus: StatusType[];
  type: "email" | "webhook";
  destination: string;
  enabled: boolean;
  name: string;
  severity: AlertSeverity;
}

// ─── Project monitoring types ─────────────────────────────────────────────────

export type ProjectStatus = "operational" | "degraded" | "down" | "unknown";
export type ProjectType = "website" | "api" | "server" | "database";
export type LogType = "success" | "info" | "warning" | "error";
export type IssueSeverity = "low" | "medium" | "high" | "critical";

export interface ProjectValidation {
  keyword?: string;
  forbiddenKeyword?: string;
  jsonPath?: string;
  jsonExpected?: string;
}

export interface MethodResult {
  status: number | null;
  responseTime: number | null;
  ok: boolean;
  error?: string;
  checkedAt: number;
}

export interface Project {
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
  responseTimeThreshold?: number;
  validation?: ProjectValidation;
  sslDaysLeft?: number | null;
  sslCheckedAt?: number | null;
  methodResults?: Record<string, MethodResult>;
  credentials?: {
    authHeader?: string;
    customHeaders?: Record<string, string>;
    method?: "GET" | "POST" | "HEAD" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
    body?: string;         // raw JSON or text body for POST/PUT/PATCH requests
  };
  // ── Accuracy fields ────────────────────────────────────────────────────
  consecutiveFailures?: number;   // # of consecutive non-operational checks
  responseTimeSamples?: number[]; // last 20 response times for anomaly baseline
  finalUrl?: string;              // resolved URL after following all redirects
  // ── Website metadata ──────────────────────────────────────────────────
  description?: string;           // What this website/service does
  websiteInfo?: WebsiteInfo;      // Rich structured info about the site
  // ── Auto Health Scan result ───────────────────────────────────────────
  lastScanResult?: {
    scannedAt: number;
    overallScore: number;
    website:  { score: number; status: string; httpStatus: number|null; responseTime: number|null; ssl: { valid: boolean; daysLeft: number|null }|null; hasRobots: boolean; hasSitemap: boolean; availability: string; issues: string[] };
    api:      { score: number|null; status: string; discovered: { path: string; status: number|null; responseTime: number; health: string }[]; healthyCount: number; authCount: number; isSpa?: boolean; isSpaWithClientApis?: boolean; notApplicable?: boolean; issues: string[] };
    server:   { score: number; status: string; technology: string; cdn: string|null; ttfb: number; securityHeaders: Record<string,boolean>; issues: string[] };
    database: { score: number; status: string; detected: string[]; stack: string[]; hints: string[]; issues: string[]; confidence?: string };
  };
}

export interface WebsiteInfo {
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
}

export interface LogEntry {
  id: string;
  projectId: string;
  timestamp: number;
  type: LogType;
  message: string;
  statusCode?: number;
  responseTime?: number;
}

export interface Issue {
  id: string;
  projectId: string;
  startedAt: number;
  resolvedAt?: number;
  severity: IssueSeverity;
  message: string;
  status: "open" | "resolved";
}

export interface AppNotification {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: number;
  message: string;
  severity: IssueSeverity;
  read: boolean;
}

export interface AppSettings {
  statusPageTitle?: string;
  emailFrom?: string;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailUser?: string;
  emailPass?: string;
  emailEnabled?: boolean;
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
  supabaseAccessToken?: string;   // Personal access token from supabase.com/dashboard/account/tokens
  supabaseProjectRef?: string;    // e.g. abcdefghijklmn
  supabaseAnonKey?: string;       // Used as Bearer token when calling edge functions
  // ── Branding ───────────────────────────────────────────────────────────
  tileImage?: string;             // Base64 data URL, 256×256 PNG
  favicon?: string;               // Base64 data URL, 32×32 PNG/ICO
}

export interface MaintenanceWindow {
  id: string;
  label: string;
  startIso: string;    // ISO datetime
  endIso: string;
  repeat: "once" | "daily" | "weekly";
}

export interface SavedFilter {
  id: string;
  name: string;
  query: string;       // free-text search string
  type?: "all" | "error" | "warning" | "success" | "info";
  color?: string;
}

// ─── Log Ingest types ─────────────────────────────────────────────────────────

export interface IngestEvent {
  id: string;
  receivedAt: number;
  timestamp: string;
  event: string;
  user_id?: string;
  tenant_id?: string;
  endpoint?: string;
  method?: string;
  status?: string;
  http_status?: number;
  latency_ms?: number;
  source_ip?: string;
  error_code?: string;
  extra?: Record<string, unknown>;
}

export interface EventStats {
  total: number;
  errors: number;
  successRate: number | null;
  latency: { p50: number | null; p75: number | null; p95: number | null; p99: number | null; avg: number | null };
  perUser: { user_id: string; count: number; avg_ms: number | null; p95_ms: number | null; errors: number }[];
  timeSeries: { time: string; count: number; errors: number; avg_ms: number | null; p75_ms: number | null; p95_ms: number | null }[];
  eventTypes: string[];
}
