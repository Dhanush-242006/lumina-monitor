import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  Info,
  Activity,
  Globe,
  Settings,
  Link as LinkIcon,
  FileArchive,
  Upload,
  Search,
  RefreshCcw,
  ArrowRight,
  Code as CodeIcon,
  Sparkles,
  ShieldCheck,
  Zap,
  Terminal,
  Bell,
  Mail,
  Webhook,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Server,
  Database,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ExternalLink,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
  Key,
  LayoutDashboard,
  List,
  X,
  Check,
  Copy,
  MoreVertical,
  Phone,
  MapPin,
  TrendingUp,
  Network,
  FlaskConical,
  Timer,
  BarChart2,
  ScrollText,
  Play,
  Filter,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import JSZip from "jszip";
import axios from "axios";
import { GoogleGenAI, Type } from "@google/genai";

import { INCIDENTS, LATENCY_METRICS } from "./constants";
import {
  StatusType,
  SystemComponent,
  CodeSnippet,
  CodeExplanation,
  AlertRule,
  AlertSeverity,
  Project,
  ProjectStatus,
  ProjectType,
  ProjectValidation,
  MethodResult,
  LogEntry,
  LogType,
  Issue,
  AppNotification,
  AppSettings,
  IngestEvent,
  EventStats,
  WebsiteInfo,
  MaintenanceWindow,
  SavedFilter,
} from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── View Mode ────────────────────────────────────────────────────────────────

type ViewMode =
  | "projects"
  | "project-detail"
  | "add-project"
  | "settings"
  | "console"
  | "supabase"
  | "analytics"
  | "health"
  | "apm"
  | "traces"
  | "service-map"
  | "synthetics"
  | "logs";

type IntakeType = "link" | "zip";

interface AnalysisVersion {
  id: string;
  timestamp: number;
  components: SystemComponent[];
  source: string;
  sourceType: IntakeType;
}

// ai client is created dynamically per-request so the key can be set via Settings UI

// ─── Shared helpers ───────────────────────────────────────────────────────────

const PROJECT_TYPE_META: Record<ProjectType, { icon: React.FC<{ size?: number; className?: string }>; label: string; color: string }> = {
  website: { icon: Globe, label: "Website", color: "text-blue-500" },
  api: { icon: Terminal, label: "API", color: "text-purple-500" },
  server: { icon: Server, label: "Server", color: "text-orange-500" },
  database: { icon: Database, label: "Database", color: "text-emerald-500" },
};

const STATUS_META: Record<ProjectStatus, { color: string; bg: string; border: string; label: string }> = {
  operational: { color: "text-brand", bg: "bg-brand/10", border: "border-brand/20", label: "Operational" },
  degraded: { color: "text-amber-500", bg: "bg-amber-50", border: "border-amber-200", label: "Degraded" },
  down: { color: "text-rose-500", bg: "bg-rose-50", border: "border-rose-200", label: "Down" },
  unknown: { color: "text-gray-400", bg: "bg-gray-50", border: "border-gray-200", label: "Pending" },
};

const LOG_TYPE_META = {
  success: { color: "text-brand", bg: "bg-brand/10", label: "OK" },
  info: { color: "text-blue-500", bg: "bg-blue-50", label: "INFO" },
  warning: { color: "text-amber-500", bg: "bg-amber-50", label: "WARN" },
  error: { color: "text-rose-500", bg: "bg-rose-50", label: "ERROR" },
};

const SEVERITY_META = {
  low: { color: "text-blue-500", bg: "bg-blue-50", border: "border-blue-200" },
  medium: { color: "text-amber-500", bg: "bg-amber-50", border: "border-amber-200" },
  high: { color: "text-orange-500", bg: "bg-orange-50", border: "border-orange-200" },
  critical: { color: "text-rose-500", bg: "bg-rose-50", border: "border-rose-200" },
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

const StatusDot = ({ status, pulse = false }: { status: ProjectStatus; pulse?: boolean }) => {
  const colors: Record<ProjectStatus, string> = {
    operational: "bg-brand",
    degraded: "bg-amber-500",
    down: "bg-rose-500",
    unknown: "bg-gray-300",
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      {pulse && status !== "unknown" && (
        <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-50", colors[status])} />
      )}
      <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", colors[status])} />
    </span>
  );
};

// ─── StatusBadge ──────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: ProjectStatus }) => {
  const m = STATUS_META[status];
  return (
    <span className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border", m.bg, m.color, m.border)}>
      <StatusDot status={status} pulse={status === "down"} />
      {m.label}
    </span>
  );
};

// ─── MiniUptimeBar ────────────────────────────────────────────────────────────

const MiniUptimeBar = ({ history }: { history: number[] }) => (
  <div className="flex gap-[2px] h-5 items-end">
    {(history.length === 0 ? Array(30).fill(-1) : history.slice(-30)).map((val, i) => (
      <div
        key={i}
        className={cn(
          "flex-1 rounded-[1px] transition-all",
          val === 1 ? "h-full bg-brand/70" : val === 0 ? "h-3/4 bg-rose-400" : "h-1/2 bg-gray-200"
        )}
      />
    ))}
  </div>
);

// ─── NotificationToast ────────────────────────────────────────────────────────

const NotificationToast = ({
  notif,
  onClose,
}: {
  key?: React.Key;
  notif: AppNotification;
  onClose: () => void;
}) => {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);

  const m = SEVERITY_META[notif.severity];
  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={cn("flex items-start gap-3 p-4 rounded-xl border shadow-lg bg-white max-w-sm", m.border)}
    >
      <div className={cn("mt-0.5 p-1.5 rounded-lg", m.bg)}>
        <AlertCircle size={14} className={m.color} />
      </div>
      <div className="flex-grow min-w-0">
        <div className={cn("text-[10px] font-black uppercase tracking-widest mb-0.5", m.color)}>
          {notif.severity} alert
        </div>
        <p className="text-xs font-semibold text-text-main leading-snug">{notif.message}</p>
        <p className="text-[10px] text-text-dim mt-0.5">{timeAgo(notif.timestamp)}</p>
      </div>
      <button onClick={onClose} className="text-gray-300 hover:text-gray-500 transition-colors shrink-0">
        <X size={14} />
      </button>
    </motion.div>
  );
};

// ─── AutoHealthScanner ────────────────────────────────────────────────────────

interface ScanResult {
  url: string; origin: string; hostname: string; scannedAt: number; overallScore: number;
  website:  { score: number; status: string; httpStatus: number|null; responseTime: number|null; ssl: { valid: boolean; daysLeft: number|null }|null; hasRobots: boolean; hasSitemap: boolean; mixedContent: boolean; availability: string; issues: string[] };
  api:      { score: number; status: string; discovered: { path: string; status: number|null; responseTime: number; isJson: boolean; health: string }[]; healthyCount: number; authCount: number; avgResponseTime: number|null; issues: string[] };
  server:   { score: number; status: string; technology: string; cdn: string|null; ttfb: number; securityHeaders: Record<string,boolean>; serverBanner: string|null; issues: string[] };
  database: { score: number; status: string; detected: string[]; stack: string[]; exposedPorts: { port: number; service: string }[]; hints: string[]; issues: string[] };
}

const AutoHealthScanner = ({
  url,
  onTypeSelect,
  selectedType,
  onScanResult,
}: {
  url: string;
  onTypeSelect: (t: ProjectType) => void;
  selectedType: ProjectType;
  onScanResult?: (r: ScanResult) => void;
}) => {
  const [scanning, setScanning]   = useState(false);
  const [result, setResult]       = useState<ScanResult | null>(null);
  const [progress, setProgress]   = useState<Record<string, number>>({});
  const [error, setError]         = useState<string | null>(null);
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefRef                = useRef<ReturnType<typeof setInterval> | null>(null);

  const runScan = useCallback(async (target: string) => {
    if (!target || !/^https?:\/\//i.test(target)) return;
    setScanning(true);
    setResult(null);
    setError(null);

    // Animate progress bars independently
    const fakeProgress = (key: string, ms: number) => {
      let val = 0;
      const iv = setInterval(() => {
        val = Math.min(90, val + Math.random() * 12);
        setProgress((p) => ({ ...p, [key]: Math.round(val) }));
      }, ms / 8);
      return iv;
    };
    const ivs = [
      fakeProgress("website",  4000),
      fakeProgress("api",      6000),
      fakeProgress("server",   3000),
      fakeProgress("database", 8000),
    ];

    try {
      const res = await axios.post<ScanResult>("/api/full-scan", { url: target }, { timeout: 35000 });
      ivs.forEach(clearInterval);
      setProgress({ website: 100, api: 100, server: 100, database: 100 });
      setResult(res.data);
      if (onScanResult) onScanResult(res.data);

      // Auto-select the best project type
      const r = res.data;
      if (r.api.healthyCount > 0)                      onTypeSelect("api");
      else if (r.website.availability === "up")         onTypeSelect("website");
      else if (r.server.technology !== "Unknown")       onTypeSelect("server");
      else                                              onTypeSelect("website");
    } catch (e: any) {
      ivs.forEach(clearInterval);
      setProgress({});
      const msg = e.response?.data?.error || e.message || "";
      if (e.code === "ECONNABORTED" || msg.includes("timeout")) {
        setError("Scan timed out — the target URL took too long to respond. Try again.");
      } else if (e.response?.status === 400) {
        setError(e.response.data?.error || "Invalid URL — make sure it starts with https://");
      } else if (e.response?.status >= 500 || msg.includes("Network Error") || msg.includes("ECONNREFUSED")) {
        setError("Cannot reach the Lumina server. Please refresh the page and try again.");
      } else if (msg) {
        setError(`Scan failed — ${msg}`);
      } else {
        setError("Scan failed — check the URL is reachable and try again.");
      }
    } finally {
      setScanning(false);
    }
  }, [onTypeSelect]);

  // Debounce — trigger scan 1.2s after user stops typing
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!url || !/^https?:\/\//i.test(url)) { setResult(null); setError(null); return; }
    timerRef.current = setTimeout(() => runScan(url), 1200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [url, runScan]);

  // Auto-refresh every 5 minutes once a scan exists
  useEffect(() => {
    if (autoRefRef.current) clearInterval(autoRefRef.current);
    if (result) {
      autoRefRef.current = setInterval(() => runScan(url), 5 * 60 * 1000);
    }
    return () => { if (autoRefRef.current) clearInterval(autoRefRef.current); };
  }, [result, url, runScan]);

  const scoreColor = (s: number) =>
    s >= 80 ? "text-brand" : s >= 50 ? "text-amber-500" : "text-rose-500";
  const scoreBg = (s: number) =>
    s >= 80 ? "bg-brand" : s >= 50 ? "bg-amber-400" : "bg-rose-500";
  const statusIcon = (st: string) =>
    st === "healthy"        ? "✅" :
    st === "warning"        ? "⚠️" :
    st === "critical"       ? "❌" :
    st === "not_applicable" ? "—"  :
    st === "spa"            ? "⚡" : "⏳";
  const statusBadge = (st: string) =>
    st === "healthy"        ? "bg-brand/10 text-brand border-brand/20" :
    st === "warning"        ? "bg-amber-50 text-amber-600 border-amber-200" :
    st === "critical"       ? "bg-rose-50 text-rose-600 border-rose-200" :
    st === "not_applicable" ? "bg-gray-100 text-gray-500 border-gray-200" :
    st === "spa"            ? "bg-blue-50 text-blue-600 border-blue-200" :
    "bg-gray-50 text-gray-400 border-gray-200";

  const CARDS: { key: keyof ScanResult & string; label: string; type: ProjectType; icon: React.ReactNode; desc: string }[] = [
    { key: "website",  label: "Website",  type: "website",  icon: <Globe size={14} />,     desc: "HTTP, SSL, uptime, redirects" },
    { key: "api",      label: "API",      type: "api",      icon: <Terminal size={14} />,   desc: "Endpoint discovery & health" },
    { key: "server",   label: "Server",   type: "server",   icon: <Server size={14} />,     desc: "Headers, CDN, security" },
    { key: "database", label: "Database", type: "database", icon: <Database size={14} />,   desc: "Stack & DB detection" },
  ];

  if (!url || !/^https?:\/\//i.test(url)) {
    return (
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Project Type</label>
        <div className="grid grid-cols-4 gap-2">
          {CARDS.map(({ key, label, type, icon }) => (
            <button
              key={key}
              onClick={() => onTypeSelect(type)}
              className={cn(
                "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-[10px] font-black uppercase tracking-wider transition-all",
                selectedType === type ? "bg-text-main text-white border-text-main" : "border-gray-200 text-text-dim hover:border-gray-300"
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-dim mt-2 flex items-center gap-1.5">
          <Zap size={10} className="text-brand" />
          Enter a URL above — all 4 health checks will run automatically
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim">
          Auto Health Scan
        </label>
        {result && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-text-dim">Scanned {timeAgo(result.scannedAt)}</span>
            <button
              onClick={() => runScan(url)}
              disabled={scanning}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black border border-gray-200 text-text-dim hover:border-gray-400 transition-all"
            >
              <RefreshCcw size={8} className={scanning ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 bg-rose-50 border border-rose-200 rounded-xl">
          <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-rose-700">{error}</p>
            {error.includes("Lumina server") && (
              <p className="text-[10px] text-rose-500 mt-1">
                The monitoring server may have restarted. Try refreshing the page.
              </p>
            )}
          </div>
          <button
            onClick={() => { setError(null); runScan(url); }}
            className="shrink-0 flex items-center gap-1 px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-[9px] font-black rounded-lg transition-all"
          >
            <RefreshCcw size={9} /> Retry
          </button>
        </div>
      )}

      {/* Scanning status bar */}
      {scanning && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-xl text-[10px] text-gray-400">
          <RefreshCcw size={11} className="animate-spin text-brand shrink-0" />
          <span>Scanning all components — this takes 10–20 seconds…</span>
        </div>
      )}

      {/* Overall score */}
      {result && !scanning && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 rounded-xl">
          <span className="text-xs text-gray-400 font-bold">Overall</span>
          <div className="flex-1 bg-gray-700 rounded-full h-1.5">
            <div className={cn("h-1.5 rounded-full", scoreBg(result.overallScore))} style={{ width: `${result.overallScore}%` }} />
          </div>
          <span className={cn("text-sm font-black", scoreColor(result.overallScore))}>{result.overallScore}/100</span>
        </div>
      )}

      {/* 4 health cards */}
      <div className="grid grid-cols-2 gap-2">
        {CARDS.map(({ key, label, type, icon, desc }) => {
          const d = result?.[key as keyof ScanResult] as any;
          const isLoading = scanning && !result;
          const pct = progress[key] ?? 0;
          const isSelected = selectedType === type;

          return (
            <button
              key={key}
              onClick={() => onTypeSelect(type)}
              className={cn(
                "text-left p-3 rounded-xl border transition-all space-y-2",
                isSelected ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-gray-200 hover:border-gray-400 bg-white"
              )}
            >
              {/* Card header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-text-dim", isSelected && "text-brand")}>{icon}</span>
                  <span className={cn("text-[10px] font-black uppercase tracking-wider", isSelected ? "text-brand" : "text-text-main")}>
                    {label}
                  </span>
                </div>
                {isLoading ? (
                  <span className="text-[9px] text-gray-400 font-bold flex items-center gap-1">
                    <RefreshCcw size={8} className="animate-spin" /> {pct}%
                  </span>
                ) : d ? (
                  <span className={cn("text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border", statusBadge(d.status))}>
                    {statusIcon(d.status)} {d.status}
                  </span>
                ) : null}
              </div>

              {/* Progress bar while scanning */}
              {isLoading && (
                <div className="w-full bg-gray-100 rounded-full h-1">
                  <div
                    className="h-1 rounded-full bg-brand transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {/* Not applicable — pure CMS/static site */}
              {d && !isLoading && (d as any).notApplicable && (
                <div className="flex flex-col items-center justify-center py-3 gap-1.5 text-center">
                  <span className="text-lg">—</span>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Not needed</p>
                  <p className="text-[9px] text-text-dim leading-tight">No API layer detected for this website</p>
                </div>
              )}

              {/* SPA with client-side APIs */}
              {d && !isLoading && !((d as any).notApplicable) && (d as any).isSpaWithClientApis && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${d.score ?? 75}%` }} />
                    </div>
                    <span className="text-xs font-black tabular-nums text-blue-500">{d.score ?? 75}</span>
                  </div>
                  <p className="text-[9px] text-blue-600 font-bold">⚡ SPA — APIs called client-side</p>
                  <p className="text-[9px] text-text-dim">Database clients run in the browser (Supabase, Firebase, etc.)</p>
                </div>
              )}

              {/* Score + key fact when done */}
              {d && !isLoading && !(d as any).notApplicable && !(d as any).isSpaWithClientApis && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className={cn("h-1.5 rounded-full", scoreBg(d.score ?? 0))} style={{ width: `${d.score ?? 0}%` }} />
                    </div>
                    <span className={cn("text-xs font-black tabular-nums", scoreColor(d.score ?? 0))}>{d.score ?? "—"}</span>
                  </div>

                  {/* Card-specific quick facts */}
                  <div className="space-y-0.5">
                    {key === "website" && (
                      <>
                        <p className="text-[9px] text-text-dim">
                          HTTP {d.httpStatus ?? "—"} · {d.responseTime ?? "—"}ms
                          {d.ssl ? (d.ssl.valid ? ` · SSL ${d.ssl.daysLeft}d` : " · SSL ❌") : " · No HTTPS"}
                        </p>
                        <p className="text-[9px] text-text-dim">
                          {d.hasRobots ? "✓ robots.txt" : "✗ robots.txt"} · {d.hasSitemap ? "✓ sitemap" : "✗ sitemap"}
                        </p>
                      </>
                    )}
                    {key === "api" && (
                      <div className="space-y-0.5">
                        {d.discovered.length > 0 ? (
                          <p className="text-[9px] text-text-dim">
                            {d.discovered.length} real endpoint{d.discovered.length !== 1 ? "s" : ""} found
                            {d.healthyCount > 0 ? ` · ${d.healthyCount} healthy` : ""}
                            {d.authCount > 0 ? ` · ${d.authCount} need auth` : ""}
                          </p>
                        ) : (
                          <p className="text-[9px] text-text-dim">No real API endpoints found</p>
                        )}
                        {(d as any).fallbackCount > 0 && (
                          <p className="text-[9px] text-amber-600">
                            ⚠ {(d as any).fallbackCount} paths return HTML (CMS fallback)
                          </p>
                        )}
                      </div>
                    )}
                    {key === "server" && (
                      <>
                        <p className="text-[9px] text-text-dim">
                          {d.technology} {d.cdn ? `· CDN: ${d.cdn}` : ""} · TTFB {d.ttfb}ms
                        </p>
                        <p className="text-[9px] text-text-dim">
                          {Object.values(d.securityHeaders).filter(Boolean).length}/6 security headers
                        </p>
                      </>
                    )}
                    {key === "database" && (
                      <div className="space-y-0.5">
                        <p className="text-[9px] text-text-dim">
                          {d.detected.length > 0
                            ? d.detected.slice(0, 2).join(", ")
                            : "No DB signals found"}
                          {d.stack.length > 0 ? ` · ${d.stack[0]}` : ""}
                          {d.exposedPorts.length > 0
                            ? ` · ⚠ ${d.exposedPorts.length} exposed port(s)`
                            : ""}
                        </p>
                        {(d as any).confidence && (
                          <p className="text-[9px]">
                            <span className={cn("font-bold",
                              (d as any).confidence === "high"   ? "text-brand" :
                              (d as any).confidence === "medium" ? "text-amber-500" :
                              "text-gray-400"
                            )}>
                              {(d as any).confidence === "high"   ? "✓ High confidence" :
                               (d as any).confidence === "medium" ? "~ Medium confidence" :
                               "? Low confidence"}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                    {(d.issues as string[]).slice(0, 1).map((issue: string, i: number) => (
                      <p key={i} className="text-[9px] text-amber-600 truncate">⚠ {issue}</p>
                    ))}
                  </div>
                </>
              )}

              {/* Idle state */}
              {!d && !isLoading && (
                <p className="text-[9px] text-text-dim">{desc}</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded findings */}
      {result && !scanning && (
        <details className="group">
          <summary className="text-[10px] font-black uppercase tracking-wider text-text-dim cursor-pointer hover:text-text-main select-none flex items-center gap-1.5">
            <ChevronDown size={11} className="group-open:rotate-180 transition-transform" /> Detailed findings
          </summary>
          <div className="mt-2 space-y-2">
            {CARDS.map(({ key, label }) => {
              const d = result[key as keyof ScanResult] as any;
              const allIssues: string[] = d.issues || [];
              if (key === "api") d.discovered?.forEach((ep: any) => {
                if (ep.health === "ok") allIssues.unshift(`✓ ${ep.path} → HTTP ${ep.status} (${ep.responseTime}ms${ep.isJson ? ", JSON" : ""})`);
              });
              if (key === "database") d.hints?.forEach((h: string) => allIssues.push(`ℹ ${h}`));
              if (key === "server") {
                const sec = d.securityHeaders as Record<string, boolean>;
                Object.entries(sec).filter(([, v]) => v).forEach(([k]) => allIssues.unshift(`✓ ${k}`));
              }
              if (!allIssues.length) return null;
              return (
                <div key={key} className="bg-gray-50 rounded-xl p-3 space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-wider text-text-dim">{label}</p>
                  {allIssues.slice(0, 8).map((issue, i) => (
                    <p key={i} className={cn("text-[10px] leading-tight",
                      issue.startsWith("✓") ? "text-brand" :
                      issue.startsWith("ℹ") ? "text-blue-600" :
                      "text-amber-700"
                    )}>{issue}</p>
                  ))}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
};

// ─── AddProjectModal ──────────────────────────────────────────────────────────

const AddProjectModal = ({
  onClose,
  onSave,
  onAddCompanion,
  initial,
}: {
  onClose: () => void;
  onSave: (p: Partial<Project>) => Promise<void>;
  onAddCompanion?: (p: Partial<Project>) => Promise<void>;
  initial?: Project;
}) => {
  const [name, setName] = useState(initial?.name || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [type, setType] = useState<ProjectType>(initial?.type || "website");
  const [interval, setInterval] = useState(initial?.checkInterval || 5);
  const [notifyEmail, setNotifyEmail] = useState(initial?.notifyEmail || "");
  const [authHeader, setAuthHeader] = useState(initial?.credentials?.authHeader || "");
  const [method, setMethod] = useState<"GET" | "POST" | "HEAD" | "PUT" | "PATCH" | "DELETE" | "OPTIONS">(initial?.credentials?.method || "GET");
  const [requestBody, setRequestBody] = useState(initial?.credentials?.body || "");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [threshold, setThreshold] = useState(initial?.responseTimeThreshold || 3000);
  const [keyword, setKeyword] = useState(initial?.validation?.keyword || "");
  const [forbiddenKeyword, setForbiddenKeyword] = useState(initial?.validation?.forbiddenKeyword || "");
  const [jsonPath, setJsonPath] = useState(initial?.validation?.jsonPath || "");
  const [jsonExpected, setJsonExpected] = useState(initial?.validation?.jsonExpected || "");
  const [showAuth, setShowAuth] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Response Body Preview ──
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    statusCode: number | null;
    textBody: string;
    rawBody: string;
    contentType: string;
    isJson: boolean;
    bodyLength: number;
    error?: string;
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<"text" | "raw">("text");
  const [selectedText, setSelectedText] = useState("");

  // ── SPA companion-project options ──
  type ApiProvider = "groq" | "gemini" | "openai" | "anthropic" | "custom";
  const [apiProvider, setApiProvider] = useState<ApiProvider>("groq");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState("");
  const [option1Added, setOption1Added] = useState(false);
  const [option2Added, setOption2Added] = useState(false);
  const [healthCodeTab, setHealthCodeTab] = useState<"pages" | "app" | "express">("pages");
  const [companionSaving, setCompanionSaving] = useState<1 | 2 | null>(null);

  // Provider configs
  const PROVIDER_META: Record<ApiProvider, {
    label: string;
    healthUrl: (key: string) => string;
    authHeader: (key: string) => string | null;
    keyword: string;
    envVar: string;
    fetchCode: (envVar: string) => string;
    placeholder: string;
    color: string;
  }> = {
    groq: {
      label: "Groq",
      healthUrl: () => "https://api.groq.com/openai/v1/models",
      authHeader: (k) => `Bearer ${k}`,
      keyword: '"data"',
      envVar: "GROQ_API_KEY",
      placeholder: "gsk_...",
      color: "text-orange-500",
      fetchCode: (v) => `fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: \`Bearer \${${v}}\` } })`,
    },
    gemini: {
      label: "Gemini",
      healthUrl: (k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
      authHeader: () => null,
      keyword: '"models"',
      envVar: "GEMINI_API_KEY",
      placeholder: "AIza...",
      color: "text-blue-500",
      fetchCode: (v) => `fetch(\`https://generativelanguage.googleapis.com/v1beta/models?key=\${${v}}\`)`,
    },
    openai: {
      label: "OpenAI",
      healthUrl: () => "https://api.openai.com/v1/models",
      authHeader: (k) => `Bearer ${k}`,
      keyword: '"data"',
      envVar: "OPENAI_API_KEY",
      placeholder: "sk-...",
      color: "text-green-600",
      fetchCode: (v) => `fetch("https://api.openai.com/v1/models", { headers: { Authorization: \`Bearer \${${v}}\` } })`,
    },
    anthropic: {
      label: "Anthropic",
      healthUrl: () => "https://api.anthropic.com/v1/models",
      authHeader: (k) => `x-api-key: ${k}`,
      keyword: '"data"',
      envVar: "ANTHROPIC_API_KEY",
      placeholder: "sk-ant-...",
      color: "text-purple-500",
      fetchCode: (v) => `fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": ${v}, "anthropic-version": "2023-06-01" } })`,
    },
    custom: {
      label: "Custom",
      healthUrl: (_k) => customApiUrl,
      authHeader: (k) => k ? `Bearer ${k}` : null,
      keyword: "",
      envVar: "API_KEY",
      placeholder: "your-api-key",
      color: "text-gray-500",
      fetchCode: (v) => `fetch(process.env.HEALTH_URL || "", { headers: { Authorization: \`Bearer \${${v}}\` } })`,
    },
  };

  const pm = PROVIDER_META[apiProvider];

  const makeHealthCode = (framework: "pages" | "app" | "express"): string => {
    const ev = pm.envVar;
    const fetchLine = pm.fetchCode(ev);
    const isBearer = apiProvider !== "gemini";
    const authLines = apiProvider === "anthropic"
      ? `    const r = await ${fetchLine.replace("fetch(", "fetch(")};\n`
      : `    const r = await ${fetchLine};\n`;

    if (framework === "pages") return `// pages/api/health.js  (Next.js Pages Router / Vercel)
export default async function handler(req, res) {
  const key = process.env.${ev};
  if (!key) return res.status(503).json({ status: "error", reason: "API key not set" });
  try {
    const r = await ${fetchLine};
    if (!r.ok) return res.status(503).json({ status: "error", code: r.status });
    res.json({ status: "ok", provider: "${apiProvider}", ts: Date.now() });
  } catch (e) {
    res.status(503).json({ status: "error", message: e.message });
  }
}`;
    if (framework === "app") return `// app/api/health/route.js  (Next.js App Router / Vercel)
export async function GET() {
  const key = process.env.${ev};
  if (!key)
    return Response.json({ status: "error", reason: "API key not set" }, { status: 503 });
  try {
    const r = await ${fetchLine};
    if (!r.ok)
      return Response.json({ status: "error", code: r.status }, { status: 503 });
    return Response.json({ status: "ok", provider: "${apiProvider}", ts: Date.now() });
  } catch (e) {
    return Response.json({ status: "error", message: e.message }, { status: 503 });
  }
}`;
    return `// Express.js  (Node backend)
app.get('/api/health', async (req, res) => {
  const key = process.env.${ev};
  if (!key) return res.status(503).json({ status: 'error', reason: 'API key not set' });
  try {
    const r = await ${fetchLine};
    if (!r.ok) return res.status(503).json({ status: 'error', code: r.status });
    res.json({ status: 'ok', provider: '${apiProvider}', ts: Date.now() });
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});`;
  };

  const handleAddApiMonitor = async () => {
    if (!apiKeyInput.trim() || !onAddCompanion) return;
    setCompanionSaving(1);
    const healthUrl = pm.healthUrl(apiKeyInput.trim());
    const authHdr = pm.authHeader(apiKeyInput.trim());
    await onAddCompanion({
      name: `${name.trim() || "SPA"} — ${pm.label} API`,
      url: healthUrl,
      type: "api",
      checkInterval: interval,
      notifyEmail: notifyEmail.trim() || undefined,
      validation: pm.keyword ? { keyword: pm.keyword } : undefined,
      credentials: authHdr ? { authHeader: authHdr } : undefined,
    });
    setOption1Added(true);
    setCompanionSaving(null);
  };

  const handleAddHealthMonitor = async () => {
    if (!url.trim() || !onAddCompanion) return;
    setCompanionSaving(2);
    let healthUrl = "/api/health";
    try { healthUrl = new URL(url.trim()).origin + "/api/health"; } catch {}
    await onAddCompanion({
      name: `${name.trim() || "SPA"} — Health Endpoint`,
      url: healthUrl,
      type: "api",
      checkInterval: interval,
      notifyEmail: notifyEmail.trim() || undefined,
      validation: { keyword: '"ok"' },
    });
    setOption2Added(true);
    setCompanionSaving(null);
  };

  const fetchPreview = async () => {
    if (!url.trim()) return;
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const res = await axios.post("/api/preview", {
        url: url.trim(),
        method: method || "GET",
        authHeader: authHeader.trim() || undefined,
      });
      setPreviewData(res.data);
    } catch {
      setPreviewData({ statusCode: null, textBody: "", rawBody: "", contentType: "", isJson: false, bodyLength: 0, error: "Failed to fetch preview" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const validateUrl = (val: string, forType?: ProjectType) => {
    const t = forType ?? type;
    if (!val) { setUrlError(""); return; }

    // Database: accept any format — mysql://host:port, host:port, etc.
    if (t === "database") {
      setUrlError(val.trim().length < 3 ? "Enter a valid host or connection string" : "");
      return;
    }

    // Server: accept http/https OR host:port OR protocol://host:port
    if (t === "server") {
      if (/^https?:\/\//i.test(val)) {
        try { new URL(val); setUrlError(""); } catch { setUrlError("Invalid URL format"); }
      } else {
        // Allow host:port, ip:port, or any other format
        setUrlError("");
      }
      return;
    }

    // Website / API: must be http:// or https://
    if (!/^https?:\/\//i.test(val)) { setUrlError("Must start with http:// or https://"); return; }
    try { new URL(val); setUrlError(""); } catch { setUrlError("Invalid URL format"); }
  };

  const handleSave = async () => {
    if (!name.trim() || !url.trim() || urlError) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      url: url.trim(),
      type,
      checkInterval: interval,
      notifyEmail: notifyEmail.trim() || undefined,
      responseTimeThreshold: threshold !== 3000 ? threshold : undefined,
      validation: keyword.trim() || forbiddenKeyword.trim() || jsonPath.trim()
        ? {
            keyword: keyword.trim() || undefined,
            forbiddenKeyword: forbiddenKeyword.trim() || undefined,
            jsonPath: jsonPath.trim() || undefined,
            jsonExpected: jsonExpected.trim() || undefined,
          }
        : undefined,
      credentials: (authHeader.trim() || method !== "GET" || requestBody.trim()) && type !== "database"
        ? {
            authHeader: authHeader.trim() || undefined,
            method,
            body: requestBody.trim() || undefined,
          }
        : authHeader.trim()
        ? { authHeader: authHeader.trim() }
        : undefined,
      ...(scanResult ? { lastScanResult: {
        scannedAt:    scanResult.scannedAt,
        overallScore: scanResult.overallScore,
        website:      scanResult.website,
        api:          scanResult.api,
        server:       scanResult.server,
        database:     scanResult.database,
      } } : {}),
    });
    setSaving(false);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-8 pt-8 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight">{initial ? "Edit Project" : "Add Project"}</h2>
            <p className="text-xs text-text-dim mt-0.5">Configure monitoring for your service</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Project Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Website"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
              URL / Address to Monitor
            </label>
            <input
              value={url}
              onChange={(e) => { setUrl(e.target.value); validateUrl(e.target.value); }}
              placeholder={
                type === "database"
                  ? "https://db.example.com/health  or  mysql://host:3306"
                  : type === "server"
                  ? "https://server.example.com  or  192.168.1.1:22"
                  : type === "api"
                  ? "https://api.example.com/health"
                  : "https://example.com"
              }
              className={cn(
                "w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors",
                urlError ? "border-rose-400 focus:ring-rose-200" : "border-gray-200 focus:ring-brand focus:border-brand"
              )}
            />
            {urlError && <p className="text-[10px] text-rose-500 font-bold mt-1">{urlError}</p>}
            {!urlError && (
              <p className="text-[10px] text-text-dim mt-1.5 flex items-center gap-1.5">
                <span className="text-brand font-bold">http/https</span> → full HTTP check for <em>any</em> project type ·
                <span className="font-mono text-gray-500">host:port</span> or <span className="font-mono text-gray-500">mysql://...</span> → TCP check
              </p>
            )}
          </div>

          {/* ── Auto Health Scanner ─────────────────────────────────────────── */}
          <AutoHealthScanner url={url} onTypeSelect={(t) => { setType(t); }} selectedType={type} onScanResult={(r) => setScanResult(r)} />

          {/* Check Interval */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
              Check Interval
            </label>
            <div className="grid grid-cols-5 gap-2">
              {[1, 5, 15, 30, 60].map((min) => (
                <button
                  key={min}
                  onClick={() => setInterval(min)}
                  className={cn(
                    "py-2.5 rounded-xl border text-xs font-black uppercase tracking-wider transition-all",
                    interval === min ? "bg-brand text-black border-brand" : "border-gray-200 text-text-dim hover:border-gray-300"
                  )}
                >
                  {min < 60 ? `${min}m` : "1h"}
                </button>
              ))}
            </div>
          </div>

          {/* HTTP Method — hidden for database (uses TCP, not HTTP) */}
          {type !== "database" && !(type === "server" && url && !/^https?:\/\//i.test(url)) && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
                HTTP Method
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE"] as const).map((m) => {
                  const hints: Record<string, string> = {
                    GET: "Fetch page/data",
                    POST: "Send data to API",
                    HEAD: "Fast uptime check",
                    PUT: "Update resource",
                    PATCH: "Partial update",
                    DELETE: "Delete resource",
                  };
                  return (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      title={hints[m]}
                      className={cn(
                        "py-2.5 rounded-xl border text-xs font-black font-mono tracking-wider transition-all",
                        method === m ? "bg-brand text-black border-brand" : "border-gray-200 text-text-dim hover:border-gray-300"
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-text-dim mt-1.5">
                {method === "HEAD" ? "HEAD sends no body — fastest uptime check, no content validation." :
                 method === "POST" ? "POST sends a request body — ideal for API endpoints that require it." :
                 method === "DELETE" ? "DELETE checks if the endpoint accepts delete requests." :
                 method === "PATCH" ? "PATCH checks if the endpoint accepts partial update requests." :
                 method === "PUT" ? "PUT checks if the endpoint accepts full update requests." :
                 "GET fetches the full page or API response — best for content validation."}
              </p>
            </div>
          )}
          {type === "database" && (
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <Database size={14} className="text-emerald-600 flex-shrink-0" />
              <p className="text-[11px] text-emerald-700 font-medium">
                Database monitoring uses TCP port check — no HTTP method needed.
              </p>
            </div>
          )}
          {type === "server" && url && !/^https?:\/\//i.test(url) && (
            <div className="flex items-center gap-2 px-4 py-3 bg-orange-50 rounded-xl border border-orange-200">
              <Server size={14} className="text-orange-600 flex-shrink-0" />
              <p className="text-[11px] text-orange-700 font-medium">
                Non-HTTP server address detected — using TCP port check.
              </p>
            </div>
          )}

          {/* Email Notification */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
              Alert Email (optional)
            </label>
            <div className="relative">
              <Mail size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="you@company.com"
                type="email"
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
              />
            </div>
          </div>

          {/* Advanced: threshold + body validation */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-text-dim hover:text-text-main transition-colors"
            >
              <Zap size={12} />
              {showAdvanced ? "Hide" : "Show"} Advanced Checks
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                {/* Response time threshold */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
                    Response Time Threshold (ms)
                  </label>
                  <div className="flex gap-2">
                    {[500, 1000, 2000, 3000, 5000].map((ms) => (
                      <button
                        key={ms}
                        onClick={() => setThreshold(ms)}
                        className={cn(
                          "flex-1 py-2 rounded-xl border text-[10px] font-black font-mono transition-all",
                          threshold === ms ? "bg-brand text-black border-brand" : "border-gray-200 text-text-dim hover:border-gray-300 bg-white"
                        )}
                      >
                        {ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-dim mt-1.5">Mark as Degraded if response takes longer than this.</p>
                </div>

                {/* Body keyword — must contain */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
                    Response Must Contain
                  </label>
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder='e.g. "status":"ok" or healthy'
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <p className="text-[10px] text-text-dim mt-1">Flag as Degraded if this text is missing from the response.</p>
                </div>

                {/* Forbidden keyword — must NOT contain */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2 flex items-center gap-2">
                    <span className="text-rose-500">✕</span> Response Must NOT Contain
                  </label>
                  <input
                    value={forbiddenKeyword}
                    onChange={(e) => setForbiddenKeyword(e.target.value)}
                    placeholder='e.g. System Error  or  API key not valid'
                    className="w-full px-4 py-2.5 border border-rose-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 placeholder:text-rose-300"
                  />
                  <p className="text-[10px] text-text-dim mt-1">Flag as Degraded if this error text appears in the response — even if HTTP returns 200.</p>
                </div>

                {/* JSON path check */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">JSON Path</label>
                    <input
                      value={jsonPath}
                      onChange={(e) => setJsonPath(e.target.value)}
                      placeholder="e.g. status or data.health"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Expected Value</label>
                    <input
                      value={jsonExpected}
                      onChange={(e) => setJsonExpected(e.target.value)}
                      placeholder='e.g. "ok" or true'
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-text-dim">Checks that <code>response.body.jsonPath === expectedValue</code>.</p>

                {/* ── Response Body Preview ──────────────────────────────── */}
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-text-dim flex items-center gap-1.5">
                      <Search size={10} /> Live Response Preview
                    </label>
                    <button
                      type="button"
                      onClick={fetchPreview}
                      disabled={previewLoading || !url.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-blue-100 transition-colors disabled:opacity-40"
                    >
                      {previewLoading ? <RefreshCcw size={10} className="animate-spin" /> : <Activity size={10} />}
                      {previewLoading ? "Fetching…" : "Fetch Response"}
                    </button>
                  </div>
                  <p className="text-[10px] text-text-dim mb-3">
                    Fetch the URL right now and inspect what the response contains — then select any text to auto-fill validation rules.
                  </p>

                  {previewData && (
                    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                      {/* Status bar */}
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          {previewData.error ? (
                            <span className="text-[10px] font-bold text-rose-500">{previewData.error}</span>
                          ) : (
                            <>
                              <span className={cn(
                                "text-[10px] font-black px-2 py-0.5 rounded-full",
                                (previewData.statusCode ?? 0) >= 500 ? "bg-rose-100 text-rose-600" :
                                (previewData.statusCode ?? 0) >= 400 ? "bg-amber-100 text-amber-600" :
                                "bg-green-100 text-green-600"
                              )}>
                                HTTP {previewData.statusCode}
                              </span>
                              <span className="text-[10px] text-text-dim font-mono">{previewData.contentType.split(";")[0]}</span>
                              <span className="text-[10px] text-text-dim">{(previewData.bodyLength / 1024).toFixed(1)}KB</span>
                            </>
                          )}
                        </div>
                        {!previewData.error && (
                          <div className="flex gap-1">
                            <button onClick={() => setPreviewMode("text")} className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded transition-colors", previewMode === "text" ? "bg-text-main text-white" : "text-text-dim hover:bg-gray-100")}>Text</button>
                            <button onClick={() => setPreviewMode("raw")} className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded transition-colors", previewMode === "raw" ? "bg-text-main text-white" : "text-text-dim hover:bg-gray-100")}>Raw</button>
                          </div>
                        )}
                      </div>

                      {!previewData.error && (() => {
                        // Detect Single-Page App (SPA): tiny body with just a root div and no real content
                        const isSpa = previewData.bodyLength < 2000 &&
                          previewData.rawBody.includes('<div id="root">') &&
                          (previewData.textBody.trim().length < 100);

                        if (isSpa) {
                          const origin = (() => { try { return new URL(url).origin; } catch { return url; } })();
                          return (
                            <div className="p-4 space-y-3">
                              {/* SPA warning */}
                              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                <div className="text-[11px] text-amber-800">
                                  <p className="font-bold mb-0.5">This is a Single-Page App (SPA)</p>
                                  <p>Content renders in the browser via JS — the monitor only sees the empty HTML shell. Use one of the options below to detect real errors.</p>
                                </div>
                              </div>

                              {/* ── Option 1: Monitor API directly ── */}
                              <div className={cn("border rounded-xl p-3 space-y-2 transition-all", option1Added ? "bg-green-50 border-green-200" : "bg-white border-gray-200")}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-black uppercase tracking-widest bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex-shrink-0">Option 1</span>
                                  <p className="text-[11px] font-bold text-text-main">Monitor the API directly</p>
                                </div>

                                {/* API Provider selector */}
                                <div className="grid grid-cols-5 gap-1">
                                  {(["groq", "gemini", "openai", "anthropic", "custom"] as ApiProvider[]).map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={() => { setApiProvider(p); setApiKeyInput(""); setOption1Added(false); }}
                                      className={cn(
                                        "py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-wide transition-all",
                                        apiProvider === p ? "bg-text-main text-white border-text-main" : "border-gray-200 text-text-dim hover:border-gray-300"
                                      )}
                                    >
                                      {PROVIDER_META[p].label}
                                    </button>
                                  ))}
                                </div>

                                {option1Added ? (
                                  <div className="flex items-center gap-2 text-[11px] text-green-700 font-bold pt-1">
                                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                                    <span>Created: <span className="font-mono">"{name || "SPA"} — {pm.label} API"</span> monitor added ✓</span>
                                  </div>
                                ) : (
                                  <>
                                    {apiProvider === "custom" && (
                                      <input
                                        value={customApiUrl}
                                        onChange={(e) => setCustomApiUrl(e.target.value)}
                                        placeholder="https://your-api.com/v1/models"
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-brand bg-gray-50"
                                      />
                                    )}
                                    <div className="flex gap-2">
                                      <div className="relative flex-1">
                                        <Key size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                          type={showApiKeyInput ? "text" : "password"}
                                          value={apiKeyInput}
                                          onChange={(e) => setApiKeyInput(e.target.value)}
                                          placeholder={`${pm.label} API key  (${pm.placeholder})`}
                                          className="w-full pl-8 pr-8 py-2 border border-gray-200 rounded-xl text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-brand bg-gray-50"
                                        />
                                        <button type="button" onClick={() => setShowApiKeyInput(!showApiKeyInput)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                          {showApiKeyInput ? <EyeOff size={11} /> : <Eye size={11} />}
                                        </button>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={handleAddApiMonitor}
                                        disabled={!apiKeyInput.trim() || (apiProvider === "custom" && !customApiUrl.trim()) || !onAddCompanion || companionSaving === 1}
                                        className="px-3 py-2 bg-green-500 text-white text-[10px] font-black uppercase tracking-wider rounded-xl hover:bg-green-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                                      >
                                        {companionSaving === 1 ? <RefreshCcw size={10} className="animate-spin" /> : <Plus size={10} />}
                                        Add Monitor
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-text-dim">
                                      Checks <span className="font-mono text-blue-600 break-all">{pm.healthUrl("••••")}</span>
                                      {pm.keyword && <> — expects <code className="bg-gray-100 px-1 rounded">{pm.keyword}</code> in response</>}
                                    </p>
                                  </>
                                )}
                              </div>

                              {/* ── Option 2: Health endpoint ── */}
                              <div className={cn("border rounded-xl p-3 space-y-2 transition-all", option2Added ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200")}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Option 2</span>
                                  <p className="text-[11px] font-bold text-text-main">Add <code>/api/health</code> to your site</p>
                                </div>
                                <p className="text-[10px] text-text-dim">
                                  Copy this code into your project — it tests your <strong>{pm.envVar}</strong> and returns <code className="bg-gray-100 px-1 rounded">{`{"status":"ok"}`}</code>.
                                  {apiProvider !== "groq" && (
                                    <button type="button" onClick={() => setApiProvider("groq")} className="ml-1 text-blue-500 underline text-[10px]">Switch to Groq</button>
                                  )}
                                </p>

                                <div className="rounded-xl overflow-hidden border border-gray-200">
                                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800">
                                    <div className="flex gap-1">
                                      {(["pages", "app", "express"] as const).map((t) => (
                                        <button key={t} type="button" onClick={() => setHealthCodeTab(t)}
                                          className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded transition-colors", healthCodeTab === t ? "bg-gray-600 text-white" : "text-gray-400 hover:text-gray-200")}
                                        >
                                          {t === "pages" ? "Next.js Pages" : t === "app" ? "Next.js App" : "Express"}
                                        </button>
                                      ))}
                                    </div>
                                    <button type="button" onClick={() => navigator.clipboard?.writeText(makeHealthCode(healthCodeTab))}
                                      className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-gray-200 transition-colors"
                                    >
                                      <Copy size={10} /> Copy
                                    </button>
                                  </div>
                                  <pre className="text-[10px] text-green-300 bg-gray-900 p-3 overflow-x-auto leading-relaxed max-h-44 font-mono">
                                    {makeHealthCode(healthCodeTab)}
                                  </pre>
                                </div>

                                {option2Added ? (
                                  <div className="flex items-center gap-2 text-[11px] text-blue-700 font-bold pt-1">
                                    <CheckCircle2 size={14} className="text-blue-500 flex-shrink-0" />
                                    <span>Created: <span className="font-mono">"{name || "SPA"} — Health Endpoint"</span> ✓ — will check once you deploy.</span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                      <code className="text-[11px] text-blue-600 font-mono flex-1 truncate">{origin}/api/health</code>
                                      <button type="button" onClick={() => navigator.clipboard?.writeText(origin + "/api/health")} className="p-1 hover:bg-gray-200 rounded transition-colors">
                                        <Copy size={10} className="text-gray-400" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={handleAddHealthMonitor}
                                      disabled={!onAddCompanion || companionSaving === 2}
                                      className="w-full py-2 bg-blue-500 text-white text-[10px] font-black uppercase tracking-wider rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                    >
                                      {companionSaving === 2 ? <RefreshCcw size={10} className="animate-spin" /> : <Plus size={10} />}
                                      Add /api/health Monitor
                                    </button>
                                    <p className="text-[10px] text-text-dim">
                                      Set <code className="bg-gray-100 px-1 rounded">{pm.envVar}</code> in your environment variables. Monitor checks <code className="bg-gray-100 px-1 rounded">{origin}/api/health</code> and flags Degraded if <code className="bg-gray-100 px-1 rounded">status</code> ≠ <code className="bg-gray-100 px-1 rounded">ok</code>.
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // Normal response — show body with select-to-set-rule
                        return (
                          <>
                            <pre
                              className="text-[11px] p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-gray-700 font-mono leading-relaxed select-text cursor-text"
                              onMouseUp={() => {
                                const sel = window.getSelection()?.toString().trim();
                                if (sel && sel.length > 1) setSelectedText(sel);
                              }}
                            >
                              {previewMode === "text" ? (previewData.textBody || "(empty response body)") : previewData.rawBody}
                            </pre>

                            {selectedText && (
                              <div className="border-t border-gray-200 px-3 py-2 bg-blue-50 flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-blue-700 font-medium flex-shrink-0">
                                  Selected: <span className="font-mono font-bold">"{selectedText.slice(0, 40)}{selectedText.length > 40 ? "…" : ""}"</span>
                                </span>
                                <button
                                  onClick={() => { setKeyword(selectedText); setSelectedText(""); }}
                                  className="px-2.5 py-1 bg-green-500 text-white text-[9px] font-black uppercase rounded-lg hover:bg-green-600 transition-colors"
                                >
                                  ✓ Must Contain
                                </button>
                                <button
                                  onClick={() => { setForbiddenKeyword(selectedText); setSelectedText(""); }}
                                  className="px-2.5 py-1 bg-rose-500 text-white text-[9px] font-black uppercase rounded-lg hover:bg-rose-600 transition-colors"
                                >
                                  ✕ Must NOT Contain
                                </button>
                                <button onClick={() => setSelectedText("")} className="ml-auto text-[9px] text-blue-400 hover:text-blue-600">Clear</button>
                              </div>
                            )}
                            {!selectedText && (
                              <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
                                <p className="text-[10px] text-text-dim">💡 <strong>Select any text</strong> above to instantly set it as a "Must Contain" or "Must NOT Contain" rule.</p>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Auth / Permissions */}
          <div>
            <button
              onClick={() => setShowAuth(!showAuth)}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-text-dim hover:text-text-main transition-colors"
            >
              <Key size={12} />
              {showAuth ? "Hide" : "Show"} Authentication
              {showAuth ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showAuth && (
              <div className="mt-3 space-y-4">
                {/* Authorization header */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
                    Authorization Header
                  </label>
                  <input
                    value={authHeader}
                    onChange={(e) => setAuthHeader(e.target.value)}
                    placeholder='Bearer your-api-token'
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
                  />
                  <p className="text-[10px] text-text-dim mt-1.5">
                    This will be sent as the Authorization header on every check request.
                  </p>
                </div>

                {/* Request body — for POST/PUT/PATCH functional testing */}
                {["POST", "PUT", "PATCH"].includes(method) && (
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
                      Request Body <span className="normal-case font-normal text-text-dim">(JSON or plain text)</span>
                    </label>
                    <textarea
                      value={requestBody}
                      onChange={(e) => setRequestBody(e.target.value)}
                      rows={4}
                      placeholder={'{\n  "username": "test@example.com",\n  "action": "ping"\n}'}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand resize-y"
                    />
                    <p className="text-[10px] text-text-dim mt-1.5">
                      Sent as the request body on every check. Use this to test form submissions, login endpoints, or API actions — Lumina will flag <code className="bg-gray-100 px-1 rounded">success:false</code>, <code className="bg-gray-100 px-1 rounded">error</code> fields, and processing failures automatically.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-8 pb-8 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3.5 border border-gray-200 text-sm font-bold rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !url.trim() || !!urlError}
            className="flex-1 py-3.5 bg-text-main text-white text-sm font-black rounded-xl hover:bg-brand hover:text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <RefreshCcw size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? "Saving..." : initial ? "Save Changes" : "Add Project"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─── ProjectCard ──────────────────────────────────────────────────────────────

const ProjectCard = ({
  project,
  onClick,
  onDelete,
  onEdit,
  onToggle,
  onCheck,
}: {
  key?: React.Key;
  project: Project;
  onClick: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onCheck: () => Promise<void>;
}) => {
  const m = STATUS_META[project.status];
  const tm = PROJECT_TYPE_META[project.type];
  const TypeIcon = tm.icon;
  const [menuOpen, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    await onCheck();
    setChecking(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-white border rounded-2xl p-5 cursor-pointer hover:shadow-lg transition-all group relative",
        project.status === "down"
          ? "border-rose-200 ring-1 ring-rose-100"
          : project.status === "degraded"
          ? "border-amber-200"
          : "border-gray-100"
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("p-2.5 rounded-xl bg-gray-50 group-hover:bg-gray-100 transition-colors", tm.color)}>
            <TypeIcon size={18} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-text-main group-hover:text-brand transition-colors">{project.name}</h3>
            <p className="text-[10px] text-text-dim font-medium truncate max-w-[140px]">{project.url}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={project.status} />
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 bg-white border border-gray-100 rounded-xl shadow-xl p-1 min-w-[140px]">
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }} className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-gray-50 rounded-lg flex items-center gap-2">
                  <Settings size={12} /> Edit
                </button>
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onToggle(); }} className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-gray-50 rounded-lg flex items-center gap-2">
                  {project.enabled ? <EyeOff size={12} /> : <Eye size={12} />}
                  {project.enabled ? "Pause" : "Resume"}
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }} className="w-full text-left px-3 py-2 text-xs font-medium hover:bg-rose-50 text-rose-500 rounded-lg flex items-center gap-2">
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Uptime bar */}
      <MiniUptimeBar history={project.history} />

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 text-[10px] text-text-dim font-medium">
          <span className="font-mono font-bold text-text-main">{project.uptimePct.toFixed(2)}%</span>
          <span>uptime</span>
          {project.lastResponseTime !== undefined && (
            <>
              <span className="w-[1px] h-3 bg-gray-200" />
              <span className="font-mono">{project.lastResponseTime}ms</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!project.enabled && (
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
              Paused
            </span>
          )}
          <button
            onClick={handleCheck}
            className="p-1.5 rounded-lg text-gray-300 hover:text-brand hover:bg-brand/10 transition-colors"
            title="Check now"
          >
            {checking ? <RefreshCcw size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          </button>
          {project.lastChecked && (
            <span className="text-[10px] text-text-dim">{timeAgo(project.lastChecked)}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ─── ProjectDetailView ────────────────────────────────────────────────────────

const ProjectDetailView = ({
  project,
  onBack,
  onEdit,
  onRefresh,
}: {
  project: Project;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}) => {
  const [tab, setTab] = useState<"overview" | "logs" | "issues">("overview");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [checking, setChecking] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "error" | "warning" | "success">("all");

  const fetchData = useCallback(async () => {
    const [logsRes, issuesRes] = await Promise.all([
      axios.get<LogEntry[]>(`/api/projects/${project.id}/logs?limit=200`),
      axios.get<Issue[]>(`/api/projects/${project.id}/issues`),
    ]);
    setLogs(logsRes.data);
    setIssues(issuesRes.data);
  }, [project.id]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  const handleCheck = async () => {
    setChecking(true);
    await axios.post(`/api/projects/${project.id}/check`);
    await Promise.all([fetchData(), onRefresh()]);
    setChecking(false);
  };

  const m = STATUS_META[project.status];
  const tm = PROJECT_TYPE_META[project.type];
  const TypeIcon = tm.icon;

  // Build response time chart from logs
  const chartData = logs
    .filter((l) => l.responseTime !== undefined)
    .slice(0, 24)
    .reverse()
    .map((l) => ({
      time: formatTime(l.timestamp),
      ms: l.responseTime,
      type: l.type,
    }));

  // ── Accuracy computed values ───────────────────────────────────────────────
  // Response time baseline (p75 of last 20 samples)
  const rtSamples = project.responseTimeSamples || [];
  const rtBaseline: number | null = rtSamples.length >= 5
    ? [...rtSamples].sort((a, b) => a - b)[Math.floor(rtSamples.length * 0.75)]
    : null;
  const isRtAnomaly = rtBaseline !== null
    && project.lastResponseTime !== undefined
    && project.lastResponseTime > rtBaseline * 3
    && project.lastResponseTime > 1500;

  // Rolling window uptime from history array
  const checksPerDay = Math.max(1, Math.round(24 * 60 / project.checkInterval));
  const h24 = project.history.slice(-checksPerDay);
  const h7d = project.history.slice(-checksPerDay * 7);
  const uptime24h = h24.length > 3 ? (h24.reduce((a, b) => a + b, 0) / h24.length * 100) : null;
  const uptime7d  = h7d.length > 3 ? (h7d.reduce((a, b) => a + b, 0) / h7d.length * 100) : null;

  // Confirmation pending (failure logged but status still held at previous value)
  const confirmPending = (project.consecutiveFailures ?? 0) > 0 && project.status !== "down" && project.status !== "degraded";

  // Redirect detected
  const redirectDetected = project.finalUrl && project.finalUrl !== project.url;

  const openIssues = issues.filter((i) => i.status === "open");
  const resolvedIssues = issues.filter((i) => i.status === "resolved");

  const filteredLogs = logFilter === "all" ? logs : logs.filter((l) => l.type === logFilter);

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-grow">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-xl bg-gray-100", tm.color)}>
              <TypeIcon size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">{project.name}</h2>
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-text-dim hover:text-brand flex items-center gap-1 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {project.url} <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={project.status} />
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            <RefreshCcw size={12} className={checking ? "animate-spin" : ""} />
            {checking ? "Checking..." : "Check Now"}
          </button>
          <button
            onClick={onEdit}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: uptime7d !== null ? "Uptime (7d)" : "Uptime (lifetime)",
            value: uptime7d !== null ? `${uptime7d.toFixed(2)}%` : `${project.uptimePct.toFixed(2)}%`,
            highlight: (uptime7d ?? project.uptimePct) > 99,
          },
          {
            label: rtBaseline !== null ? "RT · Last / Baseline" : "Last Response",
            value: project.lastResponseTime !== undefined
              ? (rtBaseline !== null ? `${project.lastResponseTime}ms / ${rtBaseline}ms` : `${project.lastResponseTime}ms`)
              : "—",
            highlight: isRtAnomaly,
            highlightColor: "text-amber-500",
          },
          {
            label: project.lastStatusCode ? "Status Code" : "TCP Check",
            value: project.lastStatusCode
              ? `HTTP ${project.lastStatusCode}`
              : project.status === "operational" ? "Port Open"
              : project.status === "down" ? "Unreachable"
              : project.status === "degraded" ? "Slow/Error"
              : "—"
          },
          { label: "Open Issues", value: String(openIssues.length), highlight: openIssues.length > 0, highlightColor: "text-rose-500" },
        ...(project.sslDaysLeft !== null && project.sslDaysLeft !== undefined ? [
          { label: "SSL Cert Expires", value: `${project.sslDaysLeft}d`, highlight: project.sslDaysLeft <= 14, highlightColor: project.sslDaysLeft <= 7 ? "text-rose-500" : "text-amber-500" }
        ] : []),
        ].map(({ label, value, highlight, highlightColor }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">{label}</p>
            <p className={cn("text-xl font-black font-mono", highlight ? (highlightColor || "text-brand") : "text-text-main")}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-gray-100 p-1 rounded-xl flex gap-1 w-fit">
        {(["overview", "logs", "issues"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
              tab === t ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            {t === "overview" && <Activity size={12} />}
            {t === "logs" && <List size={12} />}
            {t === "issues" && (
              <>
                <AlertCircle size={12} />
                {openIssues.length > 0 && (
                  <span className="bg-rose-500 text-white text-[8px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                    {openIssues.length}
                  </span>
                )}
              </>
            )}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {tab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            {/* Status banner */}
            <div className={cn("p-5 rounded-xl border flex items-center gap-4", m.bg, m.border)}>
              <StatusDot status={project.status} pulse={project.status === "down"} />
              <div className="flex-1">
                <h3 className={cn("font-bold text-sm", m.color)}>{m.label}</h3>
                <p className="text-xs text-text-dim">
                  {project.lastChecked
                    ? `Last checked ${timeAgo(project.lastChecked)} · Interval: every ${project.checkInterval}min`
                    : "Not yet checked"}
                </p>
              </div>
              {confirmPending && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 border border-amber-300 rounded-xl">
                  <Clock size={12} className="text-amber-600 shrink-0" />
                  <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider">Confirming failure…</span>
                </div>
              )}
            </div>

            {/* ── Website Info ──────────────────────────────────────────────────── */}
            {(() => {
              const wi = project.websiteInfo;
              const isHttp = /^https?:\/\//i.test(project.url);
              const [reanalyzing, setReanalyzing]   = React.useState(false);
              const [reanalyzeDone, setReanalyzeDone] = React.useState(false);
              const [editing, setEditing]           = React.useState(false);
              const [editForm, setEditForm]         = React.useState<WebsiteInfo>({});
              const [saving, setSaving]             = React.useState(false);

              const handleReanalyze = async () => {
                setReanalyzing(true);
                setReanalyzeDone(false);
                try {
                  await axios.post(`/api/projects/${project.id}/analyze-website`);
                  setReanalyzeDone(true);
                  setTimeout(() => setReanalyzeDone(false), 3000);
                } catch { /* ignore */ }
                finally { setReanalyzing(false); }
              };

              const openEdit = () => {
                setEditForm({
                  company:      wi?.company      || "",
                  tagline:      wi?.tagline      || "",
                  about:        wi?.about        || project.description || "",
                  region:       wi?.region       || "",
                  contactEmail: wi?.contactEmail || "",
                  contactPhone: wi?.contactPhone || "",
                  address:      wi?.address      || "",
                  services:     wi?.services     || [],
                  technologies: wi?.technologies || [],
                  keyPages:     wi?.keyPages     || [],
                  socialLinks:  wi?.socialLinks  || [],
                });
                setEditing(true);
              };

              const handleSave = async () => {
                setSaving(true);
                try {
                  await axios.put(`/api/projects/${project.id}`, {
                    description: editForm.about || project.description,
                    websiteInfo: { ...editForm, lastAnalyzed: wi?.lastAnalyzed },
                  });
                  setEditing(false);
                } catch { /* ignore */ }
                finally { setSaving(false); }
              };

              // Helper to edit comma-separated arrays
              const ArrayField = ({ label, field }: { label: string; field: "services" | "technologies" }) => (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">{label}</label>
                  <input
                    value={(editForm[field] as string[] || []).join(", ")}
                    onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
                    placeholder={`e.g. ${field === "services" ? "Job Portal, Career Platform" : "React, Node.js, PostgreSQL"}`}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <p className="text-[9px] text-text-dim mt-0.5">Separate with commas</p>
                </div>
              );

              if (!project.description && !wi && !isHttp) return null;

              return (
                <>
                {/* Edit modal */}
                {editing && (
                  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditing(false)}>
                    <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                        <h3 className="font-black text-sm uppercase tracking-tight">Edit Website Info</h3>
                        <button onClick={() => setEditing(false)} className="text-text-dim hover:text-text-main"><X size={16} /></button>
                      </div>
                      <div className="p-6 space-y-4">
                        {[
                          { label: "Company / Product Name", field: "company",      placeholder: "e.g. NCPL Consulting" },
                          { label: "Tagline / Slogan",       field: "tagline",      placeholder: "e.g. Apply Jobs Faster and Easy" },
                          { label: "Region",                 field: "region",       placeholder: "e.g. Global, India, North America" },
                          { label: "Contact Email",          field: "contactEmail", placeholder: "contact@example.com" },
                          { label: "Contact Phone",          field: "contactPhone", placeholder: "+1-555-..." },
                          { label: "Address",                field: "address",      placeholder: "Physical address" },
                        ].map(({ label, field, placeholder }) => (
                          <div key={field}>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">{label}</label>
                            <input
                              value={(editForm as any)[field] || ""}
                              onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.value }))}
                              placeholder={placeholder}
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                            />
                          </div>
                        ))}
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">About</label>
                          <textarea
                            rows={3}
                            value={editForm.about || ""}
                            onChange={(e) => setEditForm((f) => ({ ...f, about: e.target.value }))}
                            placeholder="What does this company/service do?"
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none"
                          />
                        </div>
                        <ArrayField label="Services (comma-separated)" field="services" />
                        <ArrayField label="Technologies (comma-separated)" field="technologies" />
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">Key Pages (label|url per line)</label>
                          <textarea
                            rows={3}
                            value={(editForm.keyPages || []).map((p) => `${p.label}|${p.url}`).join("\n")}
                            onChange={(e) => setEditForm((f) => ({
                              ...f,
                              keyPages: e.target.value.split("\n").map((l) => {
                                const [label, url] = l.split("|");
                                return { label: label?.trim() || "", url: url?.trim() || "" };
                              }).filter((p) => p.label && p.url),
                            }))}
                            placeholder={"Home|https://example.com\nAbout|https://example.com/about"}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">Social Links (Platform|url per line)</label>
                          <textarea
                            rows={3}
                            value={(editForm.socialLinks || []).map((s) => `${s.platform}|${s.url}`).join("\n")}
                            onChange={(e) => setEditForm((f) => ({
                              ...f,
                              socialLinks: e.target.value.split("\n").map((l) => {
                                const [platform, url] = l.split("|");
                                return { platform: platform?.trim() || "", url: url?.trim() || "" };
                              }).filter((s) => s.platform && s.url),
                            }))}
                            placeholder={"LinkedIn|https://linkedin.com/company/...\nTwitter|https://twitter.com/..."}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand resize-none"
                          />
                        </div>
                      </div>
                      <div className="px-6 pb-6 flex items-center gap-3">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-black text-xs font-black uppercase rounded-xl hover:bg-black hover:text-brand transition-all"
                        >
                          {saving ? <RefreshCcw size={12} className="animate-spin" /> : <Check size={12} />}
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditing(false)} className="px-5 py-2.5 bg-gray-100 text-text-dim text-xs font-black uppercase rounded-xl hover:bg-gray-200 transition-all">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white border border-blue-100 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                    <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                      <Globe size={13} className="text-white" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-blue-900">{wi?.company || project.name}</h3>
                      {wi?.tagline && <p className="text-[10px] text-blue-600 font-medium">{wi.tagline}</p>}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {wi?.lastAnalyzed && (
                        <span className="text-[9px] text-blue-400 font-medium">
                          Analyzed {timeAgo(wi.lastAnalyzed)}
                        </span>
                      )}
                      {/* Edit button */}
                      <button
                        onClick={openEdit}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase border border-blue-200 bg-white text-blue-500 hover:bg-blue-100 transition-all"
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                      </button>
                      {/* Re-analyze button */}
                      {isHttp && (
                        <button
                          onClick={handleReanalyze}
                          disabled={reanalyzing}
                          title="Re-analyze website info with AI"
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase border transition-all",
                            reanalyzeDone
                              ? "bg-brand/10 text-brand border-brand/30"
                              : "bg-white border-blue-200 text-blue-500 hover:bg-blue-100"
                          )}
                        >
                          {reanalyzing ? <RefreshCcw size={9} className="animate-spin" /> : reanalyzeDone ? <Check size={9} /> : <RefreshCcw size={9} />}
                          {reanalyzing ? "Analyzing…" : reanalyzeDone ? "Updated!" : "Re-analyze"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Empty state — no website info yet */}
                    {!wi && !project.description && isHttp && (
                      <div className="flex flex-col items-center gap-3 py-6 text-center">
                        <Sparkles size={22} className="text-blue-300" />
                        <div>
                          <p className="text-sm font-bold text-text-main">No website info yet</p>
                          <p className="text-xs text-text-dim mt-0.5">Click <strong>Re-analyze</strong> to auto-extract company info, services, and technologies from this URL using AI.</p>
                        </div>
                      </div>
                    )}
                    {/* About */}
                    {(project.description || wi?.about) && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-1.5">About</p>
                        <p className="text-xs text-text-main leading-relaxed">{project.description || wi?.about}</p>
                      </div>
                    )}

                    {/* Services */}
                    {wi?.services && wi.services.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Services</p>
                        <div className="flex flex-wrap gap-1.5">
                          {wi.services.map((s, i) => (
                            <span key={i} className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-semibold rounded-lg border border-blue-100">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Technologies */}
                    {wi?.technologies && wi.technologies.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Technologies</p>
                        <div className="flex flex-wrap gap-1.5">
                          {wi.technologies.map((t, i) => (
                            <span key={i} className="px-2.5 py-1 bg-purple-50 text-purple-700 text-[10px] font-semibold rounded-lg border border-purple-100 font-mono">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Region */}
                    {wi?.region && (
                      <div className="flex items-center gap-2">
                        <MapPin size={11} className="text-text-dim shrink-0" />
                        <span className="text-[11px] text-text-main">{wi.region}</span>
                      </div>
                    )}

                    {/* Contact info */}
                    {(wi?.contactEmail || wi?.contactPhone || wi?.address) && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-dim">Contact</p>
                        {wi.contactEmail && (
                          <div className="flex items-center gap-2">
                            <Mail size={11} className="text-text-dim shrink-0" />
                            <span className="text-[11px] text-text-main">{wi.contactEmail}</span>
                          </div>
                        )}
                        {wi.contactPhone && (
                          <div className="flex items-center gap-2">
                            <Phone size={11} className="text-text-dim shrink-0" />
                            <span className="text-[11px] text-text-main">{wi.contactPhone}</span>
                          </div>
                        )}
                        {wi.address && (
                          <div className="flex items-center gap-2">
                            <MapPin size={11} className="text-text-dim shrink-0" />
                            <span className="text-[11px] text-text-main">{wi.address}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Key pages */}
                    {wi?.keyPages && wi.keyPages.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Key Pages</p>
                        <div className="flex flex-wrap gap-1.5">
                          {wi.keyPages.map((pg, i) => (
                            <a key={i} href={pg.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-brand/10 text-text-main hover:text-brand text-[10px] font-medium rounded-lg border border-gray-200 transition-colors">
                              <ExternalLink size={9} />
                              {pg.label}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Social links */}
                    {wi?.socialLinks && wi.socialLinks.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Social</p>
                        <div className="flex flex-wrap gap-1.5">
                          {wi.socialLinks.map((sl, i) => (
                            <a key={i} href={sl.url} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-gray-50 hover:bg-brand/10 text-text-main hover:text-brand text-[10px] font-medium rounded-lg border border-gray-200 transition-colors">
                              {sl.platform}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                </>
              );
            })()}

            {/* ── Accuracy Signals ─────────────────────────────────────────────── */}
            {(isRtAnomaly || redirectDetected || uptime24h !== null || (project.consecutiveFailures ?? 0) >= 2) && (
              <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Accuracy Signals</h3>

                {/* RT anomaly */}
                {isRtAnomaly && rtBaseline !== null && (
                  <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <Zap size={14} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-amber-800">Response Time Spike Detected</p>
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        Current: <strong>{project.lastResponseTime}ms</strong> · Baseline (p75): <strong>{rtBaseline}ms</strong> · {Math.round((project.lastResponseTime! / rtBaseline) * 10) / 10}× above normal
                      </p>
                    </div>
                  </div>
                )}

                {/* Redirect detected */}
                {redirectDetected && (
                  <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <ArrowRight size={14} className="text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-blue-800">Redirect Detected</p>
                      <p className="text-[11px] text-blue-700 mt-0.5 break-all">
                        {project.url} → <strong>{project.finalUrl}</strong>
                      </p>
                    </div>
                  </div>
                )}

                {/* Rolling window uptime breakdown */}
                {(uptime24h !== null || uptime7d !== null) && (
                  <div className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                    <Activity size={14} className="text-brand shrink-0" />
                    <div className="flex gap-6">
                      {uptime24h !== null && (
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-text-dim">24h Uptime</p>
                          <p className={cn("text-sm font-black font-mono", uptime24h >= 99 ? "text-brand" : uptime24h >= 95 ? "text-amber-500" : "text-rose-500")}>
                            {uptime24h.toFixed(1)}%
                          </p>
                        </div>
                      )}
                      {uptime7d !== null && (
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-text-dim">7d Uptime</p>
                          <p className={cn("text-sm font-black font-mono", uptime7d >= 99 ? "text-brand" : uptime7d >= 95 ? "text-amber-500" : "text-rose-500")}>
                            {uptime7d.toFixed(1)}%
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-text-dim">Lifetime</p>
                        <p className="text-sm font-black font-mono text-text-main">{project.uptimePct.toFixed(1)}%</p>
                      </div>
                      {rtBaseline !== null && (
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-text-dim">RT Baseline (p75)</p>
                          <p className="text-sm font-black font-mono text-text-main">{rtBaseline}ms</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Consecutive failures */}
                {(project.consecutiveFailures ?? 0) >= 2 && (
                  <div className="flex items-start gap-3 p-3 bg-rose-50 border border-rose-200 rounded-xl">
                    <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-rose-800">Consecutive Failures: {project.consecutiveFailures}</p>
                      <p className="text-[11px] text-rose-700 mt-0.5">
                        This project has failed {project.consecutiveFailures} checks in a row. Status will recover when a successful check completes.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Response time chart */}
            {chartData.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-xl p-6">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-4">
                  Response Time (last {chartData.length} checks)
                </h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3ecf8e" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#3ecf8e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#9ca3af" }} interval="preserveStartEnd" />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#9ca3af" }} unit="ms" />
                      <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,.1)" }} />
                      <Area type="monotone" dataKey="ms" stroke="#3ecf8e" strokeWidth={2} fill="url(#rtGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* 90-day uptime */}
            <div className="bg-white border border-gray-100 rounded-xl p-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-4">90-Day Uptime</h3>
              <div className="flex gap-[2px] h-8 items-end">
                {(project.history.length === 0 ? Array(90).fill(-1) : project.history).map((val, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex-1 rounded-[1px]",
                      val === 1 ? "h-full bg-brand/70 hover:bg-brand" : val === 0 ? "h-3/4 bg-rose-400 hover:bg-rose-500" : "h-1/2 bg-gray-200"
                    )}
                    title={`Day ${i + 1}: ${val === 1 ? "Operational" : val === 0 ? "Issue" : "No data"}`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-[9px] text-text-dim font-bold uppercase">
                <span>90d ago</span>
                <span>Today</span>
              </div>
            </div>

            {/* ── Auto Health Scan ─────────────────────────────────────────────── */}
            {(() => {
              const [scanning, setScanning] = React.useState(false);
              const [scanErr, setScanErr]   = React.useState<string|null>(null);
              const [localScan, setLocalScan] = React.useState<any>(project.lastScanResult ?? null);

              const runScan = async () => {
                if (!/^https?:\/\//i.test(project.url)) {
                  setScanErr("Auto Health Scan only works for HTTP/HTTPS URLs");
                  return;
                }
                setScanning(true);
                setScanErr(null);
                try {
                  const res = await axios.post<any>("/api/full-scan", { url: project.url }, { timeout: 35000 });
                  const sr = res.data;
                  setLocalScan(sr);
                  // Persist to project
                  await axios.put(`/api/projects/${project.id}`, { lastScanResult: {
                    scannedAt: sr.scannedAt, overallScore: sr.overallScore,
                    website: sr.website, api: sr.api, server: sr.server, database: sr.database,
                  }});
                } catch (e: any) {
                  setScanErr(e.response?.data?.error || e.message || "Scan failed");
                } finally {
                  setScanning(false);
                }
              };

              const sr = localScan;
              const latColor = (ms: number | null) =>
                ms === null ? "text-gray-400" : ms > 3000 ? "text-rose-500" : ms > 1000 ? "text-amber-500" : "text-brand";
              const stBg = (st: string) =>
                st === "healthy"  ? "bg-brand/10 text-brand border-brand/20" :
                st === "warning"  ? "bg-amber-50 text-amber-600 border-amber-200" :
                st === "critical" ? "bg-rose-50 text-rose-600 border-rose-200" :
                st === "spa"      ? "bg-blue-50 text-blue-600 border-blue-200" :
                st === "not_applicable" ? "bg-gray-100 text-gray-500 border-gray-200" :
                "bg-gray-50 text-gray-400 border-gray-200";
              const stIcon = (st: string) =>
                st === "healthy" ? "✅" : st === "warning" ? "⚠️" : st === "critical" ? "❌" :
                st === "spa" ? "⚡" : st === "not_applicable" ? "—" : "⏳";
              const scoreClr = (s: number | null) =>
                s === null ? "text-gray-400" : s >= 80 ? "text-brand" : s >= 50 ? "text-amber-500" : "text-rose-500";
              const scoreBgClr = (s: number | null) =>
                s === null ? "bg-gray-200" : s >= 80 ? "bg-brand" : s >= 50 ? "bg-amber-400" : "bg-rose-500";

              const CARDS = !sr ? [] : [
                {
                  key: "website" as const, label: "Website", icon: <Globe size={12} />,
                  d: sr.website,
                  detail: `HTTP ${sr.website.httpStatus ?? "—"} · ${sr.website.responseTime ?? "—"}ms${sr.website.ssl ? ` · SSL ${sr.website.ssl.daysLeft}d` : ""}`,
                  extra: `${sr.website.hasRobots ? "✓ robots" : "✗ robots"} · ${sr.website.hasSitemap ? "✓ sitemap" : "✗ sitemap"}`,
                },
                {
                  key: "api" as const, label: "API", icon: <Terminal size={12} />,
                  d: sr.api,
                  detail: (sr.api as any).notApplicable ? "No API layer" :
                          (sr.api as any).isSpaWithClientApis ? "SPA — client-side APIs" :
                          `${sr.api.healthyCount} healthy endpoint${sr.api.healthyCount !== 1 ? "s" : ""}`,
                  extra: sr.api.issues[0] || "",
                },
                {
                  key: "server" as const, label: "Server", icon: <Server size={12} />,
                  d: sr.server,
                  detail: `${sr.server.technology}${sr.server.cdn ? ` · CDN: ${sr.server.cdn}` : ""} · ${sr.server.ttfb}ms`,
                  extra: `${Object.values(sr.server.securityHeaders).filter(Boolean).length}/6 security headers`,
                },
                {
                  key: "database" as const, label: "Database", icon: <Database size={12} />,
                  d: sr.database,
                  detail: sr.database.detected.slice(0,2).join(", ") || "No DB detected",
                  extra: sr.database.stack[0] || "",
                },
              ];

              return (
                <div className="bg-white border border-gray-100 rounded-xl p-5">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Auto Health Scan</h3>
                      {sr && <span className="text-[9px] text-text-dim">· Scanned {timeAgo(sr.scannedAt)}</span>}
                    </div>
                    <button
                      onClick={runScan}
                      disabled={scanning}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-all",
                        scanning ? "bg-gray-100 text-text-dim border-gray-200" :
                        sr ? "bg-white border-gray-200 text-text-dim hover:border-brand hover:text-brand" :
                        "bg-brand text-black border-brand hover:bg-black hover:text-brand"
                      )}
                    >
                      <RefreshCcw size={10} className={scanning ? "animate-spin" : ""} />
                      {scanning ? "Scanning…" : sr ? "Re-scan" : "Run Health Scan"}
                    </button>
                  </div>

                  {/* Scanning progress */}
                  {scanning && (
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-900 rounded-xl mb-4 text-[10px] text-gray-400">
                      <RefreshCcw size={11} className="animate-spin text-brand shrink-0" />
                      Scanning all components — takes 10–20 seconds…
                    </div>
                  )}

                  {/* Error */}
                  {scanErr && !scanning && (
                    <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 mb-4">
                      <AlertCircle size={13} className="shrink-0" /> {scanErr}
                    </div>
                  )}

                  {/* Empty state — no scan yet */}
                  {!sr && !scanning && !scanErr && (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                        <Activity size={20} className="text-text-dim" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-text-main">No health scan yet</p>
                        <p className="text-xs text-text-dim mt-1">
                          Click <strong>Run Health Scan</strong> to check Website, API, Server and Database health in one click.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Results */}
                  {sr && !scanning && (
                    <>

                  {/* Overall bar */}
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 rounded-xl mb-4">
                    <span className="text-[10px] text-gray-400 font-bold">Overall</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${scoreBgClr(sr.overallScore)}`} style={{ width: `${sr.overallScore}%` }} />
                    </div>
                    <span className={`text-sm font-black ${scoreClr(sr.overallScore)}`}>{sr.overallScore}/100</span>
                  </div>

                  {/* 4 cards */}
                  <div className="grid grid-cols-2 gap-2">
                    {CARDS.map(({ key, label, icon, d, detail, extra }) => (
                      <div key={key} className={`p-3 rounded-xl border space-y-2 ${(d as any).status === (key === "api" && (d as any).notApplicable ? "not_applicable" : (d as any).status) ? "" : ""}`}
                           style={{ borderColor: d.status === "healthy" ? "rgb(62 207 142 / 0.3)" : d.status === "critical" ? "rgb(244 63 94 / 0.3)" : d.status === "warning" ? "rgb(245 158 11 / 0.3)" : "rgb(229 231 235)" }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-text-dim">
                            {icon}
                            <span className="text-[10px] font-black uppercase tracking-wider text-text-main">{label}</span>
                          </div>
                          {(d as any).notApplicable ? (
                            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">N/A</span>
                          ) : (
                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border ${stBg(d.status)}`}>
                              {stIcon(d.status)} {d.status}
                            </span>
                          )}
                        </div>

                        {!(d as any).notApplicable && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                              <div className={`h-1.5 rounded-full ${scoreBgClr(d.score ?? null)}`}
                                   style={{ width: `${d.score ?? 75}%` }} />
                            </div>
                            <span className={`text-xs font-black ${scoreClr(d.score ?? null)}`}>{d.score ?? "—"}</span>
                          </div>
                        )}

                        <div>
                          <p className="text-[9px] text-text-dim">{detail}</p>
                          {extra && <p className="text-[9px] text-text-dim">{extra}</p>}
                          {d.issues[0] && <p className="text-[9px] text-amber-600 truncate">⚠ {d.issues[0]}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                  )}
                </div>
              );
            })()}

            {/* HTTP Method Results */}
            {project.methodResults && Object.keys(project.methodResults).length > 0 && (
              <div className="bg-white border border-gray-100 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">HTTP Method Sweep</h3>
                  <span className="text-[10px] text-text-dim">
                    Last checked {project.lastChecked ? timeAgo(project.lastChecked) : "—"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(["GET","POST","HEAD","PUT","PATCH","DELETE"] as const).map((method) => {
                    const r = project.methodResults?.[method];
                    const primaryMethod = project.credentials?.method || "GET";
                    const isPrimary = method === primaryMethod;

                    const statusCode = r?.status;
                    const hasError   = !!r?.error;              // no HTTP status returned
                    const is2xx = statusCode !== null && statusCode !== undefined && statusCode >= 200 && statusCode < 300;
                    const is3xx = statusCode !== null && statusCode !== undefined && statusCode >= 300 && statusCode < 400;
                    const is4xx = statusCode !== null && statusCode !== undefined && statusCode >= 400 && statusCode < 500;
                    const is5xx = statusCode !== null && statusCode !== undefined && statusCode >= 500;

                    // Error label → icon hint
                    const errLabel   = r?.error || "";
                    const isTimeout  = errLabel.toLowerCase().includes("timeout");
                    const isDns      = errLabel.toLowerCase().includes("dns");
                    const isRefused  = errLabel.toLowerCase().includes("refused");
                    const isNoData   = !r;

                    // Card background
                    const bgColor = isNoData                     ? "bg-gray-50 border-gray-100"
                                  : hasError                     ? "bg-gray-50 border-gray-200"
                                  : is5xx                        ? "bg-red-50 border-red-200"
                                  : is4xx                        ? "bg-amber-50 border-amber-200"
                                  : is3xx                        ? "bg-blue-50 border-blue-200"
                                  :                                "bg-green-50 border-green-200";

                    // Status code / error display
                    const statusDisplay = (() => {
                      if (isNoData) return { text: "—", color: "text-gray-300", sub: "" };
                      if (statusCode !== null && statusCode !== undefined) {
                        const c = is5xx ? "text-red-600" : is4xx ? "text-amber-600" : is3xx ? "text-blue-600" : "text-green-700";
                        return { text: String(statusCode), color: c, sub: `${r!.responseTime ?? 0}ms` };
                      }
                      // Error — no HTTP status
                      return {
                        text: errLabel || "Error",
                        color: "text-gray-500",
                        sub: r!.responseTime != null ? `${r!.responseTime}ms` : "",
                        isErr: true,
                      };
                    })();

                    const methodColor = method === "GET"    ? "bg-green-500"
                                      : method === "POST"   ? "bg-blue-500"
                                      : method === "HEAD"   ? "bg-purple-500"
                                      : method === "PUT"    ? "bg-orange-500"
                                      : method === "PATCH"  ? "bg-teal-500"
                                      :                       "bg-red-500";

                    return (
                      <div key={method} className={cn("relative rounded-xl border p-4 transition-all", bgColor)}>
                        {/* Primary badge */}
                        {isPrimary && (
                          <span className="absolute top-2 right-2 text-[8px] font-black uppercase tracking-wider bg-brand/20 text-brand px-1.5 py-0.5 rounded-full">
                            primary
                          </span>
                        )}

                        {/* Method pill */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className={cn("text-white text-[10px] font-black px-2 py-0.5 rounded-md", methodColor)}>
                            {method}
                          </span>
                        </div>

                        {/* Status / Error display */}
                        {statusDisplay.isErr ? (
                          // Clean error state — icon + label, no raw ALL-CAPS code
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              {isTimeout  && <Clock size={14} className="text-gray-400 shrink-0" />}
                              {isDns      && <WifiOff size={14} className="text-gray-400 shrink-0" />}
                              {isRefused  && <X size={14} className="text-gray-400 shrink-0" />}
                              {!isTimeout && !isDns && !isRefused && <AlertCircle size={14} className="text-gray-400 shrink-0" />}
                              <span className="text-sm font-bold text-gray-500">{statusDisplay.text}</span>
                            </div>
                            {statusDisplay.sub && (
                              <span className="text-[10px] text-gray-400 font-mono">{statusDisplay.sub}</span>
                            )}
                          </div>
                        ) : (
                          // Normal HTTP status code
                          <>
                            <div className={cn("text-2xl font-black font-mono", statusDisplay.color)}>
                              {statusDisplay.text}
                            </div>
                            <div className="text-[10px] text-text-dim mt-1 font-mono">{statusDisplay.sub}</div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-text-dim mt-3">
                  All 6 methods probed in parallel every check cycle. <strong>Primary</strong> method determines uptime status.
                </p>
              </div>
            )}

            {/* Recent issues */}
            {openIssues.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-5">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-rose-600 mb-3">
                  {openIssues.length} Active Issue{openIssues.length > 1 ? "s" : ""}
                </h3>
                <div className="space-y-2">
                  {openIssues.map((issue) => (
                    <div key={issue.id} className="bg-white rounded-lg p-3 border border-rose-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border", SEVERITY_META[issue.severity].bg, SEVERITY_META[issue.severity].color, SEVERITY_META[issue.severity].border)}>
                          {issue.severity}
                        </span>
                        <span className="text-[10px] text-text-dim">{timeAgo(issue.startedAt)}</span>
                      </div>
                      <p className="text-xs font-semibold text-text-main">{issue.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {tab === "logs" && (
          <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Filter */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5 bg-gray-100 p-1 rounded-xl">
                {(["all", "error", "warning", "success"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setLogFilter(f)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                      logFilter === f ? "bg-white shadow-sm text-text-main" : "text-text-dim hover:text-text-main"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-text-dim font-medium">{filteredLogs.length} entries</span>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="py-20 text-center bg-white border border-dashed border-gray-200 rounded-xl text-text-dim">
                No logs yet — the monitor will populate this on the next check.
              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                {filteredLogs.map((log, i) => {
                  const lm = LOG_TYPE_META[log.type];
                  const isSoftErr = log.message.includes("Soft error") || log.message.includes("Soft 404") || log.message.includes("⚠");
                  const isAuthErr = log.message.includes("🔒");
                  const isFuncErr = log.message.includes("⚙");
                  // Split message at ' | ' so each signal gets its own line
                  const parts = log.message.split(" | ");
                  return (
                    <div key={log.id} className={cn(
                      "flex items-start gap-4 px-5 py-3.5 text-sm border-b border-gray-50 hover:bg-gray-50/50 transition-colors",
                      i === filteredLogs.length - 1 && "border-b-0",
                      isAuthErr  && "bg-purple-50/40 border-purple-100",
                      isFuncErr  && !isAuthErr && "bg-cyan-50/40 border-cyan-100",
                      !isAuthErr && !isFuncErr && isSoftErr && "bg-amber-50/40 border-amber-100"
                    )}>
                      <span className={cn("shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md mt-0.5", lm.bg, lm.color)}>
                        {lm.label}
                      </span>
                      <div className="flex-grow min-w-0">
                        {/* Primary message */}
                        <p className="text-xs font-mono text-text-main">{parts[0]}</p>
                        {/* Extra signal lines (redirect, soft error, auth issue, functional error, anomaly) */}
                        {parts.slice(1).map((part, pi) => {
                          const isAuth     = part.includes("🔒");
                          const isFunc     = part.includes("⚙");
                          const isSoft     = part.includes("Soft") || part.includes("⚠");
                          const isSpike    = part.includes("⚡");
                          const isRedirect = part.includes("↪");
                          return (
                            <p key={pi} className={cn(
                              "text-[10px] font-mono mt-0.5",
                              isAuth     ? "text-purple-600 font-semibold" :
                              isFunc     ? "text-cyan-700 font-semibold" :
                              isSoft     ? "text-amber-600 font-semibold" :
                              isSpike    ? "text-orange-500" :
                              isRedirect ? "text-blue-500" :
                              "text-text-dim"
                            )}>
                              {part}
                            </p>
                          );
                        })}
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-text-dim">{formatDate(log.timestamp)} {formatTime(log.timestamp)}</span>
                          {log.responseTime !== undefined && (
                            <span className="text-[10px] font-mono text-text-dim">{log.responseTime}ms</span>
                          )}
                          {log.statusCode && (
                            <span className={cn("text-[10px] font-mono", log.statusCode >= 400 ? "text-rose-500 font-bold" : "text-text-dim")}>
                              HTTP {log.statusCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {tab === "issues" && (
          <motion.div key="issues" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* ── MTTR summary bar ── */}
            {(() => {
              const resolved = issues.filter((i) => i.status === "resolved" && i.resolvedAt);
              const mttr = resolved.length
                ? Math.round(resolved.reduce((s, i) => s + (i.resolvedAt! - i.startedAt), 0) / resolved.length / 60000)
                : null;
              const longestOutage = resolved.length
                ? Math.max(...resolved.map((i) => Math.round((i.resolvedAt! - i.startedAt) / 60000)))
                : null;
              return (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-black text-text-main">{openIssues.length}</div>
                    <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Open Issues</div>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-black text-blue-600">{mttr !== null ? `${mttr}m` : "—"}</div>
                    <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Avg MTTR</div>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
                    <div className="text-2xl font-black text-amber-500">{longestOutage !== null ? `${longestOutage}m` : "—"}</div>
                    <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Longest Outage</div>
                  </div>
                </div>
              );
            })()}

            {issues.length === 0 ? (
              <div className="py-20 text-center bg-white border border-dashed border-gray-200 rounded-xl text-text-dim">
                <CheckCircle2 size={32} className="text-brand mx-auto mb-3" />
                No issues detected. Everything looks good!
              </div>
            ) : (
              <>
                {openIssues.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-rose-500 mb-3">Open Issues ({openIssues.length})</h4>
                    <div className="space-y-3">
                      {openIssues.map((issue) => (
                        <div key={issue.id} className="bg-white border border-rose-100 rounded-xl p-5">
                          <div className="flex items-center justify-between mb-2">
                            <span className={cn("text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border", SEVERITY_META[issue.severity].bg, SEVERITY_META[issue.severity].color, SEVERITY_META[issue.severity].border)}>
                              {issue.severity}
                            </span>
                            <span className="text-[10px] text-text-dim">{formatDate(issue.startedAt)} {formatTime(issue.startedAt)}</span>
                          </div>
                          <p className="text-sm font-semibold text-text-main">{issue.message}</p>
                          <p className="text-[10px] text-rose-500 font-bold mt-1.5">Started {timeAgo(issue.startedAt)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {resolvedIssues.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-3">Resolved ({resolvedIssues.length})</h4>
                    <div className="space-y-3">
                      {resolvedIssues.map((issue) => (
                        <div key={issue.id} className="bg-white border border-gray-100 rounded-xl p-5 opacity-70">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border border-brand/20 bg-brand/10 text-brand">
                              Resolved
                            </span>
                            <span className="text-[10px] text-text-dim">{formatDate(issue.startedAt)} {formatTime(issue.startedAt)}</span>
                          </div>
                          <p className="text-sm font-semibold text-text-main">{issue.message}</p>
                          {issue.resolvedAt && (
                            <p className="text-[10px] text-brand font-bold mt-1.5">
                              Resolved {timeAgo(issue.resolvedAt)} · Duration {Math.round((issue.resolvedAt - issue.startedAt) / 60000)}min
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── SettingsView ─────────────────────────────────────────────────────────────

const SettingsView = () => {
  const [settings, setSettings] = useState<AppSettings>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [showVercelToken, setShowVercelToken] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<"ok" | "fail" | null>(null);
  const [testingGroq, setTestingGroq] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState<"ok" | "fail" | null>(null);
  const [testingVercel, setTestingVercel] = useState(false);
  const [vercelTestResult, setVercelTestResult] = useState<"ok" | "fail" | null>(null);

  useEffect(() => {
    axios.get<AppSettings>("/api/settings").then((r) => setSettings(r.data));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await axios.post("/api/settings", settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestGeminiKey = async () => {
    const key = settings.geminiApiKey;
    if (!key || key === "••••••••") return;
    setTestingKey(true);
    setKeyTestResult(null);
    try {
      const client = new GoogleGenAI({ apiKey: key });
      await client.models.generateContent({
        model: settings.geminiModel || "gemini-2.0-flash",
        contents: "Reply with just the word OK",
      });
      setKeyTestResult("ok");
    } catch {
      setKeyTestResult("fail");
    } finally {
      setTestingKey(false);
    }
  };

  const handleTestGroqKey = async () => {
    const key = settings.groqApiKey;
    if (!key || key === "••••••••") return;
    setTestingGroq(true);
    setGroqTestResult(null);
    try {
      const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        { model: settings.groqModel || "llama-3.3-70b-versatile", messages: [{ role: "user", content: "Reply with just OK" }], max_tokens: 5 },
        { headers: { Authorization: `Bearer ${key}` } }
      );
      setGroqTestResult(res.data.choices?.[0]?.message?.content ? "ok" : "fail");
    } catch {
      setGroqTestResult("fail");
    } finally {
      setTestingGroq(false);
    }
  };

  const handleTestVercelToken = async () => {
    setTestingVercel(true);
    setVercelTestResult(null);
    try {
      // First save current settings so the server picks up the new token
      await axios.post("/api/settings", settings);
      // Then test by actually fetching Vercel projects through the proxy
      const res = await axios.get<{ projects?: unknown[] }>("/api/vercel/projects");
      setVercelTestResult(Array.isArray(res.data.projects) ? "ok" : "fail");
    } catch {
      setVercelTestResult("fail");
    } finally {
      setTestingVercel(false);
    }
  };

  const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-dim mt-1.5">{hint}</p>}
    </div>
  );

  const inputClass = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand";

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight">Settings</h2>
        <p className="text-sm text-text-dim mt-1">Configure email notifications and global preferences</p>
      </div>

      {/* Public Status Page */}
      <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm">Public Status Page</h3>
            <p className="text-xs text-text-dim mt-0.5">A shareable URL your users can visit to see system health</p>
          </div>
          <a
            href="/status"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-brand text-black text-xs font-black uppercase tracking-wider rounded-xl hover:bg-black hover:text-brand transition-all"
          >
            <ExternalLink size={12} /> Open Status Page
          </a>
        </div>
        <Field label="Status Page Title">
          <input
            value={settings.statusPageTitle || ""}
            onChange={(e) => setSettings((s) => ({ ...s, statusPageTitle: e.target.value }))}
            placeholder="System Status"
            className={inputClass}
          />
        </Field>
        <p className="text-[10px] text-text-dim">
          Share <code className="bg-gray-100 px-1 py-0.5 rounded">http://your-server/status</code> with your team or customers.
        </p>
      </div>

      {/* ── Groq AI Section (primary AI for analysis) ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shrink-0">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-tight">Groq AI · Analysis Engine</h3>
            <p className="text-xs text-text-dim mt-0.5">Powers all 4 steps of AI Analysis — Connect, Fetch, Analyze, Health Check</p>
          </div>
          {settings.groqApiKey && settings.groqApiKey !== "••••••••" ? (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-green-600 font-bold bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Configured
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-amber-600 font-bold bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Not set
            </span>
          )}
        </div>

        <Field label="Groq API Key">
          <div className="relative">
            <input
              type={showGroqKey ? "text" : "password"}
              value={settings.groqApiKey || ""}
              onChange={(e) => setSettings((s) => ({ ...s, groqApiKey: e.target.value }))}
              placeholder="gsk_..."
              className={cn(inputClass, "pr-24 font-mono text-sm")}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button onClick={() => setShowGroqKey(!showGroqKey)} className="p-1 text-gray-400 hover:text-gray-600">
                {showGroqKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                onClick={handleTestGroqKey}
                disabled={testingGroq || !settings.groqApiKey || settings.groqApiKey === "••••••••"}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all",
                  groqTestResult === "ok"   ? "bg-green-100 text-green-700" :
                  groqTestResult === "fail" ? "bg-red-100 text-red-700" :
                  "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {testingGroq ? <RefreshCcw size={10} className="animate-spin" /> :
                 groqTestResult === "ok" ? <Check size={10} /> :
                 groqTestResult === "fail" ? <X size={10} /> : <Zap size={10} />}
                {testingGroq ? "Testing…" : groqTestResult === "ok" ? "Works!" : groqTestResult === "fail" ? "Failed" : "Test"}
              </button>
            </div>
          </div>
        </Field>

        <Field label="Groq Model">
          <select
            value={settings.groqModel || "llama-3.3-70b-versatile"}
            onChange={(e) => setSettings((s) => ({ ...s, groqModel: e.target.value }))}
            className={inputClass}
          >
            <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Recommended — best analysis)</option>
            <option value="llama-3.1-70b-versatile">llama-3.1-70b-versatile</option>
            <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Fastest)</option>
            <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (Long context)</option>
            <option value="gemma2-9b-it">gemma2-9b-it</option>
          </select>
        </Field>

        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 text-xs text-orange-700 space-y-1">
          <p><strong>Free tier:</strong> 14,400 requests/day · 6,000 tokens/min · Get your key at <strong>console.groq.com</strong></p>
          <p>Keys look like: <code className="bg-orange-100 px-1 py-0.5 rounded font-mono">gsk_...</code></p>
        </div>
      </div>

      {/* ── Vercel Integration ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 76 65" fill="white"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z" /></svg>
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-tight">Vercel · Runtime Logs</h3>
            <p className="text-xs text-text-dim mt-0.5">Browse real deployment logs, filter by method, level, path, and more</p>
          </div>
          {settings.vercelToken && settings.vercelToken !== "••••••••" ? (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-green-600 font-bold bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">
              <Check size={10} /> Connected
            </span>
          ) : (
            <span className="ml-auto text-[10px] text-gray-400 font-bold bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">Not configured</span>
          )}
        </div>

        <Field label="Vercel Token" hint="Create a token at vercel.com/account/tokens — scope: Full Account">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type={showVercelToken ? "text" : "password"}
                value={settings.vercelToken || ""}
                onChange={(e) => { setSettings((s) => ({ ...s, vercelToken: e.target.value })); setVercelTestResult(null); }}
                placeholder="vcp_... or tok_..."
                className={cn(inputClass, "pl-10 pr-12")}
              />
              <button onClick={() => setShowVercelToken(!showVercelToken)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showVercelToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleTestVercelToken}
              disabled={testingVercel || !settings.vercelToken || settings.vercelToken === "••••••••"}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap",
                vercelTestResult === "ok"   ? "bg-brand text-black" :
                vercelTestResult === "fail" ? "bg-rose-100 text-rose-600 border border-rose-200" :
                "bg-gray-100 text-text-dim hover:bg-gray-200"
              )}
            >
              {testingVercel ? <RefreshCcw size={12} className="animate-spin" /> :
               vercelTestResult === "ok" ? "✓ Valid" :
               vercelTestResult === "fail" ? "✗ Invalid" :
               "Test"}
            </button>
          </div>
        </Field>

        <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 text-xs text-gray-300 space-y-1.5">
          <p className="text-gray-400 font-bold mb-2">How to get a Vercel token:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-400">
            <li>Go to <strong className="text-gray-200">vercel.com/account/tokens</strong></li>
            <li>Click <strong className="text-gray-200">Create Token</strong></li>
            <li>Name it (e.g. "Lumina Monitor"), scope: <strong className="text-gray-200">Full Account</strong></li>
            <li>Copy the token and paste above, then save</li>
          </ol>
          <p className="text-gray-600 mt-2">Token format: <code className="bg-gray-800 px-1 py-0.5 rounded font-mono text-[10px]">vcp_... or tok_...</code></p>
        </div>
      </div>

      {/* Gemini AI Section */}
      <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <div className="p-2 rounded-xl bg-purple-50">
            <Sparkles size={16} className="text-purple-500" />
          </div>
          <div>
            <h3 className="font-bold text-sm">AI Analysis (Gemini)</h3>
            <p className="text-xs text-text-dim mt-0.5">Required for AI-powered architecture analysis feature</p>
          </div>
        </div>

        <Field label="Gemini API Key" hint="Get your free key at aistudio.google.com → Get API Key">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Key size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type={showGeminiKey ? "text" : "password"}
                value={settings.geminiApiKey || ""}
                onChange={(e) => { setSettings((s) => ({ ...s, geminiApiKey: e.target.value })); setKeyTestResult(null); }}
                placeholder="AIza..."
                className={cn(inputClass, "pl-10 pr-12")}
              />
              <button onClick={() => setShowGeminiKey(!showGeminiKey)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showGeminiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleTestGeminiKey}
              disabled={testingKey || !settings.geminiApiKey || settings.geminiApiKey === "••••••••"}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap",
                keyTestResult === "ok" ? "bg-brand text-black" :
                keyTestResult === "fail" ? "bg-rose-100 text-rose-600 border border-rose-200" :
                "bg-gray-100 text-text-dim hover:bg-gray-200"
              )}
            >
              {testingKey ? <RefreshCcw size={12} className="animate-spin" /> :
               keyTestResult === "ok" ? "✓ Valid" :
               keyTestResult === "fail" ? "✗ Invalid" :
               "Test Key"}
            </button>
          </div>
        </Field>

        <Field label="Gemini Model" hint="gemini-2.0-flash is recommended — fast, free tier available">
          <select
            value={settings.geminiModel || "gemini-2.0-flash"}
            onChange={(e) => setSettings((s) => ({ ...s, geminiModel: e.target.value }))}
            className={cn(inputClass, "cursor-pointer")}
          >
            <option value="gemini-2.0-flash">gemini-2.0-flash (Recommended)</option>
            <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite (Faster, lighter)</option>
            <option value="gemini-2.5-flash-preview-05-20">gemini-2.5-flash-preview (Latest)</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash (Stable)</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro (Higher quality)</option>
          </select>
        </Field>

        <div className="flex items-start gap-3 bg-purple-50 border border-purple-100 rounded-xl p-4">
          <Info size={14} className="text-purple-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-purple-700 space-y-1">
            <p><strong>How to get a free Gemini API key:</strong></p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Go to <strong>aistudio.google.com</strong></li>
              <li>Sign in with your Google account</li>
              <li>Click <strong>"Get API key"</strong> → Create API key</li>
              <li>Copy and paste it above, then click <strong>Test Key</strong></li>
            </ol>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-sm">Email Notifications</h3>
            <p className="text-xs text-text-dim mt-0.5">Get alerted when projects go down or recover</p>
          </div>
          <button
            onClick={() => setSettings((s) => ({ ...s, emailEnabled: !s.emailEnabled }))}
            className={cn("transition-colors", settings.emailEnabled ? "text-brand" : "text-gray-300")}
          >
            {settings.emailEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
          </button>
        </div>

        {settings.emailEnabled && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="SMTP Host">
                <input value={settings.emailSmtpHost || ""} onChange={(e) => setSettings((s) => ({ ...s, emailSmtpHost: e.target.value }))} placeholder="smtp.gmail.com" className={inputClass} />
              </Field>
              <Field label="SMTP Port">
                <input type="number" value={settings.emailSmtpPort || 587} onChange={(e) => setSettings((s) => ({ ...s, emailSmtpPort: Number(e.target.value) }))} className={inputClass} />
              </Field>
            </div>
            <Field label="From Address">
              <input value={settings.emailFrom || ""} onChange={(e) => setSettings((s) => ({ ...s, emailFrom: e.target.value }))} placeholder="alerts@yourcompany.com" className={inputClass} />
            </Field>
            <Field label="SMTP Username">
              <input value={settings.emailUser || ""} onChange={(e) => setSettings((s) => ({ ...s, emailUser: e.target.value }))} placeholder="user@gmail.com" className={inputClass} />
            </Field>
            <Field label="SMTP Password">
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={settings.emailPass || ""}
                  onChange={(e) => setSettings((s) => ({ ...s, emailPass: e.target.value }))}
                  placeholder="App password or SMTP password"
                  className={cn(inputClass, "pr-12")}
                />
                <button onClick={() => setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700">
              <strong>Tip for Gmail:</strong> Enable 2FA on your Google account, then create an App Password at myaccount.google.com → Security → App Passwords. Use that as the SMTP password.
            </div>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-black uppercase tracking-wider transition-all",
            saved ? "bg-brand text-black" : "bg-text-main text-white hover:bg-brand hover:text-black"
          )}
        >
          {saving ? <RefreshCcw size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Check size={14} />}
          {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
        </button>
      </div>

      {/* ── Supabase Integration ── */}
      <SupabaseSettingsCard settings={settings} setSettings={setSettings} />

      {/* ── Slack Notifications ── */}
      <SlackSettingsCard settings={settings} setSettings={setSettings} />

      {/* ── General Webhook ── */}
      <WebhookSettingsCard settings={settings} setSettings={setSettings} />

      {/* ── Maintenance Windows ── */}
      <MaintenanceWindowsCard />

      {/* ── Health API Reference ── */}
      <HealthApiReference />
    </div>
  );
};

// ─── SupabaseSettingsCard ─────────────────────────────────────────────────────
const SupabaseSettingsCard = ({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}) => {
  const [showToken, setShowToken]   = useState(false);
  const [showAnon, setShowAnon]     = useState(false);
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sbProjects, setSbProjects] = useState<SbProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const inputClass = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand";

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await axios.post("/api/settings", settings);
      const res = await axios.get<SbStatus>("/api/supabase/status");
      if (res.data.project) {
        setTestResult({ ok: true, msg: `Connected to "${res.data.project.name}" — ${res.data.functionCount} function(s)` });
      } else {
        setTestResult({ ok: false, msg: res.data.error || "Could not connect" });
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleLoadProjects = async () => {
    setLoadingProjects(true);
    try {
      await axios.post("/api/settings", settings);
      const res = await axios.get<SbProject[]>("/api/supabase/projects");
      setSbProjects(Array.isArray(res.data) ? res.data : []);
    } catch {
      setSbProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  const isConfigured = !!(settings.supabaseAccessToken && settings.supabaseAccessToken !== "••••••••"
    && settings.supabaseProjectRef);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
          <svg width="18" height="18" viewBox="0 0 109 113" fill="none">
            <path d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874L63.708 110.284z" fill="white"/>
            <path d="M45.317 2.07c2.86-3.601 8.657-1.628 8.726 2.97l.442 67.251H9.283c-8.19 0-12.759-9.46-7.665-15.875L45.317 2.07z" fill="white" opacity=".8"/>
          </svg>
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">Supabase · Edge Functions</h3>
          <p className="text-xs text-text-dim mt-0.5">Auto-discover and monitor all your Supabase edge functions</p>
        </div>
        {isConfigured && testResult?.ok && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-emerald-600 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Access Token */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
            Personal Access Token
          </label>
          <div className="relative">
            <Key size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type={showToken ? "text" : "password"}
              value={settings.supabaseAccessToken || ""}
              onChange={(e) => { setSettings((s) => ({ ...s, supabaseAccessToken: e.target.value })); setTestResult(null); }}
              placeholder="sbp_..."
              className={`${inputClass} pl-10 pr-12 font-mono text-sm`}
            />
            <button onClick={() => setShowToken(!showToken)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <p className="text-[10px] text-text-dim mt-1">Get from <strong>supabase.com/dashboard/account/tokens</strong></p>
        </div>

        {/* Project Ref */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim">
              Project Reference ID
            </label>
            {settings.supabaseAccessToken && settings.supabaseAccessToken !== "••••••••" && (
              <button
                onClick={handleLoadProjects}
                disabled={loadingProjects}
                className="text-[10px] text-brand font-bold hover:underline flex items-center gap-1"
              >
                {loadingProjects ? <RefreshCcw size={9} className="animate-spin" /> : null}
                {loadingProjects ? "Loading…" : "Browse my projects →"}
              </button>
            )}
          </div>
          <input
            value={settings.supabaseProjectRef || ""}
            onChange={(e) => { setSettings((s) => ({ ...s, supabaseProjectRef: e.target.value })); setTestResult(null); }}
            placeholder="abcdefghijklmn"
            className={`${inputClass} font-mono`}
          />
          {sbProjects.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {sbProjects.map((p) => (
                <button
                  key={p.ref}
                  onClick={() => { setSettings((s) => ({ ...s, supabaseProjectRef: p.ref })); setSbProjects([]); }}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-emerald-50 text-left transition-colors"
                >
                  <div>
                    <span className="text-sm font-bold text-text-main">{p.name}</span>
                    <span className="text-xs text-text-dim ml-2 font-mono">{p.ref}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{p.region}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-text-dim mt-1">Found at <strong>Supabase Dashboard → Settings → General</strong></p>
        </div>

        {/* Anon Key */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
            Anon / Service Key <span className="text-gray-400 font-normal normal-case">(used as Bearer token when invoking functions)</span>
          </label>
          <div className="relative">
            <input
              type={showAnon ? "text" : "password"}
              value={settings.supabaseAnonKey || ""}
              onChange={(e) => setSettings((s) => ({ ...s, supabaseAnonKey: e.target.value }))}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className={`${inputClass} pr-12 font-mono text-xs`}
            />
            <button onClick={() => setShowAnon(!showAnon)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showAnon ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <p className="text-[10px] text-text-dim mt-1">Found at <strong>Supabase Dashboard → Settings → API → Project API keys</strong></p>
        </div>

        {/* Test button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={testing || !settings.supabaseAccessToken || !settings.supabaseProjectRef}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-all
              ${testResult?.ok ? "bg-emerald-500 text-white" : testResult ? "bg-rose-100 text-rose-600 border border-rose-200" : "bg-gray-900 text-white hover:bg-brand hover:text-black"}`}
          >
            {testing ? <RefreshCcw size={11} className="animate-spin" /> : testResult?.ok ? <Check size={11} /> : <Zap size={11} />}
            {testing ? "Testing…" : testResult?.ok ? "Connected!" : testResult ? "Failed" : "Test Connection"}
          </button>
          {testResult && (
            <span className={`text-xs ${testResult.ok ? "text-emerald-600" : "text-rose-500"}`}>{testResult.msg}</span>
          )}
        </div>

        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-xs text-emerald-700 space-y-1">
          <p><strong>What this enables:</strong></p>
          <ul className="list-disc list-inside space-y-0.5 text-emerald-600 ml-1">
            <li>View all edge functions in the <strong>Supabase tab</strong></li>
            <li>One-click import — adds each function as an API project</li>
            <li>Live invoke/test each function directly from Lumina</li>
            <li>Automatic JWT Bearer auth on all monitoring checks</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

// ─── SlackSettingsCard ────────────────────────────────────────────────────────
const SlackSettingsCard = ({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}) => {
  const [showUrl, setShowUrl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const inputClass = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand";

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await axios.post("/api/settings", settings);
      const res = await axios.post("/api/test-slack");
      setTestResult(res.data.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-[#4A154B] flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 54 54" fill="white">
            <path d="M19.712.133a5.381 5.381 0 00-5.376 5.387 5.381 5.381 0 005.376 5.386h5.376V5.52A5.381 5.381 0 0019.712.133m0 14.365H5.376A5.381 5.381 0 000 19.884a5.381 5.381 0 005.376 5.387h14.336a5.381 5.381 0 005.376-5.387 5.381 5.381 0 00-5.376-5.386"/>
            <path d="M53.76 19.884a5.381 5.381 0 00-5.376-5.386 5.381 5.381 0 00-5.376 5.386v5.387h5.376a5.381 5.381 0 005.376-5.387m-14.336 0V5.52A5.381 5.381 0 0034.048.133a5.381 5.381 0 00-5.376 5.387v14.364a5.381 5.381 0 005.376 5.387 5.381 5.381 0 005.376-5.387"/>
            <path d="M34.048 54a5.381 5.381 0 005.376-5.387 5.381 5.381 0 00-5.376-5.386h-5.376v5.386A5.381 5.381 0 0034.048 54m0-14.365h14.336a5.381 5.381 0 005.376-5.386 5.381 5.381 0 00-5.376-5.387H34.048a5.381 5.381 0 00-5.376 5.387 5.381 5.381 0 005.376 5.386"/>
            <path d="M0 34.249a5.381 5.381 0 005.376 5.386 5.381 5.381 0 005.376-5.386v-5.387H5.376A5.381 5.381 0 000 34.249m14.336 0v14.364A5.381 5.381 0 0019.712 54a5.381 5.381 0 005.376-5.387V34.249a5.381 5.381 0 00-5.376-5.387 5.381 5.381 0 00-5.376 5.387"/>
          </svg>
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">Slack Notifications</h3>
          <p className="text-xs text-text-dim mt-0.5">Send alerts to Slack channels when projects go down or recover</p>
        </div>
        <button
          onClick={() => setSettings((s) => ({ ...s, slackEnabled: !s.slackEnabled }))}
          className={`ml-auto transition-colors ${settings.slackEnabled ? "text-brand" : "text-gray-300"}`}
        >
          {settings.slackEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">
            Slack Incoming Webhook URL
          </label>
          <div className="relative">
            <input
              type={showUrl ? "text" : "password"}
              value={settings.slackWebhookUrl || ""}
              onChange={(e) => setSettings((s) => ({ ...s, slackWebhookUrl: e.target.value }))}
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              className={`${inputClass} pr-24 font-mono text-xs`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button onClick={() => setShowUrl(!showUrl)} className="p-1 text-gray-400 hover:text-gray-600">
                {showUrl ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !settings.slackWebhookUrl || settings.slackWebhookUrl === "••••••••"}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all
                  ${testResult === "ok" ? "bg-green-100 text-green-700" : testResult === "fail" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {testing ? <RefreshCcw size={10} className="animate-spin" /> : testResult === "ok" ? <Check size={10} /> : testResult === "fail" ? <X size={10} /> : <Zap size={10} />}
                {testing ? "Sending…" : testResult === "ok" ? "Sent!" : testResult === "fail" ? "Failed" : "Test"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(["slackChannelAlerts", "slackChannelErrors", "slackChannelDevops"] as const).map((field) => {
            const labels: Record<string, string> = {
              slackChannelAlerts: "Alerts Channel",
              slackChannelErrors: "Errors Channel",
              slackChannelDevops: "DevOps Channel",
            };
            const placeholders: Record<string, string> = {
              slackChannelAlerts: "#website-alerts",
              slackChannelErrors: "#server-errors",
              slackChannelDevops: "#devops",
            };
            return (
              <div key={field}>
                <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">{labels[field]}</label>
                <input
                  value={(settings as any)[field] || ""}
                  onChange={(e) => setSettings((s) => ({ ...s, [field]: e.target.value }))}
                  placeholder={placeholders[field]}
                  className={inputClass}
                />
              </div>
            );
          })}
        </div>

        <div className="bg-[#4A154B]/5 border border-[#4A154B]/10 rounded-xl p-4 text-xs text-[#4A154B] space-y-1">
          <p><strong>How to create a Slack webhook:</strong> Slack Dashboard → Apps → Incoming Webhooks → Add New Webhook → Choose channel → Copy URL</p>
          <p className="text-gray-500">Alerts will be sent automatically when a project changes status.</p>
        </div>
      </div>
    </div>
  );
};

// ─── WebhookSettingsCard ──────────────────────────────────────────────────────
const WebhookSettingsCard = ({
  settings,
  setSettings,
}: {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const inputClass = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand";

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await axios.post("/api/settings", settings);
      const res = await axios.post("/api/test-webhook");
      setTestResult(res.data.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
          <Webhook size={16} className="text-white" />
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">Webhook Alerts</h3>
          <p className="text-xs text-text-dim mt-0.5">POST a JSON payload to any URL when incidents are created or resolved</p>
        </div>
        <button
          onClick={() => setSettings((s) => ({ ...s, webhookEnabled: !s.webhookEnabled }))}
          className={`ml-auto transition-colors ${settings.webhookEnabled ? "text-brand" : "text-gray-300"}`}
        >
          {settings.webhookEnabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Webhook URL</label>
          <div className="flex gap-2">
            <input
              value={settings.webhookUrl || ""}
              onChange={(e) => setSettings((s) => ({ ...s, webhookUrl: e.target.value }))}
              placeholder="https://your-server.com/webhook"
              className={`${inputClass} flex-1`}
            />
            <button
              onClick={handleTest}
              disabled={testing || !settings.webhookUrl}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap
                ${testResult === "ok" ? "bg-brand text-black" : testResult === "fail" ? "bg-rose-100 text-rose-600 border border-rose-200" : "bg-gray-100 text-text-dim hover:bg-gray-200"}`}
            >
              {testing ? <RefreshCcw size={12} className="animate-spin" /> : testResult === "ok" ? "✓ Fired!" : testResult === "fail" ? "✗ Failed" : "Test"}
            </button>
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-700 space-y-2">
          <p><strong>Payload format:</strong></p>
          <pre className="font-mono text-[10px] text-indigo-600 whitespace-pre-wrap">{`{
  "event": "issue_opened" | "issue_resolved" | "test",
  "projectId": "proj_...",
  "projectName": "My Website",
  "projectUrl": "https://example.com",
  "status": "down" | "degraded" | "operational",
  "message": "HTTP 500 — Server Error",
  "uptimePct": 99.95,
  "timestamp": "2026-05-28T10:30:00.000Z"
}`}</pre>
        </div>
      </div>
    </div>
  );
};

// ─── MaintenanceWindowsCard ───────────────────────────────────────────────────

const MaintenanceWindowsCard = () => {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<MaintenanceWindow>>({
    label: "", startIso: "", endIso: "", repeat: "once", projectId: ""
  });
  const [saving, setSaving] = useState(false);

  const load = () => {
    axios.get<MaintenanceWindow[]>("/api/maintenance-windows").then((r) => setWindows(r.data));
  };

  useEffect(() => {
    load();
    axios.get<Project[]>("/api/projects").then((r) => setProjects(r.data));
  }, []);

  const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand";

  const handleAdd = async () => {
    if (!form.label || !form.startIso || !form.endIso || !form.repeat) return;
    setSaving(true);
    await axios.post("/api/maintenance-windows", { ...form, projectId: form.projectId || undefined });
    setSaving(false);
    setAdding(false);
    setForm({ label: "", startIso: "", endIso: "", repeat: "once", projectId: "" });
    load();
  };

  const handleDelete = async (id: string) => {
    await axios.delete(`/api/maintenance-windows/${id}`);
    load();
  };

  const repeat_LABELS: Record<string, string> = { once: "One-time", daily: "Daily", weekly: "Weekly" };

  const isActive = (w: MaintenanceWindow) => {
    const now = new Date();
    const start = new Date(w.startIso);
    const end = new Date(w.endIso);
    if (w.repeat === "once") return now >= start && now <= end;
    return false;
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-8 space-y-5">
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-tight">Maintenance Windows</h3>
            <p className="text-xs text-text-dim mt-0.5">Suppress alerts during scheduled maintenance or deployments</p>
          </div>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-3 py-2 bg-brand text-black text-xs font-black rounded-xl hover:bg-black hover:text-brand transition-all"
        >
          <Plus size={12} /> Add Window
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4">
          <p className="text-xs font-black uppercase tracking-wider text-amber-700">New Maintenance Window</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-bold text-text-dim mb-1.5">Label</label>
              <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Weekly DB Backup" className={inputClass} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-text-dim mb-1.5">Start</label>
              <input type="datetime-local" value={form.startIso} onChange={(e) => setForm((f) => ({ ...f, startIso: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-text-dim mb-1.5">End</label>
              <input type="datetime-local" value={form.endIso} onChange={(e) => setForm((f) => ({ ...f, endIso: e.target.value }))} className={inputClass} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-text-dim mb-1.5">Repeat</label>
              <select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as any }))} className={inputClass}>
                <option value="once">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-text-dim mb-1.5">Project (optional)</label>
              <select value={form.projectId || ""} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value || "" }))} className={inputClass}>
                <option value="">All Projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleAdd} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-brand text-black text-xs font-black rounded-xl hover:opacity-90 transition-all">
              {saving ? <RefreshCcw size={11} className="animate-spin" /> : <Check size={11} />}
              {saving ? "Saving…" : "Save Window"}
            </button>
            <button onClick={() => setAdding(false)} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-black rounded-xl hover:bg-gray-200 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Window list */}
      {windows.length === 0 && !adding ? (
        <p className="text-sm text-text-dim text-center py-4">No maintenance windows configured</p>
      ) : (
        <div className="space-y-2">
          {windows.map((w) => {
            const proj = projects.find((p) => p.id === w.projectId);
            const active = isActive(w);
            return (
              <div key={w.id} className={`flex items-center justify-between p-4 rounded-xl border ${active ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-100"}`}>
                <div className="flex items-center gap-3">
                  {active && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{w.label}</span>
                      <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-bold">{repeat_LABELS[w.repeat]}</span>
                      {active && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black">ACTIVE</span>}
                    </div>
                    <p className="text-xs text-text-dim mt-0.5">
                      {new Date(w.startIso).toLocaleString()} → {new Date(w.endIso).toLocaleString()}
                      {proj && <span className="ml-2 text-blue-500">· {proj.name}</span>}
                      {!w.projectId && <span className="ml-2 text-gray-400">· All projects</span>}
                    </p>
                  </div>
                </div>
                <button onClick={() => handleDelete(w.id)} className="p-2 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 transition-all">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── HealthApiReference ───────────────────────────────────────────────────────
const HealthApiReference = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [liveHealth, setLiveHealth] = useState<Record<string, unknown> | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    axios.get<Project[]>("/api/projects").then((r) => setProjects(r.data));
  }, []);

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const fetchHealth = async () => {
    setLoadingHealth(true);
    try {
      const r = await axios.get("/api/health");
      setLiveHealth(r.data);
    } catch {
      setLiveHealth({ error: "Could not reach /api/health" });
    } finally {
      setLoadingHealth(false);
    }
  };

  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";

  const endpoints: { method: string; path: string; desc: string; note?: string; tag: string }[] = [
    { method: "GET", path: "/health",           desc: "Liveness probe — returns 200 if healthy, 503 if any project is down", tag: "system",  note: "Kubernetes / uptime-monitor friendly" },
    { method: "GET", path: "/api/health",        desc: "Detailed monitor health — uptime, memory, ws clients, project counts", tag: "system" },
    { method: "GET", path: "/api/health/:id",    desc: "Per-project health check — status, uptime %, last response, SSL days", tag: "project", note: "Returns 503 when project is down" },
    { method: "GET", path: "/api/uptime",        desc: "Uptime summary for all projects with last response times",             tag: "project" },
    { method: "GET", path: "/api/badge/:id",     desc: "Shields.io-compatible JSON badge for any project",                    tag: "badge",   note: "Use with img.shields.io/endpoint" },
    { method: "GET", path: "/api/badge/:id/svg", desc: "Inline SVG status badge — embed directly in HTML or README",          tag: "badge" },
    { method: "GET", path: "/api/status",        desc: "Public status summary — all projects + open issues",                  tag: "system" },
    { method: "GET", path: "/api/logs",          desc: "Recent monitoring logs with project names (?limit=N)",                tag: "system" },
  ];

  const TAG_COLORS: Record<string, string> = {
    system:  "bg-blue-100 text-blue-700",
    project: "bg-purple-100 text-purple-700",
    badge:   "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="bg-white border border-border-theme rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-theme bg-gray-50/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
            <Activity size={14} className="text-white" />
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-tight">Health API Reference</h3>
            <p className="text-[11px] text-text-dim">Endpoints your monitoring agents can call</p>
          </div>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loadingHealth}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white text-[11px] font-bold rounded-lg hover:bg-brand hover:text-black transition-all"
        >
          {loadingHealth ? <RefreshCcw size={11} className="animate-spin" /> : <Zap size={11} />}
          Test /api/health
        </button>
      </div>

      {/* Live result */}
      {liveHealth && (
        <div className="px-6 py-3 bg-gray-950 border-b border-gray-800 font-mono text-[11px]">
          <div className="flex items-center gap-2 mb-2">
            <span className={cn("w-2 h-2 rounded-full", (liveHealth as any).status === "healthy" ? "bg-green-400" : "bg-red-400")} />
            <span className={cn("font-bold text-[10px] uppercase", (liveHealth as any).status === "healthy" ? "text-green-400" : "text-red-400")}>{String((liveHealth as any).status)}</span>
            <span className="text-gray-600 ml-auto text-[10px]">GET /api/health → 200</span>
          </div>
          <pre className="text-gray-300 leading-5 whitespace-pre-wrap text-[10px]">{JSON.stringify(liveHealth, null, 2)}</pre>
        </div>
      )}

      {/* Endpoint list */}
      <div className="divide-y divide-border-theme">
        {endpoints.map((ep) => {
          const url = `${base}${ep.path}`;
          const ck  = ep.path;
          return (
            <div key={ep.path} className="flex items-start gap-4 px-6 py-3 hover:bg-gray-50/50 transition-colors group">
              {/* Method badge */}
              <span className="shrink-0 mt-0.5 w-12 text-center py-0.5 rounded text-[10px] font-black bg-gray-900 text-white">{ep.method}</span>

              {/* Path + desc */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-[12px] font-mono font-bold text-text-main">{ep.path}</code>
                  <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full", TAG_COLORS[ep.tag])}>{ep.tag}</span>
                </div>
                <p className="text-[11px] text-text-dim mt-0.5">{ep.desc}</p>
                {ep.note && <p className="text-[10px] text-amber-600 mt-0.5 font-medium">ℹ {ep.note}</p>}
              </div>

              {/* Copy URL */}
              <button
                onClick={() => copy(ck, url)}
                title="Copy URL"
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono rounded-lg border border-border-theme bg-white hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all opacity-0 group-hover:opacity-100"
              >
                {copiedKey === ck ? <Check size={10} className="text-brand" /> : <Copy size={10} />}
                {copiedKey === ck ? "Copied!" : "Copy URL"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Per-project quick links */}
      {projects.length > 0 && (
        <div className="px-6 py-4 border-t border-border-theme bg-gray-50/30">
          <p className="text-[10px] font-black uppercase tracking-wider text-text-dim mb-3">Quick Links — Your Projects</p>
          <div className="flex flex-wrap gap-2">
            {projects.map((p) => {
              const statusColor = p.status === "operational" ? "bg-green-100 text-green-700 border-green-200" : p.status === "down" ? "bg-red-100 text-red-700 border-red-200" : "bg-yellow-100 text-yellow-700 border-yellow-200";
              return (
                <div key={p.id} className="flex items-center gap-0 rounded-lg overflow-hidden border border-border-theme text-[10px] font-mono">
                  <span className={cn("px-2 py-1 font-bold", statusColor)}>{p.status === "operational" ? "●" : p.status === "down" ? "✕" : "◐"}</span>
                  <span className="px-2 py-1 bg-white font-bold text-text-main border-l border-border-theme">{p.name}</span>
                  <button
                    onClick={() => copy(`h-${p.id}`, `${base}/api/health/${p.id}`)}
                    className="px-2 py-1 bg-gray-100 hover:bg-gray-900 hover:text-white text-gray-500 border-l border-border-theme transition-colors"
                    title={`${base}/api/health/${p.id}`}
                  >
                    {copiedKey === `h-${p.id}` ? <Check size={9} className="text-brand" /> : <Copy size={9} />}
                  </button>
                  <button
                    onClick={() => { window.open(`${base}/api/badge/${p.id}/svg`, "_blank"); }}
                    className="px-2 py-1 bg-gray-100 hover:bg-gray-900 hover:text-white text-gray-500 border-l border-border-theme transition-colors"
                    title="View SVG badge"
                  >
                    <ExternalLink size={9} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── ConsoleView ──────────────────────────────────────────────────────────────

// ─── DbHealthChecker ──────────────────────────────────────────────────────────

interface DbCheckResult {
  connected: boolean;
  host: string;
  port: number;
  dbType: string;
  tlsEnabled: boolean;
  healthStatus: "healthy" | "degraded" | "slow" | "critical" | "down";
  healthMsg: string;
  avgLatency: number | null;
  minLatency: number | null;
  maxLatency: number | null;
  pingCount: number;
  latencies: number[];
  error: string | null;
  recommendations: string[];
  httpHealth: { url: string; status: number; ok: boolean; latency: number } | null;
}

const DB_PRESETS = [
  { label: "PostgreSQL",     placeholder: "postgresql://host:5432",  icon: "🐘" },
  { label: "MySQL",          placeholder: "mysql://host:3306",        icon: "🐬" },
  { label: "MongoDB",        placeholder: "mongodb://host:27017",     icon: "🍃" },
  { label: "Redis",          placeholder: "redis://host:6379",        icon: "🔴" },
  { label: "SQL Server",     placeholder: "mssql://host:1433",        icon: "🪟" },
  { label: "Supabase",       placeholder: "postgresql://db.ref.supabase.co:5432", icon: "⚡" },
];

const DbHealthChecker = () => {
  const [url, setUrl]             = useState("");
  const [checking, setChecking]   = useState(false);
  const [result, setResult]       = useState<DbCheckResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [savedProjects, setSaved] = useState<Project[]>([]);

  useEffect(() => {
    axios.get<Project[]>("/api/projects")
      .then((r) => setSaved(r.data.filter((p) => p.type === "database")));
  }, []);

  const check = async (checkUrl?: string) => {
    const target = checkUrl || url.trim();
    if (!target) return;
    setUrl(target);
    setChecking(true);
    setResult(null);
    setError(null);
    try {
      const res = await axios.post<DbCheckResult>("/api/db-check", { url: target });
      setResult(res.data);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || "Check failed");
    } finally {
      setChecking(false);
    }
  };

  const statusColor = (s: DbCheckResult["healthStatus"]) =>
    s === "healthy"  ? "text-brand"     :
    s === "degraded" ? "text-amber-500" :
    s === "slow"     ? "text-orange-500":
    s === "critical" ? "text-rose-600"  :
    "text-rose-500";

  const statusBg = (s: DbCheckResult["healthStatus"]) =>
    s === "healthy"  ? "bg-brand/10 border-brand/20"         :
    s === "degraded" ? "bg-amber-50 border-amber-200"        :
    s === "slow"     ? "bg-orange-50 border-orange-200"      :
    s === "critical" ? "bg-rose-100 border-rose-300"         :
    "bg-rose-50 border-rose-200";

  const latBar = (ms: number | null, max = 1000) =>
    ms !== null ? Math.min(100, (ms / max) * 100) : 0;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
          <Database size={16} className="text-white" />
        </div>
        <div>
          <h3 className="font-black text-sm uppercase tracking-tight">Database Health Check</h3>
          <p className="text-xs text-text-dim mt-0.5">Test connectivity, measure latency, get recommendations</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Quick-pick presets */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Quick select DB type</p>
          <div className="flex flex-wrap gap-2">
            {DB_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setUrl(p.placeholder)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all",
                  url === p.placeholder
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-text-dim border-gray-200 hover:border-gray-400 hover:text-text-main"
                )}
              >
                <span>{p.icon}</span> {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Connection string input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Database size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && check()}
              placeholder="postgresql://host:5432  or  mysql://user:pass@host:3306/db  or  host:6379"
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <button
            onClick={() => check()}
            disabled={checking || !url.trim()}
            className={cn(
              "flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-black uppercase tracking-wide transition-all whitespace-nowrap",
              checking ? "bg-gray-100 text-text-dim" : "bg-brand text-black hover:bg-black hover:text-brand"
            )}
          >
            {checking ? <RefreshCcw size={14} className="animate-spin" /> : <Zap size={14} />}
            {checking ? "Checking…" : "Check DB"}
          </button>
        </div>

        {/* Monitored databases quick-check */}
        {savedProjects.length > 0 && (
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">Or check a monitored database</p>
            <div className="flex flex-wrap gap-2">
              {savedProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => check(p.url)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all bg-white border-gray-200 hover:border-emerald-400 hover:text-emerald-600"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full",
                    p.status === "operational" ? "bg-brand" : p.status === "degraded" ? "bg-amber-400" : "bg-rose-500"
                  )} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={cn("border rounded-2xl overflow-hidden", statusBg(result.healthStatus))}>
            {/* Status banner */}
            <div className={cn("flex items-center justify-between px-5 py-4 border-b", statusBg(result.healthStatus))}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">
                  {result.healthStatus === "healthy" ? "✅" :
                   result.healthStatus === "degraded" ? "⚠️" :
                   result.healthStatus === "slow"     ? "🐢" :
                   result.healthStatus === "critical" ? "🔥" : "❌"}
                </span>
                <div>
                  <p className={cn("font-black text-sm uppercase", statusColor(result.healthStatus))}>
                    {result.dbType} — {result.healthStatus.toUpperCase()}
                  </p>
                  <p className="text-xs text-text-dim mt-0.5">{result.healthMsg}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-text-dim font-mono">{result.host}:{result.port}</p>
                <div className="flex items-center gap-1.5 mt-0.5 justify-end">
                  {result.tlsEnabled && (
                    <span className="text-[9px] bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full font-bold">TLS</span>
                  )}
                  <span className="text-[9px] text-text-dim">{result.pingCount} pings</span>
                </div>
              </div>
            </div>

            <div className="p-5 bg-white space-y-5">
              {/* Latency cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Avg Latency", val: result.avgLatency, unit: "ms" },
                  { label: "Min Latency", val: result.minLatency, unit: "ms" },
                  { label: "Max Latency", val: result.maxLatency, unit: "ms" },
                ].map(({ label, val, unit }) => (
                  <div key={label} className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-center">
                    <div className={cn("text-2xl font-black",
                      val === null ? "text-gray-300" :
                      val > 500   ? "text-rose-500" :
                      val > 200   ? "text-amber-500" : "text-brand"
                    )}>
                      {val !== null ? val : "—"}{val !== null ? <span className="text-sm font-bold">{unit}</span> : ""}
                    </div>
                    <div className="text-[9px] text-text-dim uppercase font-bold mt-1">{label}</div>
                  </div>
                ))}
              </div>

              {/* Latency visual bar */}
              {result.connected && result.latencies.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-text-dim mb-2">
                    Ping latency across {result.pingCount} checks
                  </p>
                  <div className="space-y-2">
                    {result.latencies.map((lat, i) => {
                      const pct = latBar(lat, Math.max(...result.latencies, 500));
                      const clr = lat > 500 ? "bg-rose-400" : lat > 200 ? "bg-amber-400" : "bg-brand";
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-[10px] text-text-dim w-10 text-right font-mono shrink-0">Ping {i + 1}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className={cn("h-2 rounded-full transition-all", clr)} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={cn("text-[10px] font-black w-14 font-mono shrink-0",
                            lat > 500 ? "text-rose-500" : lat > 200 ? "text-amber-500" : "text-brand"
                          )}>{lat}ms</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* HTTP health (for hosted DBs like Supabase) */}
              {result.httpHealth && (
                <div className={cn("rounded-xl p-4 border", result.httpHealth.ok ? "bg-brand/5 border-brand/20" : "bg-rose-50 border-rose-200")}>
                  <p className="text-[10px] font-black uppercase tracking-wider text-text-dim mb-2">HTTP Health Endpoint</p>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-full border",
                      result.httpHealth.ok ? "bg-brand/10 text-brand border-brand/20" : "bg-rose-100 text-rose-600 border-rose-200"
                    )}>
                      HTTP {result.httpHealth.status}
                    </span>
                    <span className="text-xs text-text-dim font-mono flex-1 truncate">{result.httpHealth.url}</span>
                    <span className="text-xs font-bold text-text-dim">{result.httpHealth.latency}ms</span>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {result.recommendations.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 mb-3">
                    💡 Recommendations
                  </p>
                  {result.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5 shrink-0">→</span>
                      <span className="text-xs text-blue-700">{rec}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Guide */}
        {!result && !checking && (
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                icon: "🔌",
                title: "TCP Port Check",
                desc: "Tests if the DB port is reachable. Catches: service down, firewall blocks, DNS failures.",
                example: "postgresql://host:5432",
              },
              {
                icon: "📡",
                title: "3-Ping Latency",
                desc: "Runs 3 consecutive connection tests to measure avg/min/max latency.",
                example: "mysql://host:3306",
              },
              {
                icon: "🏥",
                title: "HTTP Health (Hosted DBs)",
                desc: "For Supabase/Neon/PlanetScale — also probes their HTTP health endpoint.",
                example: "https://ref.supabase.co/...",
              },
            ].map(({ icon, title, desc, example }) => (
              <div key={title} className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2">
                <span className="text-2xl">{icon}</span>
                <p className="text-xs font-black text-text-main">{title}</p>
                <p className="text-[11px] text-text-dim leading-relaxed">{desc}</p>
                <code className="text-[10px] text-brand bg-brand/5 px-2 py-1 rounded block font-mono break-all">{example}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── HealthDashboard ──────────────────────────────────────────────────────────

interface HealthRow {
  projectId: string; name: string; url: string; type: string;
  status: string; lastChecked: number | null; lastSuccess: number | null;
  avgLatency: number | null; p50Latency: number | null; p95Latency: number | null;
  uptimePct: number; uptimeLast20: number | null;
  errorCount: number; retryCount: number; checkCount: number;
  lastStatusCode: number | null; sslDaysLeft: number | null;
  openIssue: { id: string; severity: string; message: string; startedAt: number } | null;
  checkType: string;
}

interface HealthTableData {
  rows: HealthRow[];
  summary: { healthy: number; degraded: number; down: number; total: number; avgUptime: number };
}

const HealthDashboard = () => {
  const [data, setData]               = useState<HealthTableData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [sortBy, setSortBy]           = useState<keyof HealthRow>("status");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [rowHist, setRowHist]         = useState<Record<string, any[]>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await axios.get<HealthTableData>("/api/health-table");
      setData(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const iv = autoRefresh ? setInterval(load, 30000) : null;
    return () => { if (iv) clearInterval(iv); };
  }, [autoRefresh, load]);

  const fetchHist = async (id: string) => {
    if (rowHist[id]) return;
    try {
      const r = await axios.get<any[]>(`/api/health-records?projectId=${id}&limit=50`);
      setRowHist((h) => ({ ...h, [id]: r.data }));
    } catch { /* ignore */ }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => { if (prev === id) return null; fetchHist(id); return id; });
  };

  const handleSort = (col: keyof HealthRow) => {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const rows = data?.rows ?? [];
  const filtered = rows
    .filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !r.url.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      let av: any = a[sortBy]; let bv: any = b[sortBy];
      if (av == null) av = sortDir === "asc" ? 1e12 : -1e12;
      if (bv == null) bv = sortDir === "asc" ? 1e12 : -1e12;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

  const s = data?.summary;
  const latClr = (ms: number | null) =>
    ms === null ? "text-gray-400" : ms > 3000 ? "text-rose-500" : ms > 1000 ? "text-amber-500" : "text-brand";
  const stBg = (st: string) =>
    st === "operational" ? "bg-brand/10 text-brand border-brand/20"
    : st === "degraded"  ? "bg-amber-50 text-amber-600 border-amber-200"
    : st === "down"      ? "bg-rose-50 text-rose-600 border-rose-200"
    : "bg-gray-50 text-gray-400 border-gray-200";

  const SortTh = ({ col, label }: { col: keyof HealthRow; label: string }) => (
    <th className="px-3 py-3 text-left">
      <button onClick={() => handleSort(col)} className="flex items-center gap-0.5 text-[10px] font-black uppercase tracking-widest text-text-dim hover:text-text-main whitespace-nowrap">
        {label}
        <span className={cn("ml-0.5 text-[9px]", sortBy === col ? "opacity-100" : "opacity-20")}>
          {sortBy === col ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCcw size={22} className="animate-spin text-brand" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Health Dashboard</h2>
          <p className="text-sm text-text-dim mt-0.5">Operational metrics — database · edge functions · all services</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-all",
              autoRefresh ? "bg-brand/10 text-brand border-brand/20" : "bg-gray-100 text-gray-400 border-gray-200"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", autoRefresh ? "bg-brand animate-pulse" : "bg-gray-400")} />
            {autoRefresh ? "Live · 30s" : "Paused"}
          </button>
          <button onClick={load} className="p-2 rounded-xl text-text-dim hover:bg-gray-100 transition-all">
            <RefreshCcw size={14} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total",    val: s.total,    clr: "text-text-main", bdr: "border-gray-100" },
            { label: "Healthy",  val: s.healthy,  clr: "text-brand",     bdr: "border-brand/20" },
            { label: "Degraded", val: s.degraded, clr: "text-amber-500", bdr: "border-amber-200" },
            { label: "Down",     val: s.down,     clr: "text-rose-500",  bdr: "border-rose-200" },
          ].map(({ label, val, clr, bdr }) => (
            <div key={label} className={cn("bg-white rounded-2xl p-5 text-center border", bdr)}>
              <div className={cn("text-3xl font-black", clr)}>{val}</div>
              <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">{label}</div>
            </div>
          ))}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
            <div className={cn("text-3xl font-black", s.avgUptime >= 99 ? "text-brand" : s.avgUptime >= 95 ? "text-amber-500" : "text-rose-500")}>
              {s.avgUptime.toFixed(1)}%
            </div>
            <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Avg Uptime</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services…"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex gap-1.5">
          {["all", "operational", "degraded", "down"].map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={cn("px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-all",
                statusFilter === f
                  ? f === "all" ? "bg-gray-900 text-white border-gray-900"
                  : f === "operational" ? "bg-brand/10 text-brand border-brand/30"
                  : f === "degraded" ? "bg-amber-50 text-amber-600 border-amber-200"
                  : "bg-rose-50 text-rose-600 border-rose-200"
                  : "bg-white text-text-dim border-gray-200 hover:border-gray-400"
              )}
            >
              {f === "operational" ? "healthy" : f}
              {f !== "all" && s ? ` (${s[f === "operational" ? "healthy" : f as "degraded" | "down"]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Health Table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <SortTh col="name" label="Service" />
                <SortTh col="status" label="Status" />
                <SortTh col="checkType" label="Check" />
                <SortTh col="avgLatency" label="Avg Lat" />
                <SortTh col="p95Latency" label="P95" />
                <SortTh col="uptimePct" label="Uptime" />
                <SortTh col="errorCount" label="Errors/20" />
                <SortTh col="retryCount" label="Retries" />
                <SortTh col="lastChecked" label="Checked" />
                <SortTh col="lastSuccess" label="Last OK" />
                <th className="px-3 py-3 w-7" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-16 text-text-dim text-sm">
                    {rows.length === 0
                      ? "No health data yet — monitoring checks populate this table automatically."
                      : "No services match the current filter."}
                  </td>
                </tr>
              ) : filtered.map((row) => {
                const isExp = expandedId === row.projectId;
                const hist  = rowHist[row.projectId] ?? [];
                return (
                  <React.Fragment key={row.projectId}>
                    <tr
                      onClick={() => toggleExpand(row.projectId)}
                      className="hover:bg-gray-50/60 cursor-pointer transition-colors"
                    >
                      {/* Service */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="relative flex h-2 w-2 shrink-0">
                            {row.status !== "operational" && row.status !== "unknown" && (
                              <span className={cn("animate-ping absolute inset-0 rounded-full opacity-60", row.status === "down" ? "bg-rose-500" : "bg-amber-400")} />
                            )}
                            <span className={cn("relative rounded-full h-2 w-2",
                              row.status === "operational" ? "bg-brand" : row.status === "degraded" ? "bg-amber-400" : row.status === "down" ? "bg-rose-500" : "bg-gray-300"
                            )} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate max-w-[150px]">{row.name}</p>
                            <p className="text-[10px] text-text-dim font-mono truncate max-w-[150px]">{row.url}</p>
                          </div>
                        </div>
                      </td>
                      {/* Status */}
                      <td className="px-3 py-3">
                        <span className={cn("inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase border", stBg(row.status))}>
                          {row.status}
                        </span>
                        {row.openIssue && (
                          <p className="text-[9px] text-rose-500 font-bold mt-0.5">
                            {row.openIssue.severity} · {timeAgo(row.openIssue.startedAt)}
                          </p>
                        )}
                      </td>
                      {/* Check type */}
                      <td className="px-3 py-3">
                        <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full border",
                          row.checkType === "http" ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-purple-50 text-purple-600 border-purple-200"
                        )}>{row.checkType}</span>
                      </td>
                      {/* Latencies */}
                      <td className={cn("px-3 py-3 text-sm font-bold font-mono", latClr(row.avgLatency))}>
                        {row.avgLatency !== null ? `${row.avgLatency}ms` : "—"}
                      </td>
                      <td className={cn("px-3 py-3 text-sm font-bold font-mono", latClr(row.p95Latency))}>
                        {row.p95Latency !== null ? `${row.p95Latency}ms` : "—"}
                      </td>
                      {/* Uptime */}
                      <td className="px-3 py-3">
                        <span className={cn("text-sm font-black",
                          row.uptimePct >= 99 ? "text-brand" : row.uptimePct >= 95 ? "text-amber-500" : "text-rose-500"
                        )}>{row.uptimePct.toFixed(1)}%</span>
                        {row.uptimeLast20 !== null && (
                          <span className="text-[9px] text-text-dim ml-1">({row.uptimeLast20.toFixed(0)}%)</span>
                        )}
                      </td>
                      {/* Error count */}
                      <td className="px-3 py-3">
                        <span className={cn("text-sm font-black",
                          row.errorCount > 3 ? "text-rose-500" : row.errorCount > 0 ? "text-amber-500" : "text-brand"
                        )}>{row.errorCount}</span>
                      </td>
                      {/* Retry count */}
                      <td className="px-3 py-3">
                        <span className={cn("text-sm font-mono",
                          row.retryCount > 0 ? "text-rose-500 font-black" : "text-text-dim"
                        )}>{row.retryCount}</span>
                      </td>
                      {/* Times */}
                      <td className="px-3 py-3 text-xs text-text-dim whitespace-nowrap">
                        {row.lastChecked ? timeAgo(row.lastChecked) : "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-text-dim whitespace-nowrap">
                        {row.lastSuccess ? timeAgo(row.lastSuccess) : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <ChevronDown size={13} className={cn("text-text-dim transition-transform", isExp && "rotate-180")} />
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExp && (
                      <tr key={`${row.projectId}-exp`}>
                        <td colSpan={11} className="px-4 pb-5 bg-gray-50/40">
                          <div className="grid grid-cols-4 gap-3 pt-3 mb-4">
                            {[
                              { label: "Total Checks", val: String(row.checkCount), clr: "text-text-main" },
                              { label: "P50 Latency",  val: row.p50Latency !== null ? `${row.p50Latency}ms` : "—", clr: latClr(row.p50Latency) },
                              { label: "Last Status",  val: row.lastStatusCode ? `HTTP ${row.lastStatusCode}` : row.checkType === "tcp" ? (row.status === "operational" ? "Port Open" : "Closed") : "—", clr: "text-text-main" },
                              { label: "SSL Days",     val: row.sslDaysLeft !== null ? `${row.sslDaysLeft}d` : "N/A", clr: row.sslDaysLeft !== null ? (row.sslDaysLeft < 14 ? "text-rose-500" : row.sslDaysLeft < 30 ? "text-amber-500" : "text-brand") : "text-gray-300" },
                            ].map(({ label, val, clr }) => (
                              <div key={label} className="bg-white border border-gray-100 rounded-xl p-3 text-center">
                                <div className={cn("text-xl font-black", clr)}>{val}</div>
                                <div className="text-[9px] text-text-dim uppercase font-bold mt-0.5">{label}</div>
                              </div>
                            ))}
                          </div>

                          {/* Latency sparkline */}
                          {hist.length > 0 && (
                            <div className="bg-white border border-gray-100 rounded-xl p-4">
                              <p className="text-[10px] font-black uppercase tracking-wider text-text-dim mb-2">
                                Response time · last {hist.length} checks <span className="font-normal text-gray-400">(height = latency, colour = status)</span>
                              </p>
                              <div className="flex gap-px h-10 items-end">
                                {[...hist].reverse().slice(0, 50).map((r: any, i: number) => (
                                  <div
                                    key={i}
                                    title={`${r.status} · ${r.responseTime}ms`}
                                    style={{ height: r.responseTime ? `${Math.min(100, (r.responseTime / 3000) * 100)}%` : "10%" }}
                                    className={cn("flex-1 rounded-sm min-h-[3px]",
                                      r.status === "operational" ? "bg-brand/60" : r.status === "degraded" ? "bg-amber-400/70" : "bg-rose-500/70"
                                    )}
                                  />
                                ))}
                              </div>
                              <div className="flex justify-between mt-1">
                                <span className="text-[9px] text-text-dim">Older</span>
                                <span className="text-[9px] text-text-dim">Latest</span>
                              </div>
                            </div>
                          )}

                          {/* Open issue */}
                          {row.openIssue && (
                            <div className="mt-3 bg-rose-50 border border-rose-100 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-600">
                                  {row.openIssue.severity}
                                </span>
                                <span className="text-[10px] text-rose-500 font-bold">
                                  Open since {timeAgo(row.openIssue.startedAt)}
                                </span>
                              </div>
                              <p className="text-xs text-rose-700 leading-relaxed">{row.openIssue.message}</p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 flex-wrap text-[10px] text-text-dim">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand" />Healthy</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Degraded — slow or intermittent</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" />Down — consecutive failures confirmed</span>
        <span><span className="font-mono bg-gray-100 px-1 rounded">P95</span> 95th-percentile response time</span>
        <span><span className="font-mono bg-gray-100 px-1 rounded">Errors/20</span> failures in last 20 checks</span>
        <span><span className="font-mono bg-gray-100 px-1 rounded">Retries</span> consecutive unconfirmed failures</span>
      </div>

      {/* Database Health Checker */}
      <DbHealthChecker />
    </div>
  );
};

// ─── SupabaseView ─────────────────────────────────────────────────────────────

interface SbFunction {
  id: string;
  slug: string;
  name: string;
  status: string;
  version: number;
  verify_jwt: boolean;
  created_at: string;
  updated_at: string;
  import_map: boolean;
}

interface SbProject {
  id: string;
  ref: string;
  name: string;
  region: string;
  status: string;
}

interface SbStatus {
  configured: boolean;
  hasRef?: boolean;
  project?: { name: string; ref: string; region: string; status: string };
  functionCount?: number;
  error?: string;
  reason?: string;
}

const SupabaseView = () => {
  const [status, setStatus]       = useState<SbStatus | null>(null);
  const [functions, setFunctions] = useState<SbFunction[]>([]);
  const [allProjects, setAllProjects] = useState<SbProject[]>([]);
  const [loading, setLoading]     = useState(true);
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [imported, setImported]   = useState<Set<string>>(new Set());
  const [invoking, setInvoking]   = useState<string | null>(null);
  const [invokeResult, setInvokeResult] = useState<Record<string, any>>({});
  const [search, setSearch]       = useState("");
  const [importAll, setImportAll] = useState(false);
  const [existingUrls, setExistingUrls] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const [st, fns, monProjects] = await Promise.all([
        axios.get<SbStatus>("/api/supabase/status"),
        axios.get<SbFunction[]>("/api/supabase/functions").catch(() => ({ data: [] })),
        axios.get<Project[]>("/api/projects"),
      ]);
      setStatus(st.data);
      setFunctions(Array.isArray(fns.data) ? fns.data : []);
      setExistingUrls(new Set(monProjects.data.map((p) => p.url)));
    } catch {
      setStatus({ configured: false, reason: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleImport = async (slugs: string[]) => {
    slugs.forEach((s) => setImporting((prev) => new Set([...prev, s])));
    try {
      const res = await axios.post<{ ok: boolean; imported: string[] }>("/api/supabase/import", { functionNames: slugs });
      res.data.imported.forEach((s) => {
        setImported((prev) => new Set([...prev, s]));
        setImporting((prev) => { const n = new Set(prev); n.delete(s); return n; });
      });
    } catch {
      slugs.forEach((s) => setImporting((prev) => { const n = new Set(prev); n.delete(s); return n; }));
    }
    await load();
  };

  const handleInvoke = async (slug: string) => {
    setInvoking(slug);
    try {
      const res = await axios.post<any>(`/api/supabase/invoke/${slug}`, {});
      setInvokeResult((prev) => ({ ...prev, [slug]: res.data }));
    } catch (e: any) {
      setInvokeResult((prev) => ({ ...prev, [slug]: { error: e.message } }));
    } finally {
      setInvoking(null);
    }
  };

  const filtered = functions.filter((f) =>
    !search || f.slug.toLowerCase().includes(search.toLowerCase()) || f.name.toLowerCase().includes(search.toLowerCase())
  );

  const ref = status?.project?.ref || "";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCcw size={24} className="animate-spin text-brand" />
      </div>
    );
  }

  if (!status?.configured || !status?.hasRef) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 109 113" fill="none">
            <path d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874L63.708 110.284z" fill="#3ECF8E"/>
            <path d="M45.317 2.07c2.86-3.601 8.657-1.628 8.726 2.97l.442 67.251H9.283c-8.19 0-12.759-9.46-7.665-15.875L45.317 2.07z" fill="#3ECF8E" opacity=".7"/>
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-black">Connect Supabase</h2>
          <p className="text-sm text-text-dim mt-2">Add your Supabase access token and project ref in Settings to auto-discover all edge functions.</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-left space-y-3 text-sm">
          <p className="font-bold text-xs uppercase tracking-wider text-text-dim">How to connect:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-text-main">
            <li>Go to <strong>supabase.com/dashboard/account/tokens</strong></li>
            <li>Click <strong>Generate new token</strong> → copy it</li>
            <li>Find your <strong>Project Ref</strong> at Settings → General</li>
            <li>Paste both into <strong>Settings → Supabase</strong> in Lumina</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 109 113" fill="none">
              <path d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874L63.708 110.284z" fill="white"/>
              <path d="M45.317 2.07c2.86-3.601 8.657-1.628 8.726 2.97l.442 67.251H9.283c-8.19 0-12.759-9.46-7.665-15.875L45.317 2.07z" fill="white" opacity=".8"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight">Supabase Edge Functions</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-text-dim font-mono">{status.project?.name}</span>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">{status.project?.ref}</span>
              <span className="text-[10px] text-gray-400">{status.project?.region}</span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${status.project?.status === "ACTIVE_HEALTHY" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                {status.project?.status?.replace("_", " ") || "Unknown"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-xl text-text-dim hover:text-text-main hover:bg-gray-100 transition-all">
            <RefreshCcw size={14} />
          </button>
          {filtered.length > 0 && (
            <button
              onClick={async () => {
                setImportAll(true);
                const toImport = filtered.filter((f) => {
                  const url = `https://${ref}.supabase.co/functions/v1/${f.slug}`;
                  return !existingUrls.has(url) && !imported.has(f.slug);
                }).map((f) => f.slug);
                if (toImport.length) await handleImport(toImport);
                setImportAll(false);
              }}
              disabled={importAll}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-xs font-black rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50"
            >
              {importAll ? <RefreshCcw size={11} className="animate-spin" /> : <Plus size={11} />}
              Import All ({filtered.filter((f) => !existingUrls.has(`https://${ref}.supabase.co/functions/v1/${f.slug}`) && !imported.has(f.slug)).length})
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
          <div className="text-3xl font-black text-text-main">{functions.length}</div>
          <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Edge Functions</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
          <div className="text-3xl font-black text-emerald-500">
            {functions.filter((f) => f.status === "ACTIVE").length}
          </div>
          <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Active</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
          <div className="text-3xl font-black text-blue-500">
            {functions.filter((f) => {
              const url = `https://${ref}.supabase.co/functions/v1/${f.slug}`;
              return existingUrls.has(url) || imported.has(f.slug);
            }).length}
          </div>
          <div className="text-[10px] text-text-dim font-bold uppercase tracking-wider mt-1">Monitored in Lumina</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-dim" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search edge functions…"
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Function list */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center bg-white border border-dashed border-gray-200 rounded-2xl">
          <p className="text-text-dim">{functions.length === 0 ? "No edge functions found in this project." : "No functions match your search."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((fn) => {
            const fnUrl = `https://${ref}.supabase.co/functions/v1/${fn.slug}`;
            const alreadyMonitored = existingUrls.has(fnUrl) || imported.has(fn.slug);
            const isImporting = importing.has(fn.slug);
            const result = invokeResult[fn.slug];
            const isInvoking = invoking === fn.slug;

            return (
              <div key={fn.id} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3 hover:border-emerald-200 transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${fn.status === "ACTIVE" ? "bg-emerald-500" : "bg-amber-400"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-sm text-text-main">{fn.slug}</span>
                        {fn.name !== fn.slug && <span className="text-xs text-text-dim">{fn.name}</span>}
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${fn.verify_jwt ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-blue-50 text-blue-600 border-blue-200"}`}>
                          {fn.verify_jwt ? "JWT Required" : "Public"}
                        </span>
                        <span className="text-[9px] text-gray-400 font-mono">v{fn.version}</span>
                      </div>
                      <code className="text-[10px] text-text-dim font-mono break-all mt-0.5 block">
                        {fnUrl}
                      </code>
                      <p className="text-[10px] text-text-dim mt-1">
                        Updated {new Date(fn.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Test / Invoke button */}
                    <button
                      onClick={() => handleInvoke(fn.slug)}
                      disabled={isInvoking}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold text-text-dim hover:text-text-main hover:border-gray-400 transition-all"
                    >
                      {isInvoking ? <RefreshCcw size={10} className="animate-spin" /> : <Zap size={10} />}
                      Test
                    </button>

                    {/* Import / monitored button */}
                    {alreadyMonitored ? (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-xs font-black">
                        <Check size={10} /> Monitored
                      </span>
                    ) : (
                      <button
                        onClick={() => handleImport([fn.slug])}
                        disabled={isImporting}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition-all disabled:opacity-50"
                      >
                        {isImporting ? <RefreshCcw size={10} className="animate-spin" /> : <Plus size={10} />}
                        {isImporting ? "Adding…" : "Add to Monitor"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Invoke result */}
                {result && (
                  <div className={`rounded-xl p-3 font-mono text-[11px] ${result.ok === false || result.error ? "bg-rose-50 border border-rose-100" : "bg-emerald-50 border border-emerald-100"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {result.error ? (
                        <span className="text-rose-600 font-black text-[10px]">✗ Error</span>
                      ) : (
                        <>
                          <span className={`font-black text-[10px] ${result.ok ? "text-emerald-600" : "text-rose-600"}`}>
                            HTTP {result.status}
                          </span>
                          <span className="text-gray-400 text-[10px]">{result.responseTime}ms</span>
                        </>
                      )}
                      <button onClick={() => setInvokeResult((p) => { const n = {...p}; delete n[fn.slug]; return n; })} className="ml-auto text-gray-400 hover:text-gray-600">
                        <X size={10} />
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-relaxed max-h-32 overflow-auto">
                      {result.error || JSON.stringify(result.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── VercelLogsView ───────────────────────────────────────────────────────────

interface VProject  { id: string; name: string; framework?: string; }
interface VDeploy   { uid: string; url: string; name: string; state: string; target?: string; createdAt: number; meta?: { githubCommitRef?: string; githubCommitMessage?: string }; }
interface VLogEvent {
  type: string; created: number;
  payload?: {
    text?: string; requestId?: string; statusCode?: number; level?: string;
    method?: string; path?: string; elapsed?: number;
    proxy?: { method?: string; path?: string; host?: string; statusCode?: number; region?: string; userAgent?: string[]; clientIp?: string; };
  };
}

const VERCEL_TRIANGLE = () => (
  <svg width="14" height="14" viewBox="0 0 76 65" fill="currentColor">
    <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
  </svg>
);

const TIME_RANGES = [
  { label: "Last 30 min", value: 30 * 60 * 1000 },
  { label: "Last 1 hour", value: 60 * 60 * 1000 },
  { label: "Last 6 hours", value: 6 * 60 * 60 * 1000 },
  { label: "Last 24 hours", value: 24 * 60 * 60 * 1000 },
  { label: "Last 7 days", value: 7 * 24 * 60 * 60 * 1000 },
];

const ALL_METHODS = ["GET","POST","HEAD","PUT","DELETE","OPTIONS","PATCH"] as const;
const ALL_REQUEST_TYPES = ["API Endpoint","SSR","ISR","PPR","Server Components","Cron Job","Middleware"] as const;
const ALL_LEVELS = ["log","info","warning","error","fatal"] as const;

type VMethod = typeof ALL_METHODS[number];
type VReqType = typeof ALL_REQUEST_TYPES[number];
type VLevel = typeof ALL_LEVELS[number];

const METHOD_COLORS: Record<VMethod, string> = {
  GET: "bg-green-100 text-green-700", POST: "bg-blue-100 text-blue-700",
  HEAD: "bg-purple-100 text-purple-700", PUT: "bg-orange-100 text-orange-700",
  DELETE: "bg-red-100 text-red-700", OPTIONS: "bg-gray-100 text-gray-600",
  PATCH: "bg-teal-100 text-teal-700",
};
const LEVEL_COLORS: Record<VLevel, { dot: string; text: string; row: string }> = {
  log:     { dot: "bg-gray-400",   text: "text-gray-300",   row: "" },
  info:    { dot: "bg-blue-400",   text: "text-blue-300",   row: "" },
  warning: { dot: "bg-yellow-400", text: "text-yellow-300", row: "bg-yellow-950/20" },
  error:   { dot: "bg-red-400",    text: "text-red-400",    row: "bg-red-950/20" },
  fatal:   { dot: "bg-red-600",    text: "text-red-500",    row: "bg-red-950/30" },
};

function deriveLevel(ev: VLogEvent): VLevel {
  const l = (ev.payload?.level || "").toLowerCase();
  if (l === "fatal") return "fatal";
  if (l === "error" || ev.type === "stderr") return "error";
  if (l === "warning" || l === "warn") return "warning";
  if (l === "info") return "info";
  if (ev.payload?.statusCode && ev.payload.statusCode >= 500) return "error";
  if (ev.payload?.statusCode && ev.payload.statusCode >= 400) return "warning";
  return "log";
}

function deriveMethod(ev: VLogEvent): VMethod | null {
  const m = (ev.payload?.proxy?.method || ev.payload?.method || "").toUpperCase();
  return ALL_METHODS.includes(m as VMethod) ? (m as VMethod) : null;
}

function deriveReqType(ev: VLogEvent): VReqType | null {
  if (ev.type === "middleware-invocation") return "Middleware";
  if (ev.type === "response" || ev.type === "request") {
    const path = ev.payload?.proxy?.path || ev.payload?.path || "";
    if (path.startsWith("/api/")) return "API Endpoint";
    return "SSR";
  }
  return null;
}

const FilterSection = ({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-gray-800">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/50 transition-colors">
        <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">{title}</span>
        <div className="flex items-center gap-2">
          {count !== undefined && count > 0 && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full font-bold">{count}</span>}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={cn("text-gray-500 transition-transform", open && "rotate-180")}><path d="M1 3l4 4 4-4z"/></svg>
        </div>
      </button>
      {open && <div className="px-4 pb-3 space-y-1.5">{children}</div>}
    </div>
  );
};

const CheckItem = ({ label, count, checked, onChange, color }: { label: string; count: number; checked: boolean; onChange: () => void; color?: string; key?: React.Key }) => (
  <label className="flex items-center gap-2.5 cursor-pointer group">
    <div onClick={onChange} className={cn("w-3.5 h-3.5 rounded border flex items-center justify-center transition-all shrink-0 cursor-pointer",
      checked ? "bg-blue-500 border-blue-500" : "border-gray-600 hover:border-gray-400"
    )}>
      {checked && <svg width="8" height="8" viewBox="0 0 8 8" fill="white"><path d="M1 4l2 2 4-4"/></svg>}
    </div>
    {color && <span className={cn("w-2 h-2 rounded-full shrink-0", color)} />}
    <span className="text-[11px] text-gray-300 flex-1 group-hover:text-white transition-colors">{label}</span>
    <span className="text-[10px] text-gray-600 font-mono">{count}</span>
  </label>
);

const VercelLogsView = () => {
  const [projects, setProjects]       = useState<VProject[]>([]);
  const [deployments, setDeployments] = useState<VDeploy[]>([]);
  const [logs, setLogs]               = useState<VLogEvent[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Filter state
  const [selectedProject, setSelectedProject]   = useState<string>("all");
  const [selectedDeploy,   setSelectedDeploy]   = useState<string>("latest");
  const [timeRange,        setTimeRange]         = useState(0); // index into TIME_RANGES
  const [contains,         setContains]          = useState("");
  const [levels,           setLevels]            = useState<Set<VLevel>>(new Set());
  const [methods,          setMethods]           = useState<Set<VMethod>>(new Set());
  const [reqTypes,         setReqTypes]          = useState<Set<VReqType>>(new Set());
  const [environments,     setEnvironments]      = useState<Set<string>>(new Set());
  const [statusFilter,     setStatusFilter]      = useState("");
  const [pathFilter,       setPathFilter]        = useState("");
  const [showTimeDD,       setShowTimeDD]        = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load projects on mount
  useEffect(() => {
    axios.get<{ projects: VProject[] }>("/api/vercel/projects")
      .then(r => setProjects(r.data.projects || []))
      .catch(() => setError("Could not load Vercel projects — check your token in Settings"));
  }, []);

  // Load deployments when project changes
  useEffect(() => {
    const params: Record<string, string> = { limit: "30" };
    if (selectedProject !== "all") params.projectId = selectedProject;
    axios.get<{ deployments: VDeploy[] }>("/api/vercel/deployments", { params })
      .then(r => {
        const deps = r.data.deployments || [];
        setDeployments(deps);
        if (deps.length > 0 && selectedDeploy === "latest") fetchLogs(deps[0].uid);
      })
      .catch(() => {});
  }, [selectedProject]);

  const fetchLogs = async (deployId: string) => {
    if (!deployId) return;
    setLoading(true);
    setError(null);
    try {
      const range = TIME_RANGES[timeRange];
      const since = Date.now() - range.value;
      const data = await axios.get<VLogEvent[]>("/api/vercel/logs", {
        params: { deploymentId: deployId, since: String(since), limit: "500" }
      });
      setLogs(Array.isArray(data.data) ? data.data.reverse() : []);
      setSelectedDeploy(deployId);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    const id = selectedDeploy === "latest" ? deployments[0]?.uid : selectedDeploy;
    if (id) fetchLogs(id);
  };

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [logs]);

  // Derived filter counts
  const levelCounts = Object.fromEntries(ALL_LEVELS.map(l => [l, logs.filter(e => deriveLevel(e) === l).length]));
  const methodCounts = Object.fromEntries(ALL_METHODS.map(m => [m, logs.filter(e => deriveMethod(e) === m).length]));
  const reqTypeCounts = Object.fromEntries(ALL_REQUEST_TYPES.map(t => [t, logs.filter(e => deriveReqType(e) === t).length]));
  const envCounts = {
    Production: deployments.filter(d => d.target === "production").length,
    Preview:    deployments.filter(d => d.target !== "production").length,
  };

  // Apply all filters
  const filtered = logs.filter(ev => {
    const lvl = deriveLevel(ev);
    const mth = deriveMethod(ev);
    const rqt = deriveReqType(ev);
    const txt = (ev.payload?.text || ev.payload?.proxy?.path || "").toLowerCase();
    const sc  = ev.payload?.statusCode ?? ev.payload?.proxy?.statusCode;
    const pth = ev.payload?.proxy?.path || ev.payload?.path || "";

    if (levels.size > 0 && !levels.has(lvl)) return false;
    if (methods.size > 0 && (!mth || !methods.has(mth))) return false;
    if (reqTypes.size > 0 && (!rqt || !reqTypes.has(rqt))) return false;
    if (contains && !txt.includes(contains.toLowerCase())) return false;
    if (statusFilter && sc !== undefined && !String(sc).startsWith(statusFilter.replace("x","").replace("X",""))) return false;
    if (pathFilter && !pth.toLowerCase().includes(pathFilter.toLowerCase())) return false;
    return true;
  });

  const toggleSet = <T,>(set: Set<T>, val: T, setter: React.Dispatch<React.SetStateAction<Set<T>>>) =>
    setter(prev => { const s = new Set(prev); s.has(val) ? s.delete(val) : s.add(val); return s; });

  const currentDeploy = deployments.find(d => d.uid === selectedDeploy) || deployments[0];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[500px] bg-gray-950 rounded-2xl border border-gray-800 overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
        <VERCEL_TRIANGLE />
        <span className="text-white font-bold text-sm">Runtime Logs</span>

        {/* Project selector */}
        <select
          value={selectedProject}
          onChange={e => { setSelectedProject(e.target.value); setSelectedDeploy("latest"); }}
          className="bg-gray-800 text-gray-300 text-[11px] font-mono px-3 py-1.5 rounded-lg border border-gray-700 outline-none focus:border-blue-500 ml-2"
        >
          <option value="all">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Deployment selector */}
        <select
          value={selectedDeploy}
          onChange={e => fetchLogs(e.target.value)}
          className="bg-gray-800 text-gray-300 text-[11px] font-mono px-3 py-1.5 rounded-lg border border-gray-700 outline-none focus:border-blue-500"
        >
          {deployments.map(d => (
            <option key={d.uid} value={d.uid}>
              {d.name} · {d.target === "production" ? "prod" : "preview"} · {d.state}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          {currentDeploy && (
            <a href={`https://${currentDeploy.url}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-white font-mono transition-colors">
              <ExternalLink size={10} /> {currentDeploy.url?.split(".")[0]}
            </a>
          )}
          <button onClick={refresh} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] rounded-lg border border-gray-700 transition-colors">
            <RefreshCcw size={11} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Refresh"}
          </button>
          <span className="text-[10px] text-gray-600 font-mono">{filtered.length} events</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Filter Sidebar ── */}
        <div className="w-60 shrink-0 border-r border-gray-800 overflow-y-auto bg-gray-900/50">

          {/* Timeline */}
          <div className="border-b border-gray-800">
            <div className="px-4 py-2.5">
              <p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-2">Timeline</p>
              <div className="relative">
                <button onClick={() => setShowTimeDD(v => !v)}
                  className="w-full flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-[11px] text-gray-300 hover:border-gray-500 transition-colors">
                  {TIME_RANGES[timeRange].label}
                  <ChevronDown size={10} />
                </button>
                {showTimeDD && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden z-20 shadow-xl">
                    {TIME_RANGES.map((tr, i) => (
                      <button key={i} onClick={() => { setTimeRange(i); setShowTimeDD(false); refresh(); }}
                        className={cn("w-full text-left px-3 py-2 text-[11px] hover:bg-gray-700 transition-colors", timeRange === i ? "text-blue-400 bg-blue-500/10" : "text-gray-300")}>
                        {tr.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contains */}
          <div className="border-b border-gray-800 px-4 py-2.5">
            <p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-2">Contains</p>
            <div className="relative">
              <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={contains} onChange={e => setContains(e.target.value)}
                placeholder="Search logs…"
                className="w-full bg-gray-800 text-gray-200 text-[11px] font-mono pl-7 pr-3 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-600" />
            </div>
          </div>

          {/* Console Level */}
          <FilterSection title="Console Level" count={levels.size}>
            {ALL_LEVELS.map(l => (
              <CheckItem key={l} label={l.charAt(0).toUpperCase() + l.slice(1)}
                count={levelCounts[l] || 0} checked={levels.has(l)}
                onChange={() => toggleSet(levels, l, setLevels)}
                color={LEVEL_COLORS[l].dot} />
            ))}
          </FilterSection>

          {/* Request Method */}
          <FilterSection title="Request Method" count={methods.size}>
            <div className="relative mb-2">
              <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input placeholder="Search methods…" className="w-full bg-gray-800 text-gray-200 text-[10px] font-mono pl-7 pr-2 py-1.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-600" readOnly />
            </div>
            {ALL_METHODS.map(m => (
              <CheckItem key={m} label={m} count={methodCounts[m] || 0}
                checked={methods.has(m)} onChange={() => toggleSet(methods, m, setMethods)} />
            ))}
          </FilterSection>

          {/* Status Code */}
          <div className="border-b border-gray-800 px-4 py-2.5">
            <p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-2">Status Code</p>
            <input value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              placeholder="e.g. 200, 4xx, 500"
              className="w-full bg-gray-800 text-gray-200 text-[11px] font-mono px-3 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-600" />
          </div>

          {/* Request Path */}
          <div className="border-b border-gray-800 px-4 py-2.5">
            <p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-2">Request Path</p>
            <input value={pathFilter} onChange={e => setPathFilter(e.target.value)}
              placeholder="/api/..."
              className="w-full bg-gray-800 text-gray-200 text-[11px] font-mono px-3 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-600" />
          </div>

          {/* Request Type */}
          <FilterSection title="Request Type" count={reqTypes.size}>
            {ALL_REQUEST_TYPES.map(t => (
              <CheckItem key={t} label={t} count={reqTypeCounts[t] || 0}
                checked={reqTypes.has(t)} onChange={() => toggleSet(reqTypes, t, setReqTypes)} />
            ))}
          </FilterSection>

          {/* Environment */}
          <FilterSection title="Environment" count={environments.size}>
            {(["Production","Preview"] as const).map(env => (
              <CheckItem key={env} label={env} count={envCounts[env] || 0}
                checked={environments.has(env)}
                onChange={() => toggleSet(environments, env, setEnvironments)}
                color={env === "Production" ? "bg-green-500" : "bg-blue-500"} />
            ))}
          </FilterSection>

          {/* Deployment ID */}
          <FilterSection title="Deployment ID" count={deployments.length}>
            <div className="relative mb-2">
              <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input placeholder="Search deployment IDs…" className="w-full bg-gray-800 text-gray-200 text-[10px] font-mono pl-7 pr-2 py-1.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 placeholder:text-gray-600" readOnly />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {deployments.slice(0, 10).map(d => (
                <button key={d.uid} onClick={() => fetchLogs(d.uid)}
                  className={cn("w-full text-left px-2 py-1.5 rounded text-[10px] font-mono transition-colors",
                    selectedDeploy === d.uid ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                  )}>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0",
                      d.state === "READY" ? "bg-green-500" : d.state === "ERROR" ? "bg-red-500" : "bg-yellow-500"
                    )} />
                    <span className="truncate">{d.uid.slice(4, 16)}</span>
                  </div>
                  <div className="text-[9px] text-gray-600 truncate pl-3 mt-0.5">{d.name} · {d.target || "preview"}</div>
                </button>
              ))}
            </div>
          </FilterSection>

          {/* Clear filters */}
          {(levels.size + methods.size + reqTypes.size + environments.size > 0 || contains || statusFilter || pathFilter) > 0 && (
            <div className="px-4 py-3">
              <button onClick={() => { setLevels(new Set()); setMethods(new Set()); setReqTypes(new Set()); setEnvironments(new Set()); setContains(""); setStatusFilter(""); setPathFilter(""); }}
                className="w-full py-2 text-[10px] font-bold text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-700 rounded-lg transition-colors">
                Clear All Filters
              </button>
            </div>
          )}
        </div>

        {/* ── Log stream ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Column headers */}
          <div className="flex items-center px-4 py-2 border-b border-gray-800 bg-gray-900/30 text-[10px] text-gray-600 font-bold uppercase tracking-wider shrink-0 select-none font-mono">
            <span className="w-[88px] shrink-0">Time</span>
            <span className="w-16 shrink-0">Level</span>
            <span className="w-16 shrink-0">Method</span>
            <span className="w-14 shrink-0">Status</span>
            <span className="w-40 shrink-0">Path</span>
            <span className="flex-1">Message</span>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto font-mono text-[11px]">
            {error && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-red-400">
                <AlertCircle size={28} className="opacity-50" />
                <p className="text-[12px]">{error}</p>
              </div>
            )}
            {!error && !loading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
                <VERCEL_TRIANGLE />
                <p className="text-[12px]">{logs.length === 0 ? "Select a deployment to load logs" : "No events match the current filters"}</p>
              </div>
            )}
            {filtered.map((ev, i) => {
              const lvl    = deriveLevel(ev);
              const mth    = deriveMethod(ev);
              const sc     = ev.payload?.statusCode ?? ev.payload?.proxy?.statusCode;
              const pth    = ev.payload?.proxy?.path || ev.payload?.path || "";
              const msg    = ev.payload?.text || (mth ? `${mth} ${pth}` : ev.type);
              const lc     = LEVEL_COLORS[lvl];
              const time   = new Date(ev.created).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
              const ms     = ev.payload?.elapsed;
              return (
                <div key={i} className={cn("flex items-start px-4 py-1 border-b border-gray-900/50 hover:bg-white/[0.02] transition-colors group", lc.row)}>
                  <span className="w-[88px] shrink-0 text-gray-600 tabular-nums">{time}</span>
                  <span className="w-16 shrink-0 flex items-center gap-1">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", lc.dot)} />
                    <span className={cn("text-[10px] font-bold", lc.text)}>{lvl}</span>
                  </span>
                  <span className="w-16 shrink-0">
                    {mth ? (
                      <span className={cn("text-[9px] font-black px-1.5 py-0.5 rounded", METHOD_COLORS[mth])}>{mth}</span>
                    ) : <span className="text-gray-700">—</span>}
                  </span>
                  <span className={cn("w-14 shrink-0 tabular-nums font-bold",
                    !sc ? "text-gray-700" : sc >= 500 ? "text-red-400" : sc >= 400 ? "text-yellow-400" : sc >= 300 ? "text-blue-400" : "text-green-400"
                  )}>{sc || "—"}</span>
                  <span className="w-40 shrink-0 text-gray-500 truncate" title={pth}>{pth || "—"}</span>
                  <span className={cn("flex-1 break-words min-w-0", lc.text)}>
                    {msg}
                    {ms !== undefined && <span className="text-gray-600 ml-2">{ms}ms</span>}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── AnalyticsView ────────────────────────────────────────────────────────────

const TIME_WINDOWS = [
  { label: "Last 15 min", ms: 15 * 60 * 1000 },
  { label: "Last 1 hour", ms: 60 * 60 * 1000 },
  { label: "Last 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

const FRAMEWORK_SNIPPETS: { label: string; lang: string; code: string }[] = [
  {
    label: "Node / Express",
    lang: "js",
    code: `// Paste once in your Express app — captures every login
app.post("/auth/login", async (req, res) => {
  const start = Date.now();
  try {
    // … your existing auth logic …
    const user = await authenticate(req.body);
    const latency_ms = Date.now() - start;

    // Push structured event to Lumina
    fetch("http://localhost:8080/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "login",
        user_id: user.id,
        endpoint: "/auth/login",
        method: "POST",
        status: "success",
        http_status: 200,
        latency_ms,
        source_ip: req.ip,
      }),
    }).catch(() => {}); // non-blocking — never crash your app

    res.json({ token: user.token });
  } catch (err) {
    const latency_ms = Date.now() - start;
    fetch("http://localhost:8080/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "login",
        user_id: req.body?.email,
        endpoint: "/auth/login",
        method: "POST",
        status: "failure",
        http_status: 401,
        latency_ms,
        error_code: err.code,
        source_ip: req.ip,
      }),
    }).catch(() => {});
    res.status(401).json({ error: "Unauthorized" });
  }
});`,
  },
  {
    label: "Python / FastAPI",
    lang: "python",
    code: `import time, httpx
from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/auth/login")
async def login(request: Request, body: LoginBody):
    start = time.time()
    try:
        user = await authenticate(body)
        latency_ms = int((time.time() - start) * 1000)

        # Push to Lumina (fire-and-forget)
        async with httpx.AsyncClient() as c:
            await c.post("http://localhost:8080/api/ingest", json={
                "event": "login",
                "user_id": str(user.id),
                "endpoint": "/auth/login",
                "method": "POST",
                "status": "success",
                "http_status": 200,
                "latency_ms": latency_ms,
                "source_ip": request.client.host,
            }, timeout=2)

        return {"token": user.token}
    except Exception as e:
        latency_ms = int((time.time() - start) * 1000)
        # same pattern for failure ...
        raise`,
  },
  {
    label: "Python / Django",
    lang: "python",
    code: `# middleware.py — add to MIDDLEWARE in settings.py
import time, threading, requests

class LuminaLoginMiddleware:
    LOGIN_PATH = "/auth/login"
    LUMINA_URL = "http://localhost:8080/api/ingest"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path != self.LOGIN_PATH or request.method != "POST":
            return self.get_response(request)

        start = time.time()
        response = self.get_response(request)
        latency_ms = int((time.time() - start) * 1000)

        payload = {
            "event": "login",
            "endpoint": request.path,
            "method": request.method,
            "status": "success" if response.status_code < 400 else "failure",
            "http_status": response.status_code,
            "latency_ms": latency_ms,
            "source_ip": request.META.get("REMOTE_ADDR"),
        }
        # Ship log in background thread so auth path is never delayed
        threading.Thread(target=requests.post,
            args=(self.LUMINA_URL,), kwargs={"json": payload, "timeout": 2},
            daemon=True).start()
        return response`,
  },
  {
    label: "Java / Spring Boot",
    lang: "java",
    code: `// LoginMetricsFilter.java
@Component
@Order(1)
public class LoginMetricsFilter extends OncePerRequestFilter {

    @Value("\${lumina.url:http://localhost:8080}")
    private String luminaUrl;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
            HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        if (!"/auth/login".equals(request.getRequestURI())) {
            chain.doFilter(request, response); return;
        }
        long start = System.currentTimeMillis();
        chain.doFilter(request, response);
        long latencyMs = System.currentTimeMillis() - start;

        Map<String, Object> event = Map.of(
            "event",       "login",
            "endpoint",    "/auth/login",
            "method",      "POST",
            "status",      response.getStatus() < 400 ? "success" : "failure",
            "http_status", response.getStatus(),
            "latency_ms",  latencyMs,
            "source_ip",   request.getRemoteAddr()
        );
        // fire-and-forget
        CompletableFuture.runAsync(() ->
            new RestTemplate().postForObject(
                luminaUrl + "/api/ingest", event, Map.class));
    }
}`,
  },
  {
    label: ".NET / ASP.NET Core",
    lang: "csharp",
    code: `// LoginMetricsMiddleware.cs
public class LoginMetricsMiddleware(RequestDelegate next,
    IHttpClientFactory httpFactory, IConfiguration cfg)
{
    private readonly string _luminaUrl = cfg["Lumina:Url"] ?? "http://localhost:8080";

    public async Task InvokeAsync(HttpContext ctx)
    {
        if (ctx.Request.Path != "/auth/login") { await next(ctx); return; }
        var sw = Stopwatch.StartNew();
        await next(ctx);
        sw.Stop();

        var payload = JsonSerializer.Serialize(new {
            @event    = "login",
            endpoint  = "/auth/login",
            method    = "POST",
            status    = ctx.Response.StatusCode < 400 ? "success" : "failure",
            http_status = ctx.Response.StatusCode,
            latency_ms  = sw.ElapsedMilliseconds,
            source_ip   = ctx.Connection.RemoteIpAddress?.ToString(),
        });
        // fire-and-forget
        _ = Task.Run(async () => {
            var c = httpFactory.CreateClient();
            await c.PostAsync(_luminaUrl + "/api/ingest",
                new StringContent(payload, Encoding.UTF8, "application/json"));
        });
    }
}
// In Program.cs: app.UseMiddleware<LoginMetricsMiddleware>();`,
  },
];

const AnalyticsView = () => {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [eventFilter, setEventFilter] = useState("login");
  const [customEvent, setCustomEvent] = useState("");
  const [timeIdx, setTimeIdx] = useState(1); // default: last 1 hour
  const [userSearch, setUserSearch] = useState("");
  const [showSnippets, setShowSnippets] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState(0);
  const [copied, setCopied] = useState(false);
  const [recentEvents, setRecentEvents] = useState<IngestEvent[]>([]);
  const [clearConfirm, setClearConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const from = Date.now() - TIME_WINDOWS[timeIdx].ms;
    const ev = customEvent || eventFilter;
    try {
      const [statsRes, eventsRes] = await Promise.all([
        axios.get<EventStats>(`/api/events/stats?event=${encodeURIComponent(ev)}&from=${from}`),
        axios.get<{ events: IngestEvent[] }>(`/api/events?event=${encodeURIComponent(ev)}&from=${from}&limit=100`),
      ]);
      setStats(statsRes.data);
      setRecentEvents(eventsRes.data.events || []);
    } catch { /* silently no-op if no events yet */ }
    setLoading(false);
  }, [eventFilter, customEvent, timeIdx]);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    await axios.delete("/api/events");
    setStats(null); setRecentEvents([]); setClearConfirm(false);
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(FRAMEWORK_SNIPPETS[activeSnippet].code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  // Diagnosis: is it one user or many?
  const diagnosis = (() => {
    if (!stats || stats.total < 5) return null;
    const globalP75 = stats.latency.p75;
    if (!globalP75) return null;
    const slowUsers = stats.perUser.filter((u) => (u.avg_ms ?? 0) > globalP75 * 2 && u.user_id !== "__anonymous__");
    const namedUsers = stats.perUser.filter((u) => u.user_id !== "__anonymous__");
    if (namedUsers.length === 0) return null;
    const slowPct = slowUsers.length / namedUsers.length;
    if (slowPct > 0.4) return { type: "global", label: "System-wide issue", color: "rose", msg: `${slowUsers.length} of ${namedUsers.length} users are experiencing slow ${eventFilter}s — this is a system problem, not user-specific.` };
    if (slowPct > 0 && slowPct <= 0.15) return { type: "isolated", label: "Isolated to specific users", color: "amber", msg: `Only ${slowUsers.length} user${slowUsers.length !== 1 ? "s" : ""} (${(slowPct * 100).toFixed(0)}%) are slow — likely user-specific data, geolocation, or session issue.` };
    if (slowPct > 0.15) return { type: "partial", label: "Partial impact", color: "orange", msg: `${slowUsers.length} of ${namedUsers.length} users affected (${(slowPct * 100).toFixed(0)}%) — could be specific tenants, regions, or a degrading backend.` };
    return { type: "ok", label: "Performance looks even", color: "green", msg: `Latency is distributed evenly across users. No single user is significantly slower than the rest.` };
  })();

  const filteredUsers = stats?.perUser.filter((u) =>
    !userSearch || u.user_id.toLowerCase().includes(userSearch.toLowerCase())
  ) ?? [];

  const latencyColor = (ms: number | null) => {
    if (!ms) return "text-gray-400";
    if (ms > 3000) return "text-rose-500";
    if (ms > 1500) return "text-amber-500";
    return "text-brand";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Login Analytics</h2>
          <p className="text-sm text-text-dim mt-0.5">Ingest structured logs from your apps — spot "one user slow vs all users slow"</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Event type selector */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            {["login", "signup", "api_call"].map((e) => (
              <button key={e} onClick={() => { setEventFilter(e); setCustomEvent(""); }}
                className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  eventFilter === e && !customEvent ? "bg-white shadow-sm text-text-main" : "text-text-dim hover:text-text-main")}>
                {e}
              </button>
            ))}
            <input
              value={customEvent}
              onChange={(e) => setCustomEvent(e.target.value)}
              placeholder="custom…"
              className="w-20 bg-transparent px-2 py-1.5 text-[10px] font-mono outline-none text-text-dim placeholder:text-gray-400"
              onFocus={() => setEventFilter("")}
            />
          </div>
          {/* Time range */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            {TIME_WINDOWS.map((w, i) => (
              <button key={i} onClick={() => setTimeIdx(i)}
                className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  timeIdx === i ? "bg-white shadow-sm text-text-main" : "text-text-dim hover:text-text-main")}>
                {w.label.replace("Last ", "")}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-black uppercase tracking-wider transition-colors">
            <RefreshCcw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={handleClear}
            className={cn("px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors",
              clearConfirm ? "bg-rose-500 text-white" : "bg-gray-100 text-text-dim hover:bg-gray-200")}>
            {clearConfirm ? "Confirm clear?" : "Clear"}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && (!stats || stats.total === 0) && (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto">
            <Activity size={24} className="text-brand" />
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-tight">No events yet</h3>
            <p className="text-xs text-text-dim mt-1">Instrument your login endpoint and push events to <code className="bg-gray-100 px-1 rounded font-mono">POST /api/ingest</code></p>
          </div>
          <button onClick={() => setShowSnippets(true)}
            className="px-4 py-2 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all">
            Show Code Snippets →
          </button>
        </div>
      )}

      {stats && stats.total > 0 && (
        <>
          {/* Diagnosis card */}
          {diagnosis && (
            <div className={cn("p-5 rounded-xl border flex items-start gap-4",
              diagnosis.color === "rose"   ? "bg-rose-50 border-rose-200" :
              diagnosis.color === "amber"  ? "bg-amber-50 border-amber-200" :
              diagnosis.color === "orange" ? "bg-orange-50 border-orange-200" :
              "bg-brand/10 border-brand/20"
            )}>
              <div className={cn("p-2 rounded-xl shrink-0",
                diagnosis.color === "rose"   ? "bg-rose-100" :
                diagnosis.color === "amber"  ? "bg-amber-100" :
                diagnosis.color === "orange" ? "bg-orange-100" :
                "bg-brand/20"
              )}>
                {diagnosis.type === "ok"
                  ? <CheckCircle2 size={18} className="text-brand" />
                  : <AlertTriangle size={18} className={
                      diagnosis.color === "rose" ? "text-rose-500" :
                      diagnosis.color === "amber" ? "text-amber-500" :
                      "text-orange-500"
                    } />
                }
              </div>
              <div>
                <p className={cn("font-black text-sm uppercase tracking-tight",
                  diagnosis.color === "rose" ? "text-rose-700" :
                  diagnosis.color === "amber" ? "text-amber-700" :
                  diagnosis.color === "orange" ? "text-orange-700" :
                  "text-brand"
                )}>{diagnosis.label}</p>
                <p className="text-xs text-text-dim mt-1">{diagnosis.msg}</p>
              </div>
            </div>
          )}

          {/* Metrics row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: "Total Events",   value: String(stats.total) },
              { label: "Success Rate",   value: stats.successRate !== null ? `${stats.successRate}%` : "—", hi: stats.successRate !== null && stats.successRate < 95 },
              { label: "Avg Latency",    value: stats.latency.avg !== null ? `${stats.latency.avg}ms` : "—", hiColor: latencyColor(stats.latency.avg) },
              { label: "p75 Latency",    value: stats.latency.p75 !== null ? `${stats.latency.p75}ms` : "—", hiColor: latencyColor(stats.latency.p75) },
              { label: "p95 Latency",    value: stats.latency.p95 !== null ? `${stats.latency.p95}ms` : "—", hiColor: latencyColor(stats.latency.p95) },
            ].map(({ label, value, hi, hiColor }) => (
              <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">{label}</p>
                <p className={cn("text-xl font-black font-mono", hi ? "text-rose-500" : hiColor || "text-text-main")}>{value}</p>
              </div>
            ))}
          </div>

          {/* Latency trend chart */}
          {stats.timeSeries.length > 1 && (
            <div className="bg-white border border-gray-100 rounded-xl p-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-4">
                Latency Over Time — avg / p75 / p95
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.timeSeries}>
                    <defs>
                      <linearGradient id="avgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3ecf8e" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3ecf8e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#9ca3af" }} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "#9ca3af" }} unit="ms" />
                    <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,.1)", fontSize: 11 }} />
                    <Area type="monotone" dataKey="avg_ms" name="Avg" stroke="#3ecf8e" strokeWidth={2} fill="url(#avgGrad)" dot={false} />
                    <Area type="monotone" dataKey="p75_ms" name="p75" stroke="#f59e0b" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="p95_ms" name="p95" stroke="#f43f5e" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="2 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-6 mt-2 justify-end">
                {[{ color: "bg-brand", label: "Avg" }, { color: "bg-amber-400", label: "p75" }, { color: "bg-rose-400", label: "p95" }].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className={cn("w-3 h-0.5 rounded", color)} />
                    <span className="text-[10px] text-text-dim font-bold">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-user table */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">
                Per-User Latency · {filteredUsers.length} users
              </h3>
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search user…"
                  className="pl-8 pr-3 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand bg-gray-50"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["User ID", "Requests", "Avg Latency", "p95 Latency", "Errors", "Signal"].map((h) => (
                      <th key={h} className="text-left text-[10px] font-black uppercase tracking-widest text-text-dim px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.slice(0, 50).map((u) => {
                    const globalP75 = stats.latency.p75 ?? 0;
                    const isSlow = (u.avg_ms ?? 0) > globalP75 * 2;
                    const errorRate = u.count > 0 ? (u.errors / u.count * 100) : 0;
                    return (
                      <tr key={u.user_id} className={cn("border-b border-gray-50 hover:bg-gray-50/50 transition-colors", isSlow && "bg-amber-50/30")}>
                        <td className="px-5 py-3 font-mono font-bold text-text-main max-w-[200px] truncate">{u.user_id}</td>
                        <td className="px-5 py-3 font-mono text-text-dim">{u.count}</td>
                        <td className={cn("px-5 py-3 font-mono font-bold", latencyColor(u.avg_ms))}>{u.avg_ms !== null ? `${u.avg_ms}ms` : "—"}</td>
                        <td className={cn("px-5 py-3 font-mono", latencyColor(u.p95_ms))}>{u.p95_ms !== null ? `${u.p95_ms}ms` : "—"}</td>
                        <td className="px-5 py-3 font-mono">
                          {u.errors > 0
                            ? <span className="text-rose-500 font-bold">{u.errors} ({errorRate.toFixed(0)}%)</span>
                            : <span className="text-brand">0</span>
                          }
                        </td>
                        <td className="px-5 py-3">
                          {isSlow
                            ? <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Slow</span>
                            : <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-brand/10 text-brand rounded-full">Normal</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-text-dim text-xs">No users match the filter</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent events stream */}
          {recentEvents.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Recent Events</h3>
              </div>
              <div className="font-mono text-[11px] max-h-64 overflow-y-auto">
                {recentEvents.slice(0, 30).map((ev) => (
                  <div key={ev.id} className={cn("flex items-start gap-3 px-5 py-2 border-b border-gray-50 hover:bg-gray-50/50 transition-colors",
                    ev.status === "failure" ? "bg-rose-50/30" : "")}>
                    <span className="text-gray-400 shrink-0 tabular-nums">{new Date(ev.timestamp).toLocaleTimeString("en", { hour12: false })}</span>
                    <span className={cn("shrink-0 font-black text-[9px] uppercase px-1.5 py-0.5 rounded",
                      ev.status === "failure" ? "bg-rose-100 text-rose-600" : "bg-brand/10 text-brand")}>
                      {ev.status || "?"}
                    </span>
                    <span className="text-text-dim shrink-0">{ev.user_id || "anon"}</span>
                    <span className="text-text-dim shrink-0">{ev.endpoint || ""}</span>
                    {ev.latency_ms !== undefined && (
                      <span className={cn("shrink-0 font-bold", latencyColor(ev.latency_ms))}>{ev.latency_ms}ms</span>
                    )}
                    {ev.error_code && <span className="text-rose-400 truncate">{ev.error_code}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Code Snippets */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowSnippets(!showSnippets)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-900 rounded-xl flex items-center justify-center">
              <CodeIcon size={14} className="text-white" />
            </div>
            <div className="text-left">
              <p className="font-black text-sm uppercase tracking-tight">Instrument Your App</p>
              <p className="text-[10px] text-text-dim mt-0.5">Copy-paste middleware for 5 frameworks — Express, FastAPI, Django, Spring Boot, ASP.NET</p>
            </div>
          </div>
          {showSnippets ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </button>

        {showSnippets && (
          <div className="border-t border-gray-100">
            {/* Framework tabs */}
            <div className="flex overflow-x-auto gap-1 px-4 pt-4 pb-0 border-b border-gray-100">
              {FRAMEWORK_SNIPPETS.map((s, i) => (
                <button key={i} onClick={() => setActiveSnippet(i)}
                  className={cn("px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-lg whitespace-nowrap border border-b-0 transition-all",
                    activeSnippet === i ? "bg-gray-950 text-white border-gray-800" : "bg-gray-50 text-text-dim border-gray-100 hover:text-text-main")}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Code block */}
            <div className="bg-gray-950 relative">
              <button onClick={copySnippet}
                className="absolute top-3 right-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors z-10">
                {copied ? <><Check size={10} className="text-brand" /> Copied!</> : <><Copy size={10} /> Copy</>}
              </button>
              <pre className="overflow-x-auto text-[11px] text-gray-200 p-6 font-mono leading-relaxed max-h-[420px]">
                <code>{FRAMEWORK_SNIPPETS[activeSnippet].code}</code>
              </pre>
            </div>

            {/* Endpoint reference */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-3">API Reference</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { method: "POST", path: "/api/ingest", desc: "Send a single event" },
                  { method: "POST", path: "/api/ingest/batch", desc: "Send up to 1,000 events" },
                  { method: "GET",  path: "/api/events?event=login&from=...", desc: "Query raw events" },
                  { method: "GET",  path: "/api/events/stats?event=login", desc: "Aggregated p50/p75/p95 + per-user" },
                ].map((e) => (
                  <div key={e.path} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-3">
                    <span className={cn("text-[9px] font-black px-2 py-0.5 rounded-md text-white shrink-0",
                      e.method === "POST" ? "bg-blue-500" : e.method === "DELETE" ? "bg-rose-500" : "bg-green-500")}>
                      {e.method}
                    </span>
                    <code className="font-mono text-[10px] text-text-dim flex-1 truncate">{e.path}</code>
                    <span className="text-[10px] text-text-dim shrink-0 hidden sm:block">{e.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── ConsoleLog type ──────────────────────────────────────────────────────────
type ConsoleLog = LogEntry & { projectName: string };

const LOG_COLORS: Record<LogType, { text: string; dot: string; row: string; badge: string }> = {
  success: { text: "text-green-400",  dot: "bg-green-500",  row: "",                    badge: "bg-green-500/20 text-green-400" },
  error:   { text: "text-red-400",    dot: "bg-red-500",    row: "bg-red-950/30",        badge: "bg-red-500/20 text-red-400" },
  warning: { text: "text-yellow-300", dot: "bg-yellow-500", row: "bg-yellow-950/20",     badge: "bg-yellow-500/20 text-yellow-300" },
  info:    { text: "text-blue-400",   dot: "bg-blue-500",   row: "",                    badge: "bg-blue-500/20 text-blue-400" },
};

type DevTab = "Elements" | "Console" | "Network" | "Sources";

const ConsoleView = ({
  logs,
  projects,
  connected,
  onClear,
}: {
  logs: ConsoleLog[];
  projects: Project[];
  connected: boolean;
  onClear: () => void;
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeTab, setActiveTab] = useState<DevTab>("Console");

  // Console tab state
  const [typeFilter, setTypeFilter] = useState<"all" | LogType>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  // Elements tab state
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Network tab state
  const [netFilter, setNetFilter] = useState<"All" | "HTTP" | "TCP">("All");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [netSearch, setNetSearch] = useState("");

  // Sources tab state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (autoScroll && activeTab === "Console") bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll, activeTab]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const filtered = logs.filter((l) => {
    if (typeFilter !== "all" && l.type !== typeFilter) return false;
    if (projectFilter !== "all" && l.projectId !== projectFilter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.projectName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { all: logs.length, error: 0, warning: 0, success: 0, info: 0 };
  logs.forEach((l) => { counts[l.type] = (counts[l.type] || 0) + 1; });

  const copyAll = () => {
    navigator.clipboard?.writeText(filtered.map((l) =>
      `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.projectName}] [${l.type.toUpperCase()}] ${l.message}${l.responseTime !== undefined ? ` (${l.responseTime}ms)` : ""}`
    ).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── Elements helpers ──
  const selectedProject = projects.find((p) => p.id === selectedElementId);
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── Network helpers ──
  const networkLogs = logs.filter((l) => {
    const isHTTP = l.message.startsWith("[HTTP]");
    const isTCP  = l.message.startsWith("[TCP]");
    if (netFilter === "HTTP" && !isHTTP) return false;
    if (netFilter === "TCP"  && !isTCP)  return false;
    if (netSearch && !l.projectName.toLowerCase().includes(netSearch.toLowerCase()) && !l.message.toLowerCase().includes(netSearch.toLowerCase())) return false;
    return true;
  });

  // ── Sources helpers ──
  const selectedSourceProject = projects.find((p) => p.id === selectedSourceId);
  const sourceGroups: Record<string, Project[]> = {};
  projects.forEach((p) => { if (!sourceGroups[p.type]) sourceGroups[p.type] = []; sourceGroups[p.type].push(p); });

  const renderJson = (obj: unknown, indent = 0): React.ReactNode => {
    if (obj === null) return <span className="text-gray-500">null</span>;
    if (typeof obj === "boolean") return <span className="text-blue-400">{String(obj)}</span>;
    if (typeof obj === "number")  return <span className="text-yellow-400">{obj}</span>;
    if (typeof obj === "string")  return <span className="text-green-400">"{obj}"</span>;
    if (Array.isArray(obj)) {
      if (!obj.length) return <span className="text-gray-500">[]</span>;
      return <span>
        <span className="text-gray-500">{"["}</span>
        {obj.slice(0, 20).map((v, i) => <div key={i} style={{ paddingLeft: (indent + 1) * 14 }}>{renderJson(v, indent + 1)}{i < obj.length - 1 && <span className="text-gray-600">,</span>}</div>)}
        {obj.length > 20 && <div style={{ paddingLeft: (indent + 1) * 14 }} className="text-gray-600">… {obj.length - 20} more</div>}
        <div style={{ paddingLeft: indent * 14 }}><span className="text-gray-500">{"]"}</span></div>
      </span>;
    }
    if (typeof obj === "object") {
      const entries = Object.entries(obj as Record<string, unknown>);
      if (!entries.length) return <span className="text-gray-500">{"{}"}</span>;
      return <span>
        <span className="text-gray-500">{"{"}</span>
        {entries.map(([k, v], i) => <div key={k} style={{ paddingLeft: (indent + 1) * 14 }}>
          <span className="text-red-400">"{k}"</span><span className="text-gray-500">: </span>{renderJson(v, indent + 1)}{i < entries.length - 1 && <span className="text-gray-600">,</span>}
        </div>)}
        <div style={{ paddingLeft: indent * 14 }}><span className="text-gray-500">{"}"}</span></div>
      </span>;
    }
    return <span className="text-gray-400">{String(obj)}</span>;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[500px] relative">

      {/* ── DevTools title bar (all tabs clickable) ── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-900 rounded-t-2xl border border-gray-700 border-b-0">
        <div className="flex gap-1.5 shrink-0">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <span className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <div className="flex gap-1 ml-2">
          {(["Elements", "Console", "Network", "Sources"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1 text-[11px] font-medium rounded-t transition-colors",
                activeTab === tab
                  ? "bg-gray-950 text-white border-t border-l border-r border-gray-700"
                  : "text-gray-500 hover:text-gray-300 cursor-pointer"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {connected
            ? <span className="flex items-center gap-1.5 text-[10px] text-green-400 font-mono font-bold"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE</span>
            : <span className="flex items-center gap-1.5 text-[10px] text-red-400 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /> DISCONNECTED</span>
          }
          {activeTab === "Console" && <span className="text-[10px] text-gray-500 font-mono">{filtered.length} entries</span>}
          {activeTab === "Network" && <span className="text-[10px] text-gray-500 font-mono">{networkLogs.length} requests</span>}
          {activeTab === "Elements" && <span className="text-[10px] text-gray-500 font-mono">{projects.length} elements</span>}
          {activeTab === "Sources" && <span className="text-[10px] text-gray-500 font-mono">{projects.length} files</span>}
        </div>
      </div>

      {/* ── Tab content wrapper ── */}
      <div className="flex-1 flex flex-col min-h-0 bg-gray-950 border-x border-b border-gray-700 rounded-b-2xl overflow-hidden">

        {/* ══════════════════════════ ELEMENTS ══════════════════════════ */}
        {activeTab === "Elements" && (
          <div className="flex h-full">
            {/* Left: DOM tree */}
            <div className="w-[52%] border-r border-gray-800 overflow-y-auto">
              <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/50 shrink-0">
                <span className="text-[10px] text-gray-500 font-mono font-bold uppercase tracking-wider">DOM Inspector</span>
              </div>
              <div className="p-2 font-mono text-[11px]">
                <div className="px-2 py-0.5 text-blue-400/50">&lt;<span className="text-blue-300/50">monitor</span>&gt;</div>
                {projects.map((p) => {
                  const exp = expandedIds.has(p.id);
                  const sel = selectedElementId === p.id;
                  const sc  = p.status === "operational" ? "text-green-400" : p.status === "down" ? "text-red-400" : "text-yellow-400";
                  return (
                    <div key={p.id} className="pl-5">
                      <div onClick={() => setSelectedElementId(p.id)} className={cn("flex items-start gap-1 px-2 py-0.5 rounded cursor-pointer", sel ? "bg-blue-600/20" : "hover:bg-white/[0.04]")}>
                        <button onClick={(e) => { e.stopPropagation(); toggleExpand(p.id); }} className="text-gray-600 hover:text-gray-400 mt-1 shrink-0">
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">{exp ? <path d="M0 2l4 4 4-4z"/> : <path d="M2 0l4 4-4 4z"/>}</svg>
                        </button>
                        <span className="text-gray-600">&lt;</span>
                        <span className="text-red-400">project</span>
                        <span className="text-teal-300"> name</span><span className="text-gray-500">=</span><span className="text-orange-300">"{p.name}"</span>
                        <span className="text-teal-300"> type</span><span className="text-gray-500">=</span><span className="text-orange-300">"{p.type}"</span>
                        <span className="text-teal-300"> status</span><span className="text-gray-500">=</span><span className={sc}>"{p.status}"</span>
                        {exp ? <span className="text-gray-600">&gt;</span> : <span className="text-gray-600"> /&gt;</span>}
                      </div>
                      {exp && (
                        <div className="pl-5">
                          <div className="px-2 py-0.5">
                            <span className="text-gray-600">&lt;</span><span className="text-red-300">url</span><span className="text-gray-600">&gt;</span>
                            <span className="text-green-300 break-all">{p.url}</span>
                            <span className="text-gray-600">&lt;/</span><span className="text-red-300">url</span><span className="text-gray-600">&gt;</span>
                          </div>
                          {p.credentials?.method && (
                            <div className="px-2 py-0.5">
                              <span className="text-gray-600">&lt;</span><span className="text-red-300">method</span><span className="text-gray-600">&gt;</span>
                              <span className="text-teal-300">{p.credentials.method}</span>
                              <span className="text-gray-600">&lt;/</span><span className="text-red-300">method</span><span className="text-gray-600">&gt;</span>
                            </div>
                          )}
                          {p.validation?.keyword && (
                            <div className="px-2 py-0.5">
                              <span className="text-gray-600">&lt;</span><span className="text-red-300">keyword</span><span className="text-gray-600">&gt;</span>
                              <span className="text-yellow-300">{p.validation.keyword}</span>
                              <span className="text-gray-600">&lt;/</span><span className="text-red-300">keyword</span><span className="text-gray-600">&gt;</span>
                            </div>
                          )}
                          {p.credentials?.authHeader && (
                            <div className="px-2 py-0.5">
                              <span className="text-gray-600">&lt;</span><span className="text-red-300">auth</span><span className="text-gray-600">&gt;</span>
                              <span className="text-gray-500">{p.credentials.authHeader.substring(0, 24)}…</span>
                              <span className="text-gray-600">&lt;/</span><span className="text-red-300">auth</span><span className="text-gray-600">&gt;</span>
                            </div>
                          )}
                          <div className="px-2 py-0.5 text-gray-600">&lt;/<span className="text-red-400">project</span>&gt;</div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="px-2 py-0.5 pl-7 text-blue-400/50">&lt;/<span className="text-blue-300/50">monitor</span>&gt;</div>
              </div>
            </div>

            {/* Right: Properties panel */}
            <div className="flex-1 overflow-y-auto">
              {selectedProject ? (
                <>
                  <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/50 shrink-0 flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-mono font-bold uppercase tracking-wider">Computed Properties</span>
                    <span className="text-[10px] text-gray-600 font-mono">{selectedProject.name}</span>
                  </div>
                  <div className="p-3 font-mono text-[11px] space-y-px">
                    {([
                      { k: "id",                   v: selectedProject.id,                                                                     c: "text-gray-500" },
                      { k: "name",                 v: selectedProject.name,                                                                   c: "text-orange-300" },
                      { k: "type",                 v: selectedProject.type,                                                                   c: "text-purple-400" },
                      { k: "status",               v: selectedProject.status,                                                                 c: selectedProject.status === "operational" ? "text-green-400" : selectedProject.status === "down" ? "text-red-400" : "text-yellow-400" },
                      { k: "url",                  v: selectedProject.url,                                                                    c: "text-blue-400" },
                      { k: "uptime",               v: `${selectedProject.uptimePct.toFixed(1)}%`,                                            c: selectedProject.uptimePct > 90 ? "text-green-400" : selectedProject.uptimePct > 70 ? "text-yellow-400" : "text-red-400" },
                      { k: "checkInterval",        v: `${selectedProject.checkInterval} min`,                                                c: "text-gray-300" },
                      { k: "checks",               v: `${selectedProject.checkCount} total / ${selectedProject.successCount} success`,        c: "text-gray-300" },
                      ...(selectedProject.lastResponseTime !== undefined ? [{ k: "lastResponseTime", v: `${selectedProject.lastResponseTime}ms`, c: selectedProject.lastResponseTime > 3000 ? "text-red-400" : selectedProject.lastResponseTime > 1000 ? "text-yellow-400" : "text-green-400" }] : []),
                      ...(selectedProject.lastStatusCode !== undefined ? [{ k: "lastStatusCode", v: String(selectedProject.lastStatusCode),  c: (selectedProject.lastStatusCode ?? 0) >= 400 ? "text-red-400" : "text-green-400" }] : []),
                      ...(selectedProject.sslDaysLeft != null ? [{ k: "sslDaysLeft", v: `${selectedProject.sslDaysLeft}d`, c: selectedProject.sslDaysLeft < 14 ? "text-red-400" : selectedProject.sslDaysLeft < 30 ? "text-yellow-400" : "text-green-400" }] : []),
                      ...(selectedProject.credentials?.method ? [{ k: "method", v: selectedProject.credentials.method, c: "text-teal-400" }] : []),
                      ...(selectedProject.validation?.keyword ? [{ k: "keyword", v: `"${selectedProject.validation.keyword}"`, c: "text-yellow-300" }] : []),
                      ...(selectedProject.validation?.forbiddenKeyword ? [{ k: "forbidden", v: `"${selectedProject.validation.forbiddenKeyword}"`, c: "text-red-300" }] : []),
                      ...(selectedProject.responseTimeThreshold ? [{ k: "responseTimeThreshold", v: `${selectedProject.responseTimeThreshold}ms`, c: "text-gray-300" }] : []),
                      ...(selectedProject.notifyEmail ? [{ k: "notifyEmail", v: selectedProject.notifyEmail, c: "text-blue-400" }] : []),
                    ] as { k: string; v: string; c: string }[]).map(({ k, v, c }) => (
                      <div key={k} className="flex items-baseline gap-2 py-0.5 border-b border-gray-900/60">
                        <span className="w-44 text-teal-300 shrink-0">{k}</span>
                        <span className="text-gray-600 shrink-0">:</span>
                        <span className={cn("flex-1 break-all", c)}>{v}</span>
                      </div>
                    ))}
                    {/* Mini uptime bar */}
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <div className="text-[10px] text-gray-600 mb-1.5 font-bold uppercase tracking-wider">Uptime history · last {selectedProject.history.length} checks</div>
                      <div className="flex gap-[2px] h-4 items-end">
                        {selectedProject.history.slice(-40).map((v, i) => (
                          <div key={i} title={v === 1 ? "up" : "down"} className={cn("flex-1 rounded-[1px]", v === 1 ? "bg-green-500/70 h-full" : "bg-red-500/70 h-2/3")} />
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                  <span className="text-[11px] font-mono">Click an element to inspect</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════ CONSOLE ══════════════════════════ */}
        {activeTab === "Console" && (
          <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700 flex-wrap shrink-0">
              <button onClick={onClear} title="Clear console" className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/></svg>
              </button>
              <div className="w-px h-5 bg-gray-700 shrink-0" />
              <div className="relative flex-1 min-w-[140px]">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter log messages..." className="w-full bg-gray-800 text-gray-200 text-[11px] font-mono pl-7 pr-3 py-1.5 rounded border border-gray-700 focus:outline-none focus:border-brand placeholder:text-gray-600" />
                {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X size={10} /></button>}
              </div>
              <div className="w-px h-5 bg-gray-700 shrink-0" />
              <div className="flex gap-1">
                {(["all", "error", "warning", "success", "info"] as const).map((t) => {
                  const c = t === "all" ? { badge: "bg-gray-700 text-gray-300", dot: "" } : LOG_COLORS[t as LogType];
                  return (
                    <button key={t} onClick={() => setTypeFilter(t)} className={cn("px-2 py-1 rounded text-[10px] font-black uppercase tracking-wide transition-all flex items-center gap-1", typeFilter === t ? c.badge + " ring-1 ring-white/20" : "text-gray-600 hover:text-gray-400")}>
                      {t !== "all" && <span className={cn("w-1.5 h-1.5 rounded-full", LOG_COLORS[t as LogType].dot)} />}
                      {t}
                      {counts[t as keyof typeof counts] > 0 && <span className="opacity-70">{counts[t as keyof typeof counts]}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="w-px h-5 bg-gray-700 shrink-0" />
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="bg-gray-800 text-gray-400 text-[10px] font-mono px-2 py-1.5 rounded border border-gray-700 outline-none focus:border-brand max-w-[130px]">
                <option value="all">All Projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={copyAll} className="flex items-center gap-1 px-2 py-1.5 text-[10px] text-gray-500 hover:text-gray-300 font-mono transition-colors shrink-0">
                {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {/* ── Quick filter chips (Papertrail-style saved filters) ── */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900/80 border-b border-gray-800 overflow-x-auto shrink-0">
              <span className="text-[9px] text-gray-600 font-black uppercase tracking-widest shrink-0 mr-1">Quick:</span>
              {([
                { label: "Critical Errors",  query: "critical",           type: "error",   color: "bg-rose-900/50 text-rose-400 border-rose-800" },
                { label: "5xx Errors",       query: "500",                type: "error",   color: "bg-red-900/40 text-red-400 border-red-800" },
                { label: "Auth Issues",      query: "🔒",                 type: "warning", color: "bg-purple-900/40 text-purple-400 border-purple-800" },
                { label: "Functional Fails", query: "⚙",                  type: "warning", color: "bg-cyan-900/40 text-cyan-400 border-cyan-800" },
                { label: "Slow Responses",   query: "⚡",                  type: "warning", color: "bg-amber-900/40 text-amber-400 border-amber-800" },
                { label: "Soft 404s",        query: "⚠",                  type: "warning", color: "bg-yellow-900/40 text-yellow-400 border-yellow-800" },
                { label: "SSL Expiry",       query: "ssl",                type: "warning", color: "bg-teal-900/40 text-teal-400 border-teal-800" },
                { label: "DNS Errors",       query: "dns",                type: "error",   color: "bg-orange-900/40 text-orange-400 border-orange-800" },
                { label: "Timeouts",         query: "timeout",            type: "error",   color: "bg-indigo-900/40 text-indigo-400 border-indigo-800" },
              ] as { label: string; query: string; type: "all" | LogType; color: string }[]).map((chip) => {
                const isActive = search === chip.query && (typeFilter === chip.type || typeFilter === "all");
                return (
                  <button
                    key={chip.label}
                    onClick={() => {
                      if (isActive) {
                        setSearch("");
                        setTypeFilter("all");
                      } else {
                        setSearch(chip.query);
                        setTypeFilter(chip.type as any);
                      }
                    }}
                    className={`shrink-0 px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide transition-all ${isActive ? chip.color + " ring-1 ring-white/10" : "bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-500 hover:text-gray-300"}`}
                  >
                    {chip.label}
                  </button>
                );
              })}
              {(search || typeFilter !== "all") && (
                <button
                  onClick={() => { setSearch(""); setTypeFilter("all"); }}
                  className="shrink-0 ml-1 px-2 py-0.5 rounded border text-[9px] font-black text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500 transition-all"
                >
                  ✕ Clear
                </button>
              )}
            </div>

            {/* Log output */}
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
                  <Terminal size={32} className="opacity-30" />
                  <p className="text-[12px]">{logs.length === 0 ? "No logs yet. Monitoring checks will stream here in real-time." : "No logs match the current filter."}</p>
                </div>
              )}
              {filtered.map((log, i) => {
                const c = LOG_COLORS[log.type];
                const time = new Date(log.timestamp).toLocaleTimeString("en", { hour12: false });
                const ms = log.responseTime;
                const prev = filtered[i - 1];
                const showSep = !prev || new Date(log.timestamp).toDateString() !== new Date(prev.timestamp).toDateString();
                return (
                  <React.Fragment key={log.id}>
                    {showSep && (
                      <div className="flex items-center gap-3 px-4 py-1.5 border-y border-gray-800 bg-gray-900/50 sticky top-0 z-10">
                        <span className="text-[10px] text-gray-600 font-mono">{new Date(log.timestamp).toDateString()}</span>
                      </div>
                    )}
                    <div className={cn("flex items-start gap-3 px-4 py-1 hover:bg-white/[0.03] transition-colors group border-b border-gray-900/50", c.row)}>
                      <span className="text-gray-600 shrink-0 w-[72px] text-right tabular-nums">{time}</span>
                      <span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", c.dot)} />
                      <span className="text-gray-500 shrink-0 w-28 truncate" title={log.projectName}>{log.projectName}</span>
                      <span className={cn("flex-1 break-words", c.text)}>{log.message}</span>
                      {ms !== undefined && <span className={cn("shrink-0 text-[10px] font-mono tabular-nums opacity-0 group-hover:opacity-100 transition-opacity", ms > 3000 ? "text-red-400" : ms > 1000 ? "text-yellow-400" : "text-gray-500")}>{ms}ms</span>}
                      {log.statusCode && <span className={cn("shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity", log.statusCode >= 500 ? "bg-red-900/50 text-red-400" : log.statusCode >= 400 ? "bg-yellow-900/50 text-yellow-400" : "bg-green-900/30 text-green-500")}>{log.statusCode}</span>}
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={bottomRef} />
            </div>
            {!autoScroll && (
              <button onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="absolute bottom-8 right-8 flex items-center gap-2 px-3 py-2 bg-brand text-black text-[10px] font-black rounded-xl shadow-xl hover:scale-105 transition-transform z-20">
                <ArrowLeft size={12} className="rotate-[-90deg]" /> Latest
              </button>
            )}
          </div>
        )}

        {/* ══════════════════════════ NETWORK ══════════════════════════ */}
        {activeTab === "Network" && (
          <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700 flex-wrap shrink-0">
              {(["All", "HTTP", "TCP"] as const).map((f) => (
                <button key={f} onClick={() => setNetFilter(f)} className={cn("px-2.5 py-1 rounded text-[10px] font-bold transition-all", netFilter === f ? (f === "TCP" ? "bg-teal-600/30 text-teal-400 ring-1 ring-teal-500/30" : f === "HTTP" ? "bg-purple-600/30 text-purple-400 ring-1 ring-purple-500/30" : "bg-blue-600/30 text-blue-400 ring-1 ring-blue-500/30") : "text-gray-500 hover:text-gray-300")}>{f}</button>
              ))}
              <div className="w-px h-5 bg-gray-700 shrink-0" />
              <div className="relative flex-1 min-w-[140px]">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={netSearch} onChange={(e) => setNetSearch(e.target.value)} placeholder="Filter requests…" className="w-full bg-gray-800 text-gray-200 text-[11px] font-mono pl-7 pr-3 py-1.5 rounded border border-gray-700 focus:outline-none focus:border-brand placeholder:text-gray-600" />
                {netSearch && <button onClick={() => setNetSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"><X size={10} /></button>}
              </div>
              <span className="text-[10px] text-gray-600 font-mono ml-auto shrink-0">{networkLogs.length} requests</span>
            </div>
            {/* Column headers */}
            <div className="flex items-center px-3 py-1.5 border-b border-gray-800 bg-gray-900/30 text-[10px] text-gray-500 font-bold tracking-wider uppercase shrink-0 font-mono select-none">
              <span className="w-5 shrink-0" />
              <span className="w-16 shrink-0">Method</span>
              <span className="flex-1">Name</span>
              <span className="w-28 shrink-0">Host</span>
              <span className="w-16 text-right shrink-0">Status</span>
              <span className="w-24 text-right shrink-0">Time</span>
              <span className="w-16 text-right shrink-0">Type</span>
            </div>
            {/* Rows */}
            <div className="flex-1 overflow-y-auto font-mono text-[11px]">
              {networkLogs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  <p className="text-[12px]">No network requests match the filter.</p>
                </div>
              )}
              {networkLogs.map((log) => {
                const proj   = projects.find((p) => p.id === log.projectId);
                const isTCP  = log.message.startsWith("[TCP]");
                const method = isTCP ? "TCP" : (proj?.credentials?.method || "GET");
                const statusMatch = log.message.match(/\b(\d{3})\b/);
                const status = statusMatch ? parseInt(statusMatch[1]) : null;
                const sel    = selectedRowId === log.id;
                const mc     = method === "GET" ? "text-green-400" : method === "POST" ? "text-blue-400" : method === "DELETE" ? "text-red-400" : method === "PUT" ? "text-orange-400" : method === "PATCH" ? "text-purple-400" : method === "HEAD" ? "text-teal-400" : method === "TCP" ? "text-cyan-400" : "text-gray-400";
                const maxBar = 60;
                const barW   = log.responseTime ? Math.min(log.responseTime / 40, maxBar) : 0;
                return (
                  <div key={log.id}>
                    <div
                      onClick={() => setSelectedRowId(sel ? null : log.id)}
                      className={cn("flex items-center px-3 py-1.5 border-b border-gray-900/50 cursor-pointer hover:bg-white/[0.03] transition-colors", sel && "bg-blue-600/10 border-blue-600/20", log.type === "error" && !sel && "bg-red-950/10")}
                    >
                      <span className={cn("w-2 h-2 rounded-full mr-3 shrink-0", log.type === "success" ? "bg-green-500" : log.type === "error" ? "bg-red-500" : log.type === "warning" ? "bg-yellow-500" : "bg-blue-500")} />
                      <span className={cn("w-16 font-bold shrink-0", mc)}>{method}</span>
                      <span className="flex-1 text-gray-300 truncate">{log.projectName}</span>
                      <span className="w-28 text-gray-600 truncate text-[10px] shrink-0">{proj?.url?.replace(/^https?:\/\//, "").split("/")[0] || "—"}</span>
                      <span className={cn("w-16 text-right tabular-nums shrink-0", !status ? "text-gray-600" : status >= 500 ? "text-red-400" : status >= 400 ? "text-yellow-400" : "text-green-400")}>{status || "—"}</span>
                      <span className={cn("w-24 text-right tabular-nums shrink-0 flex items-center justify-end gap-1.5", log.responseTime === undefined ? "text-gray-600" : log.responseTime > 3000 ? "text-red-400" : log.responseTime > 1000 ? "text-yellow-400" : "text-gray-300")}>
                        {log.responseTime !== undefined && <span className="inline-block h-1.5 rounded-full bg-current opacity-40 shrink-0" style={{ width: barW }} />}
                        {log.responseTime !== undefined ? `${log.responseTime}ms` : "—"}
                      </span>
                      <span className="w-16 text-right text-gray-600 shrink-0">{proj?.type || "—"}</span>
                    </div>
                    {/* Expanded row detail */}
                    {sel && (
                      <div className="bg-gray-900/60 border-b border-gray-700 px-6 py-3 grid grid-cols-2 gap-x-8 gap-y-1 text-[10px] font-mono">
                        <div>
                          <div className="text-gray-500 font-bold uppercase tracking-wider mb-2">Request Headers</div>
                          {[
                            { k: "URL",    v: proj?.url || "—" },
                            { k: "Method", v: method },
                            ...(proj?.credentials?.authHeader ? [{ k: "Authorization", v: proj.credentials.authHeader.slice(0, 32) + "…" }] : []),
                            ...(proj?.credentials?.customHeaders ? Object.entries(proj.credentials.customHeaders).map(([hk, hv]) => ({ k: hk, v: hv })) : []),
                          ].map(({ k, v }) => (
                            <div key={k} className="flex gap-2 mb-0.5">
                              <span className="text-gray-500 shrink-0 w-24">{k}:</span>
                              <span className="text-gray-300 break-all">{v}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="text-gray-500 font-bold uppercase tracking-wider mb-2">Response</div>
                          {[
                            { k: "Status",   v: status ? String(status) : "—", c: !status ? "text-gray-400" : status >= 400 ? "text-red-400" : "text-green-400" },
                            { k: "Duration", v: log.responseTime !== undefined ? `${log.responseTime}ms` : "—", c: !log.responseTime ? "text-gray-400" : log.responseTime > 3000 ? "text-red-400" : log.responseTime > 1000 ? "text-yellow-400" : "text-green-400" },
                            { k: "Time",     v: new Date(log.timestamp).toLocaleTimeString(), c: "text-gray-300" },
                            { k: "Message",  v: log.message, c: LOG_COLORS[log.type].text },
                          ].map(({ k, v, c }) => (
                            <div key={k} className="flex gap-2 mb-0.5">
                              <span className="text-gray-500 shrink-0 w-24">{k}:</span>
                              <span className={cn("break-all", c)}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══════════════════════════ SOURCES ══════════════════════════ */}
        {activeTab === "Sources" && (
          <div className="flex h-full">
            {/* Left: file tree */}
            <div className="w-52 border-r border-gray-800 overflow-y-auto bg-gray-900/20 shrink-0">
              <div className="px-3 py-2 border-b border-gray-800 shrink-0">
                <span className="text-[10px] text-gray-500 font-mono font-bold uppercase tracking-wider">Project Sources</span>
              </div>
              <div className="p-2 font-mono text-[11px]">
                <div onClick={() => setSelectedSourceId("__settings__")} className={cn("flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer mb-1", selectedSourceId === "__settings__" ? "bg-blue-600/20 text-blue-300" : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]")}>
                  <span className="text-yellow-400/70 text-[10px]">⚙</span> settings.json
                </div>
                {Object.entries(sourceGroups).map(([type, projs]) => (
                  <div key={type} className="mt-2">
                    <div className="flex items-center gap-1 px-2 py-0.5 text-gray-600 text-[10px] font-bold uppercase tracking-wider select-none">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M0 2l4 4 4-4z"/></svg>
                      {type}s/
                    </div>
                    {projs.map((p) => (
                      <div key={p.id} onClick={() => setSelectedSourceId(p.id)} className={cn("flex items-center gap-1.5 px-4 py-1 rounded cursor-pointer", selectedSourceId === p.id ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]")}>
                        <span className={cn("text-[10px] shrink-0", type === "website" ? "text-blue-400/70" : type === "api" ? "text-purple-400/70" : type === "server" ? "text-orange-400/70" : "text-emerald-400/70")}>◆</span>
                        <span className="truncate">{p.name.toLowerCase().replace(/\s+/g, "_")}.json</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {/* Right: JSON viewer */}
            <div className="flex-1 overflow-auto">
              {selectedSourceId ? (
                <>
                  <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/20 shrink-0 flex items-center gap-2">
                    <span className="text-[10px] text-gray-400 font-mono">
                      {selectedSourceId === "__settings__" ? "settings.json" : `${selectedSourceProject?.type}s/${selectedSourceProject?.name.toLowerCase().replace(/\s+/g, "_")}.json`}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-600 font-mono bg-gray-800 px-2 py-0.5 rounded">JSON</span>
                  </div>
                  <div className="p-4 font-mono text-[11px] leading-5">
                    {renderJson(
                      selectedSourceId === "__settings__"
                        ? { _note: "Settings stored in data/settings.json on the server", checkIntervals: "in minutes", logRetention: 500, projects: projects.length }
                        : (() => {
                            const p = selectedSourceProject;
                            if (!p) return {};
                            return {
                              id: p.id, name: p.name, url: p.url, type: p.type,
                              status: p.status, enabled: p.enabled,
                              checkInterval: p.checkInterval,
                              uptimePct: p.uptimePct,
                              checkCount: p.checkCount, successCount: p.successCount,
                              lastChecked: p.lastChecked ? new Date(p.lastChecked).toISOString() : null,
                              lastStatusCode: p.lastStatusCode ?? null,
                              lastResponseTime: p.lastResponseTime ?? null,
                              sslDaysLeft: p.sslDaysLeft ?? null,
                              ...(p.credentials ? { credentials: { method: p.credentials.method || "GET", hasAuth: !!p.credentials.authHeader, customHeaders: p.credentials.customHeaders || {} } } : {}),
                              ...(p.validation ? { validation: p.validation } : {}),
                              ...(p.responseTimeThreshold ? { responseTimeThreshold: p.responseTimeThreshold } : {}),
                              historyLength: p.history.length,
                            };
                          })()
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-30"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                  <span className="text-[11px] font-mono">Select a file to view source</span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// ─── ProjectsView ─────────────────────────────────────────────────────────────

const ProjectsView = ({
  projects,
  onSelectProject,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onToggleProject,
  onCheckProject,
  onRefresh,
}: {
  projects: Project[];
  onSelectProject: (p: Project) => void;
  onAddProject: () => void;
  onEditProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onToggleProject: (p: Project) => void;
  onCheckProject: (p: Project) => Promise<void>;
  onRefresh: () => Promise<void>;
}) => {
  const down = projects.filter((p) => p.status === "down");
  const degraded = projects.filter((p) => p.status === "degraded");
  const ok = projects.filter((p) => p.status === "operational");

  return (
    <div className="space-y-8">
      {/* Summary row */}
      {projects.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "All Systems Up", count: ok.length, total: projects.length, color: "text-brand", bg: "bg-brand/10" },
            { label: "Degraded", count: degraded.length, total: projects.length, color: "text-amber-500", bg: "bg-amber-50" },
            { label: "Down", count: down.length, total: projects.length, color: "text-rose-500", bg: "bg-rose-50" },
          ].map(({ label, count, total, color, bg }) => (
            <div key={label} className={cn("rounded-xl p-4 border", bg, count > 0 && label !== "All Systems Up" ? "border-current opacity-100" : "border-transparent")}>
              <p className={cn("text-3xl font-black font-mono", color)}>{count}</p>
              <p className="text-xs text-text-dim font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Projects grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">
            {projects.length} Project{projects.length !== 1 ? "s" : ""}
          </h3>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-text-dim hover:text-text-main transition-colors"
          >
            <RefreshCcw size={10} /> Refresh
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center border border-dashed border-gray-200 rounded-2xl bg-white">
            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-5">
              <Activity size={28} className="text-gray-200" />
            </div>
            <h3 className="font-bold text-text-main mb-1">No projects yet</h3>
            <p className="text-sm text-text-dim mb-6 text-center max-w-xs">
              Add your first project to start monitoring its status and logs.
            </p>
            <button
              onClick={onAddProject}
              className="flex items-center gap-2 px-6 py-3 bg-text-main text-white text-sm font-black uppercase tracking-wider rounded-xl hover:bg-brand hover:text-black transition-all"
            >
              <Plus size={14} /> Add First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => onSelectProject(project)}
                onEdit={() => onEditProject(project)}
                onDelete={() => onDeleteProject(project.id)}
                onToggle={() => onToggleProject(project)}
                onCheck={() => onCheckProject(project)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Analysis views (kept from original) ─────────────────────────────────────

const StatusIcon = ({ status, size = 20 }: { status: StatusType; size?: number }) => {
  switch (status) {
    case "operational": return <CheckCircle2 size={size} className="text-brand" />;
    case "degraded": return <AlertTriangle size={size} className="text-amber-500" />;
    case "partial_outage": return <AlertCircle size={size} className="text-orange-500" />;
    case "major_outage": return <AlertCircle size={size} className="text-rose-500" />;
    case "maintenance": return <Clock size={size} className="text-blue-500" />;
    case "not_found": return <AlertCircle size={size} className="text-gray-400" />;
  }
};

// ─── APM View ────────────────────────────────────────────────────────────────

const APMView = () => {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetch = () => {
    setLoading(true);
    axios.get("/api/apm").then((r) => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const latColor = (ms: number | null) =>
    !ms ? "text-gray-400" : ms < 300 ? "text-brand" : ms < 1000 ? "text-amber-500" : "text-rose-500";

  if (loading) return <div className="py-20 text-center text-sm text-text-dim">Loading APM data…</div>;
  if (!data)   return null;
  const { projects, summary } = data;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <TrendingUp size={22} className="text-brand" /> APM · Application Performance
          </h2>
          <p className="text-xs text-text-dim mt-1">Latency percentiles, error rates, and throughput for all monitored services</p>
        </div>
        <button onClick={fetch} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors">
          <RefreshCcw size={13} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Avg P95 Latency",   value: summary.avgP95 ? `${summary.avgP95}ms` : "—",   sub: "95th percentile", color: latColor(summary.avgP95) },
          { label: "Avg Error Rate",    value: `${summary.avgErrorRate}%`,   sub: "across all services", color: summary.avgErrorRate > 5 ? "text-rose-500" : summary.avgErrorRate > 1 ? "text-amber-500" : "text-brand" },
          { label: "Avg Availability",  value: `${summary.avgAvailability}%`, sub: "last 500 checks",     color: summary.avgAvailability > 99 ? "text-brand" : summary.avgAvailability > 95 ? "text-amber-500" : "text-rose-500" },
          { label: "Services",          value: summary.totalProjects,         sub: "monitored endpoints",  color: "text-text-main" },
        ].map((card, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-2">{card.label}</p>
            <p className={cn("text-2xl font-black", card.color)}>{card.value}</p>
            <p className="text-[10px] text-text-dim mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Latency breakdown table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3 flex items-center gap-2">
          <BarChart2 size={14} className="text-brand" />
          <span className="text-[10px] font-black uppercase tracking-widest text-text-dim">Latency Breakdown by Service</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                {["Service", "Type", "Status", "P50", "P75", "P95", "P99", "Error %", "Apdex", "Checks/hr"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-text-dim whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p: any) => (
                <React.Fragment key={p.id}>
                  <tr
                    className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ChevronDown size={12} className={cn("text-gray-400 transition-transform shrink-0", expanded === p.id && "rotate-180")} />
                        <span className="font-semibold text-xs truncate max-w-[140px]">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="text-[10px] font-black uppercase text-text-dim">{p.type}</span></td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    {[p.p50, p.p75, p.p95, p.p99].map((ms: number | null, i: number) => (
                      <td key={i} className={cn("px-4 py-3 font-mono text-xs font-bold", latColor(ms))}>{ms ? `${ms}ms` : "—"}</td>
                    ))}
                    <td className={cn("px-4 py-3 font-mono text-xs font-bold", p.errorRate > 5 ? "text-rose-500" : p.errorRate > 1 ? "text-amber-500" : "text-brand")}>
                      {p.errorRate}%
                    </td>
                    <td className={cn("px-4 py-3 font-mono text-xs font-bold",
                      p.apdex === null ? "text-gray-400" : p.apdex >= 0.9 ? "text-brand" : p.apdex >= 0.7 ? "text-amber-500" : "text-rose-500"
                    )}>
                      {p.apdex !== null ? p.apdex.toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-dim font-mono">{p.checksPerHour}</td>
                  </tr>
                  {expanded === p.id && (
                    <tr>
                      <td colSpan={10} className="bg-gray-50/50 px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-3">24-Hour Response Time Trend (P50 & P95)</div>
                        <ResponsiveContainer width="100%" height={130}>
                          <AreaChart data={p.timeSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                            <XAxis dataKey="hour" tickFormatter={(v: string) => `${new Date(v).getHours()}h`} tick={{ fontSize: 9, fill: "#9ca3af" }} interval={3} />
                            <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} />
                            <Tooltip
                              formatter={(v: number, name: string) => [`${v}ms`, name]}
                              labelFormatter={(l: string) => new Date(l).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            />
                            <Area type="monotone" dataKey="p95" stroke="#f59e0b" fill="#fef3c7" name="P95" strokeWidth={1.5} dot={false} />
                            <Area type="monotone" dataKey="p50" stroke="#3ecf8e" fill="#ecfdf5" name="P50" strokeWidth={1.5} dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                        <div className="grid grid-cols-5 gap-3 mt-3">
                          {[
                            { label: "Min",         value: p.min  ? `${p.min}ms`  : "—" },
                            { label: "Avg",         value: p.avg  ? `${p.avg}ms`  : "—" },
                            { label: "P95",         value: p.p95  ? `${p.p95}ms`  : "—" },
                            { label: "Max",         value: p.max  ? `${p.max}ms`  : "—" },
                            { label: "Total Checks",value: p.checksTotal },
                          ].map((stat, i) => (
                            <div key={i} className="bg-white border border-gray-100 rounded-lg p-2 text-center">
                              <p className="text-[9px] font-black uppercase tracking-widest text-text-dim">{stat.label}</p>
                              <p className="text-sm font-black text-text-main mt-0.5">{stat.value}</p>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {projects.length === 0 && (
                <tr><td colSpan={10} className="py-12 text-center text-sm text-text-dim">No monitoring data yet. Add projects and run checks first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apdex legend */}
      <div className="mt-4 flex items-center gap-6 text-[10px] text-text-dim">
        <span className="font-black uppercase tracking-widest">Apdex (T=1500ms):</span>
        {[["≥ 0.94", "Excellent", "text-brand"], ["≥ 0.85", "Good", "text-blue-500"], ["≥ 0.70", "Fair", "text-amber-500"], ["< 0.70", "Poor", "text-rose-500"]].map(([range, label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className={cn("font-black", color)}>{range}</span> {label}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── Traces View ─────────────────────────────────────────────────────────────

const TracesView = () => {
  const [url, setUrl]         = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState<any>(null);
  const [error, setError]     = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const runTrace = async () => {
    if (!url) return;
    setRunning(true); setError(null);
    try {
      const r = await axios.post("/api/trace", { url }, { timeout: 20000 });
      setResult(r.data);
      setHistory((prev) => [r.data, ...prev].slice(0, 10));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || "Trace failed");
    } finally {
      setRunning(false);
    }
  };

  const WBar = ({ label, value, color, total }: { label: string; value: number | null; color: string; total: number }) => {
    if (value === null || value === 0) return null;
    const pct = Math.max(2, Math.round(value / total * 100));
    return (
      <div className="flex items-center gap-3 mb-2.5">
        <div className="w-28 text-[10px] font-black uppercase tracking-wider text-text-dim text-right shrink-0">{label}</div>
        <div className="flex-grow bg-gray-100 rounded-full h-5 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
        </div>
        <div className="w-14 text-xs font-mono font-bold text-right shrink-0">{value}ms</div>
        <div className="w-8 text-[10px] text-text-dim text-right shrink-0">{pct}%</div>
      </div>
    );
  };

  const perf = result ? (result.timings.total < 500 ? { label: "Fast", color: "bg-brand/10 text-brand" }
                        : result.timings.total < 2000 ? { label: "Moderate", color: "bg-amber-50 text-amber-600" }
                        : { label: "Slow", color: "bg-rose-50 text-rose-600" }) : null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
          <Timer size={22} className="text-brand" /> Traces · Request Timing
        </h2>
        <p className="text-xs text-text-dim mt-1">Waterfall breakdown: DNS lookup → TCP connect → TLS handshake → TTFB → Transfer</p>
      </div>

      {/* URL input */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 mb-6 flex gap-3 items-center shadow-sm">
        <Globe size={16} className="text-gray-400 shrink-0" />
        <input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !running && runTrace()}
          className="flex-grow text-sm outline-none bg-transparent placeholder:text-gray-300"
        />
        <button
          onClick={runTrace}
          disabled={!url || running}
          className="px-5 py-2 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all disabled:opacity-40 flex items-center gap-2 shrink-0"
        >
          {running ? <><RefreshCcw size={12} className="animate-spin" /> Running…</> : "▶ Run Trace"}
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-4 text-sm text-rose-600">{error}</div>}

      {result && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="font-bold text-sm break-all">{result.url}</p>
              <p className="text-xs text-text-dim mt-0.5">HTTP {result.statusCode} · {result.timings.total}ms total</p>
            </div>
            {perf && <span className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase shrink-0", perf.color)}>{perf.label}</span>}
          </div>

          <WBar label="DNS Lookup"    value={result.timings.dns}      color="bg-purple-400"  total={result.timings.total} />
          <WBar label="TCP Connect"   value={result.timings.tcp}      color="bg-blue-400"    total={result.timings.total} />
          <WBar label="TLS Handshake" value={result.timings.tls}      color="bg-indigo-400"  total={result.timings.total} />
          <WBar label="TTFB"          value={result.timings.ttfb}     color="bg-amber-400"   total={result.timings.total} />
          <WBar label="Transfer"      value={result.timings.transfer} color="bg-brand"       total={result.timings.total} />

          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
            <div className="flex-grow h-2.5 rounded-full overflow-hidden flex">
              {[
                { v: result.timings.dns,      c: "bg-purple-400" },
                { v: result.timings.tcp,      c: "bg-blue-400" },
                { v: result.timings.tls,      c: "bg-indigo-400" },
                { v: result.timings.ttfb,     c: "bg-amber-400" },
                { v: result.timings.transfer, c: "bg-brand" },
              ].filter((s) => s.v).map((s, i) => (
                <div key={i} className={s.c} style={{ width: `${Math.max(1, Math.round(s.v / result.timings.total * 100))}%` }} />
              ))}
            </div>
            <span className="font-black text-sm shrink-0">{result.timings.total}ms</span>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-3">
            {[
              { label: "Response Size",  value: result.response.size ? `${(result.response.size / 1024).toFixed(1)} KB` : "—" },
              { label: "Content Type",   value: (result.response.contentType || "—").split(";")[0] || "—" },
              { label: "Server",         value: result.response.server || "—" },
              { label: "Cache-Control",  value: result.response.cacheControl || "—" },
            ].map((item, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-text-dim">{item.label}</p>
                <p className="text-xs font-semibold mt-1 truncate" title={item.value}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Performance tips */}
          {result.timings.total > 1000 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1.5">Performance Tips</p>
              <ul className="text-xs text-amber-800 space-y-1">
                {result.timings.dns > 100 && <li>• DNS lookup is slow ({result.timings.dns}ms) — consider using a faster DNS provider or DNS prefetch</li>}
                {result.timings.tcp > 200 && <li>• TCP connect is slow ({result.timings.tcp}ms) — server may be far from your location (CDN recommended)</li>}
                {result.timings.tls > 300 && <li>• TLS handshake is slow ({result.timings.tls}ms) — check TLS version (TLS 1.3 is faster)</li>}
                {result.timings.ttfb > 500 && <li>• TTFB is high ({result.timings.ttfb}ms) — server processing time is slow, check backend performance</li>}
                {result.timings.transfer > 500 && <li>• Transfer is slow ({result.timings.transfer}ms) — enable compression (gzip/brotli) to reduce payload size</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {[
          { color: "bg-purple-400", label: "DNS" },
          { color: "bg-blue-400",   label: "TCP" },
          { color: "bg-indigo-400", label: "TLS" },
          { color: "bg-amber-400",  label: "TTFB" },
          { color: "bg-brand",      label: "Transfer" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-text-dim">
            <div className={cn("w-3 h-3 rounded", l.color)} /> {l.label}
          </div>
        ))}
      </div>

      {/* History */}
      {history.length > 1 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-text-dim">Recent Traces</span>
          </div>
          {history.map((h, i) => (
            <div key={i} onClick={() => setResult(h)} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer last:border-0">
              <div>
                <p className="text-xs font-semibold truncate max-w-xs">{h.url}</p>
                <p className="text-[10px] text-text-dim">HTTP {h.statusCode} · DNS {h.timings.dns}ms · TTFB {h.timings.ttfb}ms</p>
              </div>
              <span className={cn("text-sm font-black font-mono shrink-0", h.timings.total < 500 ? "text-brand" : h.timings.total < 2000 ? "text-amber-500" : "text-rose-500")}>
                {h.timings.total}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Service Map View ─────────────────────────────────────────────────────────

const SM_TYPE_STYLE: Record<string, { bg: string; border: string; text: string; dot: string; nodeBorder: string; icon: React.ReactNode }> = {
  website:  { bg: "bg-blue-50",    border: "border-blue-200",    text: "text-blue-700",    dot: "#3b82f6", nodeBorder: "border-blue-100",    icon: <Globe size={12} className="text-blue-500" /> },
  api:      { bg: "bg-purple-50",  border: "border-purple-200",  text: "text-purple-700",  dot: "#a855f7", nodeBorder: "border-purple-100",  icon: <Terminal size={12} className="text-purple-500" /> },
  server:   { bg: "bg-orange-50",  border: "border-orange-200",  text: "text-orange-700",  dot: "#f97316", nodeBorder: "border-orange-100",  icon: <Server size={12} className="text-orange-500" /> },
  database: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "#10b981", nodeBorder: "border-emerald-100", icon: <Database size={12} className="text-emerald-500" /> },
};
const SM_STATUS_DOT: Record<string, string> = {
  operational: "bg-brand",
  degraded:    "bg-amber-500",
  down:        "bg-rose-500 animate-pulse",
  unknown:     "bg-gray-300",
};

const ServiceMapNodeCard: React.FC<{
  node: any; borderClass: string; showTypeLabel?: boolean; onSelectProject?: (id: string) => void;
}> = ({ node, borderClass, showTypeLabel, onSelectProject }) => {
  let hostname = node.url;
  try { hostname = new URL(node.url.startsWith("http") ? node.url : `http://${node.url}`).hostname; } catch {}
  const ts = SM_TYPE_STYLE[node.type as string] || SM_TYPE_STYLE.website;
  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      onClick={() => onSelectProject?.(node.id)}
      className={cn("bg-white border rounded-xl p-3 cursor-pointer shadow-sm hover:shadow-md transition-all", borderClass)}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-2 h-2 rounded-full shrink-0", SM_STATUS_DOT[node.status] || "bg-gray-300")} />
          {showTypeLabel && (
            <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded", ts.bg, ts.text)}>{node.type}</span>
          )}
        </div>
        {node.openIssue && (
          <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full",
            node.openIssue.severity === "critical" ? "bg-rose-50 text-rose-600" :
            node.openIssue.severity === "high"     ? "bg-orange-50 text-orange-600" : "bg-amber-50 text-amber-600"
          )}>{node.openIssue.severity}</span>
        )}
      </div>
      <p className="font-bold text-xs leading-tight">{node.name}</p>
      <p className="text-[10px] text-text-dim mt-0.5 truncate">{hostname}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] font-mono text-text-dim">{node.uptimePct.toFixed(1)}% up</span>
        {node.p95Latency !== null && (
          <span className={cn("text-[10px] font-mono font-bold",
            node.p95Latency < 500 ? "text-brand" : node.p95Latency < 2000 ? "text-amber-500" : "text-rose-500"
          )}>{node.p95Latency}ms</span>
        )}
      </div>
    </motion.div>
  );
};

const ServiceMapView = ({ onSelectProject }: { onSelectProject?: (id: string) => void }) => {
  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [viewMode, setViewMode] = useState<"type" | "status">("type");

  const doFetch = () => {
    setLoading(true);
    axios.get("/api/service-map").then((r) => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { doFetch(); }, []);

  if (loading) return <div className="py-20 text-center text-sm text-text-dim">Loading service map…</div>;
  if (!data)   return null;

  const { nodes } = data;
  const types = ["website", "api", "server", "database"] as ProjectType[];

  // Only show sections that actually have services
  const activeTypes = types.filter((t) => nodes.some((n: any) => n.type === t));
  const grouped: Record<string, any[]> = {};
  types.forEach((t) => { grouped[t] = nodes.filter((n: any) => n.type === t); });

  const statusGroups: Record<string, { label: string; bg: string; border: string; dot: string }> = {
    operational: { label: "Operational", bg: "bg-brand/5",  border: "border-brand/20",  dot: "bg-brand" },
    degraded:    { label: "Degraded",    bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500" },
    down:        { label: "Down",        bg: "bg-rose-50",  border: "border-rose-200",  dot: "bg-rose-500" },
    unknown:     { label: "Unknown",     bg: "bg-gray-50",  border: "border-gray-200",  dot: "bg-gray-400" },
  };

  const totalDown     = nodes.filter((n: any) => n.status === "down").length;
  const totalDegraded = nodes.filter((n: any) => n.status === "degraded").length;
  const totalOk       = nodes.filter((n: any) => n.status === "operational").length;

  // Adapt grid cols to how many types are active
  const colCount  = Math.max(1, activeTypes.length);
  const gridClass = colCount === 1 ? "grid-cols-3" : colCount === 2 ? "grid-cols-2" : colCount === 3 ? "grid-cols-3" : "grid-cols-4";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <Network size={22} className="text-brand" /> Service Map · Topology
          </h2>
          <p className="text-xs text-text-dim mt-1">Click any node to open project detail</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl gap-1">
            {(["type", "status"] as const).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                className={cn("px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  viewMode === m ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
                )}
              >
                By {m}
              </button>
            ))}
          </div>
          <button onClick={doFetch} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors">
            <RefreshCcw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Global health banner */}
      <div className={cn("flex items-center gap-4 px-4 py-3 rounded-xl border mb-5",
        totalDown > 0 ? "bg-rose-50 border-rose-200" : totalDegraded > 0 ? "bg-amber-50 border-amber-200" : "bg-brand/5 border-brand/20"
      )}>
        <div className={cn("w-2.5 h-2.5 rounded-full shrink-0",
          totalDown > 0 ? "bg-rose-500 animate-pulse" : totalDegraded > 0 ? "bg-amber-500" : "bg-brand")} />
        <span className="text-xs font-bold">
          {totalDown > 0 ? `${totalDown} service${totalDown > 1 ? "s" : ""} down` :
           totalDegraded > 0 ? `${totalDegraded} service${totalDegraded > 1 ? "s" : ""} degraded` :
           "All services operational"}
        </span>
        <div className="flex items-center gap-4 ml-auto text-[10px] text-text-dim">
          <span className="text-brand font-bold">{totalOk} healthy</span>
          {totalDegraded > 0 && <span className="text-amber-500 font-bold">{totalDegraded} degraded</span>}
          {totalDown > 0 && <span className="text-rose-500 font-bold">{totalDown} down</span>}
          <span>of {nodes.length} total</span>
        </div>
      </div>

      {/* Type summary chips */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {types.map((t) => {
          const tNodes  = grouped[t] || [];
          const healthy = tNodes.filter((n: any) => n.status === "operational").length;
          const ts      = SM_TYPE_STYLE[t];
          return (
            <div key={t} className={cn("flex items-center gap-2 px-3 py-2 border rounded-xl text-[10px]", ts.bg, ts.border)}>
              {ts.icon}
              <span className={cn("font-black uppercase tracking-widest", ts.text)}>{t}</span>
              <span className="font-black text-text-main">{tNodes.length}</span>
              {tNodes.length > 0 && <span className="text-text-dim">({healthy} ok)</span>}
            </div>
          );
        })}
      </div>

      {/* ── BY TYPE view ── */}
      {viewMode === "type" && (
        <>
          {activeTypes.length === 0 && (
            <div className="py-20 text-center border border-dashed border-gray-200 rounded-2xl">
              <Network size={32} className="text-gray-300 mx-auto mb-4" />
              <p className="font-bold text-text-main mb-1">No services yet</p>
              <p className="text-sm text-text-dim">Add projects to see your service topology</p>
            </div>
          )}

          {activeTypes.map((t) => {
            const tNodes = grouped[t] || [];
            const ts     = SM_TYPE_STYLE[t];
            return (
              <div key={t} className="mb-6">
                {/* Section header */}
                <div className={cn("flex items-center gap-2 px-4 py-2 rounded-xl border mb-3", ts.bg, ts.border)}>
                  {ts.icon}
                  <span className={cn("text-[10px] font-black uppercase tracking-widest", ts.text)}>{t} services</span>
                  <span className={cn("ml-1 text-[10px] font-black", ts.text)}>{tNodes.length}</span>
                </div>
                {/* Responsive node grid — fills full width */}
                <div className={cn("grid gap-3", gridClass)}>
                  {tNodes.map((node: any) => (
                    <ServiceMapNodeCard key={node.id} node={node} borderClass={ts.nodeBorder} onSelectProject={onSelectProject} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── BY STATUS view ── */}
      {viewMode === "status" && (
        <div className="space-y-5">
          {(["down", "degraded", "operational", "unknown"] as const).map((s) => {
            const sNodes = nodes.filter((n: any) => n.status === s);
            if (sNodes.length === 0) return null;
            const sg = statusGroups[s];
            return (
              <div key={s}>
                <div className={cn("flex items-center gap-2 px-4 py-2 rounded-xl border mb-3", sg.bg, sg.border)}>
                  <span className={cn("w-2 h-2 rounded-full", sg.dot)} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-text-main">{sg.label}</span>
                  <span className="text-[10px] font-black text-text-dim ml-1">{sNodes.length} service{sNodes.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {sNodes.map((node: any) => {
                    const ts = SM_TYPE_STYLE[node.type as string] || SM_TYPE_STYLE.website;
                    return <ServiceMapNodeCard key={node.id} node={node} borderClass={ts.nodeBorder} showTypeLabel onSelectProject={onSelectProject} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Logs View ────────────────────────────────────────────────────────────────

const LOG_LEVEL_STYLE = {
  INFO:  { text: "text-blue-600",  bg: "bg-blue-50",   border: "border-blue-200",  bar: "#3b82f6" },
  WARN:  { text: "text-amber-600", bg: "bg-amber-50",  border: "border-amber-200", bar: "#f59e0b" },
  ERROR: { text: "text-rose-600",  bg: "bg-rose-50",   border: "border-rose-200",  bar: "#ef4444" },
  DEBUG: { text: "text-gray-500",  bg: "bg-gray-50",   border: "border-gray-200",  bar: "#9ca3af" },
} as const;

const LOG_TIME_RANGES = [
  { label: "Last 15 min",  value: "15m",  ms: 15  * 60 * 1000 },
  { label: "Last 30 min",  value: "30m",  ms: 30  * 60 * 1000 },
  { label: "Last 1 hour",  value: "1h",   ms: 60  * 60 * 1000 },
  { label: "Last 6 hours", value: "6h",   ms: 6   * 60 * 60 * 1000 },
  { label: "Last 24 hours",value: "24h",  ms: 24  * 60 * 60 * 1000 },
] as const;

const LogsView = () => {
  const [logs, setLogs]             = useState<any[]>([]);
  const [histogram, setHistogram]   = useState<any[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [searchInput, setSearchInput] = useState("");
  const [levels, setLevels]         = useState<string[]>(["INFO", "WARN", "ERROR"]);
  const [timeRange, setTimeRange]   = useState<"15m"|"30m"|"1h"|"6h"|"24h">("30m");
  const [copied, setCopied]         = useState(false);

  const runQuery = useCallback(() => {
    const tr  = LOG_TIME_RANGES.find((t) => t.value === timeRange);
    const to  = Date.now();
    const from = to - (tr?.ms ?? 30 * 60 * 1000);
    setLoading(true);
    axios.get("/api/log-explorer", {
      params: { levels: levels.join(","), search: searchInput, from, to, limit: 200 },
    }).then((r) => {
      setLogs(r.data.logs ?? []);
      setHistogram(r.data.histogram ?? []);
      setTotal(r.data.total ?? 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [levels, searchInput, timeRange]);

  useEffect(() => { runQuery(); }, []);

  const toggleLevel = (l: string) =>
    setLevels((prev) => prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]);

  const copyContent = (log: any) => {
    navigator.clipboard.writeText(JSON.stringify(log.content, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <ScrollText size={22} className="text-brand" /> Log Explorer
          </h2>
          <p className="text-xs text-text-dim mt-1">
            Search, filter and inspect real-time logs from all monitored services
          </p>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Level chips */}
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
          <Filter size={11} className="text-text-dim ml-1.5" />
          {(["INFO", "WARN", "ERROR", "DEBUG"] as const).map((l) => {
            const c      = LOG_LEVEL_STYLE[l];
            const active = levels.includes(l);
            return (
              <button key={l} onClick={() => toggleLevel(l)}
                className={cn("px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border",
                  active ? `${c.text} ${c.bg} ${c.border}` : "text-text-dim border-transparent hover:text-text-main"
                )}
              >{l}</button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="flex-1 min-w-52 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
            placeholder="Filter by service, message, status code…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/10 transition-shadow"
          />
        </div>

        {/* Time range */}
        <select value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
          className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none cursor-pointer font-medium"
        >
          {LOG_TIME_RANGES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Run query */}
        <button onClick={runQuery} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-xl text-xs font-black uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-60 shadow-sm"
        >
          <Play size={12} className={loading ? "animate-spin" : ""} />
          {loading ? "Running…" : "Run Query"}
        </button>
      </div>

      {/* ── Histogram ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-black uppercase text-text-dim tracking-widest">Log Volume</span>
          <div className="flex items-center gap-4">
            {(["INFO", "WARN", "ERROR"] as const).map((l) => (
              <div key={l} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: LOG_LEVEL_STYLE[l].bar }} />
                <span className="text-[9px] font-bold uppercase text-text-dim">{l}</span>
              </div>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={histogram} barSize={10} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="time"
              tickFormatter={(t) =>
                new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              }
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              labelFormatter={(t) => new Date(t as number).toLocaleString()}
              formatter={(v: any, n: string) => [v, n]}
            />
            <Bar dataKey="ERROR" stackId="a" fill={LOG_LEVEL_STYLE.ERROR.bar} />
            <Bar dataKey="WARN"  stackId="a" fill={LOG_LEVEL_STYLE.WARN.bar} />
            <Bar dataKey="INFO"  stackId="a" fill={LOG_LEVEL_STYLE.INFO.bar} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Table + detail panel ── */}
      <div className="flex gap-4 items-start">
        {/* Log table */}
        <div className={cn("bg-white border border-gray-200 rounded-xl overflow-hidden transition-all duration-200",
          selectedLog ? "flex-1 min-w-0" : "w-full"
        )}>
          {/* Table header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-text-dim tracking-widest">
                {loading ? "Loading…" : `${total.toLocaleString()} RECORDS`}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-text-dim font-bold uppercase tracking-wider">
              {["TIMESTAMP", "LEVEL", "SERVICE", "CONTENT"].map((h, i) => (
                <React.Fragment key={h}>
                  {i > 0 && <span className="mx-1.5 text-gray-200">|</span>}
                  <span>{h}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="max-h-[540px] overflow-y-auto divide-y divide-gray-50/80">
            {logs.length === 0 && !loading && (
              <div className="py-20 text-center">
                <ScrollText size={28} className="text-gray-200 mx-auto mb-3" />
                <p className="text-sm font-bold text-text-main mb-1">No logs found</p>
                <p className="text-xs text-text-dim">
                  Try expanding the time range or adjusting your filters
                </p>
              </div>
            )}
            {logs.map((log) => {
              const c          = LOG_LEVEL_STYLE[log.level as keyof typeof LOG_LEVEL_STYLE] ?? LOG_LEVEL_STYLE.DEBUG;
              const isSelected = selectedLog?.id === log.id;
              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedLog(isSelected ? null : log)}
                  className={cn(
                    "flex items-stretch cursor-pointer hover:bg-gray-50/80 transition-colors text-xs font-mono group",
                    isSelected ? "bg-brand/5 border-l-[3px] border-brand" : "border-l-[3px] border-transparent"
                  )}
                >
                  {/* Timestamp */}
                  <div className="px-3 py-2 shrink-0 text-[10px] text-text-dim w-[120px] border-r border-gray-50 flex items-center">
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour: "2-digit", minute: "2-digit", second: "2-digit"
                    })}
                  </div>
                  {/* Level badge */}
                  <div className="px-3 py-2 border-r border-gray-50 shrink-0 flex items-center w-16">
                    <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded border", c.text, c.bg, c.border)}>
                      {log.level}
                    </span>
                  </div>
                  {/* Service */}
                  <div className="px-3 py-2 text-[10px] text-blue-600 font-semibold shrink-0 w-32 border-r border-gray-50 flex items-center">
                    <span className="truncate">[{log.service}]</span>
                  </div>
                  {/* Message */}
                  <div className="px-3 py-2 text-[10px] text-text-main flex items-center flex-1 min-w-0">
                    <span className={selectedLog ? "truncate" : ""}>{log.message}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedLog && (() => {
          const c = LOG_LEVEL_STYLE[selectedLog.level as keyof typeof LOG_LEVEL_STYLE] ?? LOG_LEVEL_STYLE.DEBUG;
          return (
            <motion.div
              key="log-detail"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              className="w-[360px] shrink-0 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-lg"
            >
              {/* Panel header */}
              <div className="flex items-start justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80">
                <div>
                  <p className="text-[10px] text-text-dim leading-tight">
                    {new Date(selectedLog.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}
                    <span className="text-text-main font-black ml-1.5">
                      {new Date(selectedLog.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-[9px] text-text-dim">
                      .{String(selectedLog.timestamp).slice(-3)}
                    </span>
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={cn("text-[9px] font-black uppercase px-1.5 py-0.5 rounded border", c.text, c.bg, c.border)}>
                      {selectedLog.level}
                    </span>
                    <span className="text-[10px] text-blue-600 font-semibold">{selectedLog.service}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-text-dim hover:text-text-main transition-colors p-1 rounded hover:bg-gray-100"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 px-4 py-2.5 border-b border-gray-100">
                <button className="flex-1 text-[10px] font-black uppercase py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-text-dim">
                  Show surrounding logs
                </button>
                <button className="flex-1 text-[10px] font-black uppercase py-1.5 border border-brand/30 text-brand rounded-lg hover:bg-brand/5 transition-colors">
                  Open trace
                </button>
              </div>

              {/* Content JSON */}
              <div className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-black uppercase text-text-dim tracking-widest">Content</p>
                  <button
                    onClick={() => copyContent(selectedLog)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold text-text-dim hover:text-text-main hover:bg-gray-100 transition-colors"
                    title="Copy JSON"
                  >
                    {copied ? <><Check size={9} className="text-brand" /> Copied</> : <><Copy size={9} /> Copy</>}
                  </button>
                </div>
                <pre className="text-[10px] bg-gray-950 text-gray-100 rounded-xl p-3 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto scrollbar-thin">
                  {JSON.stringify(selectedLog.content, null, 2)}
                </pre>
              </div>

              {/* Topology */}
              <div className="px-4 py-2 border-t border-gray-50">
                <p className="text-[10px] font-black uppercase text-text-dim tracking-widest mb-2">Topology</p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg">
                    <Globe size={10} className="text-blue-500" />
                    <span className="text-[10px] font-semibold">{selectedLog.content?.type ?? "website"}</span>
                  </div>
                  <ChevronDown size={10} className="text-text-dim rotate-[-90deg]" />
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-brand/5 border border-brand/20 rounded-lg">
                    <Activity size={10} className="text-brand" />
                    <span className="text-[10px] font-semibold text-brand">{selectedLog.service}</span>
                  </div>
                </div>
              </div>

              {/* Fields */}
              <div className="px-4 pb-4 pt-2 border-t border-gray-50">
                <p className="text-[10px] font-black uppercase text-text-dim tracking-widest mb-2">Fields</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {Object.entries(selectedLog.content)
                    .filter(([, v]) => v !== null && v !== undefined && v !== "")
                    .map(([k, v]) => (
                      <div key={k} className="flex items-start gap-2 text-[10px] hover:bg-gray-50 px-1 py-0.5 rounded transition-colors">
                        <span className="text-text-dim font-mono shrink-0 w-28">{k}</span>
                        <span className={cn("font-mono font-bold truncate",
                          k === "statusCode"   ? (Number(v) >= 400 ? "text-rose-600" : "text-brand") :
                          k === "responseTime" ? (Number(v) > 2000 ? "text-rose-600" : Number(v) > 800 ? "text-amber-600" : "text-brand") :
                          k === "status"       ? (String(v) === "down" ? "text-rose-600" : String(v) === "degraded" ? "text-amber-600" : "text-brand") :
                          "text-text-main"
                        )}>{String(v)}</span>
                      </div>
                    ))}
                </div>
              </div>
            </motion.div>
          );
        })()}
      </div>
    </div>
  );
};

// ─── Synthetics View ──────────────────────────────────────────────────────────

interface SyntheticStepFE {
  id: string; name: string; method: string; url: string;
  headers?: Record<string, string>; body?: string;
  assertions: { type: string; target?: string; operator: string; value: string }[];
}

const SyntheticsView = () => {
  const [tests, setTests]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [running, setRunning]     = useState<string | null>(null);
  const [runResult, setRunResult] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [newName, setNewName]   = useState("");
  const [newDesc, setNewDesc]   = useState("");
  const [newSteps, setNewSteps] = useState<SyntheticStepFE[]>([
    { id: "s1", name: "Step 1", method: "GET", url: "", assertions: [{ type: "status", operator: "eq", value: "200" }] },
  ]);

  const fetchTests = () => {
    setLoading(true);
    axios.get("/api/synthetic-tests").then((r) => { setTests(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { fetchTests(); }, []);

  const runTest = async (testId: string) => {
    setRunning(testId); setRunResult(null);
    try {
      const r = await axios.post(`/api/synthetic-tests/${testId}/run`, {}, { timeout: 60000 });
      setRunResult(r.data); setSelectedId(testId);
      fetchTests();
    } catch (e: any) {
      alert("Run failed: " + (e.message || "Unknown error"));
    } finally {
      setRunning(null);
    }
  };

  const saveTest = async () => {
    if (!newName || newSteps.some((s) => !s.url)) return;
    await axios.post("/api/synthetic-tests", { name: newName, description: newDesc, steps: newSteps, enabled: true });
    setCreating(false); setNewName(""); setNewDesc("");
    setNewSteps([{ id: "s1", name: "Step 1", method: "GET", url: "", assertions: [{ type: "status", operator: "eq", value: "200" }] }]);
    fetchTests();
  };

  const deleteTest = async (id: string) => {
    if (!confirm("Delete this test?")) return;
    await axios.delete(`/api/synthetic-tests/${id}`);
    fetchTests();
  };

  const addStep = () => {
    const id = `s${Date.now()}`;
    setNewSteps((prev) => [...prev, { id, name: `Step ${prev.length + 1}`, method: "GET", url: "", assertions: [{ type: "status", operator: "eq", value: "200" }] }]);
  };

  const updateStep = (si: number, patch: Partial<SyntheticStepFE>) =>
    setNewSteps((prev) => prev.map((s, i) => i === si ? { ...s, ...patch } : s));

  const updateAssertion = (si: number, ai: number, patch: Partial<SyntheticStepFE["assertions"][0]>) =>
    setNewSteps((prev) => prev.map((s, i) => i === si ? { ...s, assertions: s.assertions.map((a, j) => j === ai ? { ...a, ...patch } : a) } : s));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <FlaskConical size={22} className="text-brand" /> Synthetics · Multi-Step Tests
          </h2>
          <p className="text-xs text-text-dim mt-1">Simulate real user journeys with sequential HTTP requests and assertions</p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all"
          >
            <Plus size={14} /> New Test
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-black text-sm uppercase tracking-tight">New Synthetic Test</h3>
            <button onClick={() => setCreating(false)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={14} /></button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">Test Name *</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Homepage availability" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-text-dim mb-1">Description</label>
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What this test checks…" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-brand" />
            </div>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-text-dim">Steps</span>
              <button onClick={addStep} className="flex items-center gap-1.5 text-[10px] font-black uppercase text-brand hover:underline"><Plus size={11} /> Add Step</button>
            </div>
            <div className="space-y-3">
              {newSteps.map((step, si) => (
                <div key={step.id} className="border border-gray-200 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-text-dim bg-gray-100 px-2 py-0.5 rounded">{si + 1}</span>
                    <input value={step.name} onChange={(e) => updateStep(si, { name: e.target.value })} className="flex-grow px-2 py-1.5 border border-gray-100 rounded-lg text-xs outline-none focus:border-brand" placeholder="Step name" />
                    {newSteps.length > 1 && (
                      <button onClick={() => setNewSteps((prev) => prev.filter((_, i) => i !== si))} className="p-1 hover:bg-rose-50 rounded"><Trash2 size={11} className="text-rose-400" /></button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select value={step.method} onChange={(e) => updateStep(si, { method: e.target.value })} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-purple-600 outline-none bg-white">
                      {["GET", "POST", "PUT", "DELETE", "HEAD", "PATCH"].map((m) => <option key={m}>{m}</option>)}
                    </select>
                    <input value={step.url} onChange={(e) => updateStep(si, { url: e.target.value })} className="flex-grow px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-mono outline-none focus:border-brand" placeholder="https://example.com/api/health" />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-text-dim">Assertions</span>
                    {step.assertions.map((a, ai) => (
                      <div key={ai} className="flex gap-2 items-center">
                        <select value={a.type} onChange={(e) => updateAssertion(si, ai, { type: e.target.value })} className="px-2 py-1 border border-gray-100 rounded text-[10px] outline-none bg-white">
                          <option value="status">Status Code</option>
                          <option value="body_contains">Body Contains</option>
                          <option value="response_time">Response Time (ms)</option>
                          <option value="header">Header</option>
                        </select>
                        {a.type === "header" && (
                          <input value={a.target || ""} onChange={(e) => updateAssertion(si, ai, { target: e.target.value })} className="w-24 px-2 py-1 border border-gray-100 rounded text-[10px] font-mono outline-none" placeholder="header-name" />
                        )}
                        <select value={a.operator} onChange={(e) => updateAssertion(si, ai, { operator: e.target.value })} className="px-2 py-1 border border-gray-100 rounded text-[10px] outline-none bg-white">
                          <option value="eq">= equals</option>
                          <option value="lt">&lt; less than</option>
                          <option value="gt">&gt; greater than</option>
                          <option value="contains">contains</option>
                          <option value="not_contains">not contains</option>
                        </select>
                        <input value={a.value} onChange={(e) => updateAssertion(si, ai, { value: e.target.value })} className="flex-grow px-2 py-1 border border-gray-100 rounded text-[10px] font-mono outline-none focus:border-brand" placeholder={a.type === "status" ? "200" : a.type === "response_time" ? "2000" : "expected value"} />
                        {step.assertions.length > 1 && (
                          <button onClick={() => updateStep(si, { assertions: step.assertions.filter((_, j) => j !== ai) })} className="shrink-0"><X size={10} className="text-gray-400 hover:text-rose-500" /></button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => updateStep(si, { assertions: [...step.assertions, { type: "status", operator: "eq", value: "200" }] })} className="text-[9px] font-black uppercase text-brand hover:underline flex items-center gap-1"><Plus size={9} /> Add Assertion</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setCreating(false)} className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-50">Cancel</button>
            <button onClick={saveTest} disabled={!newName || newSteps.some((s) => !s.url)} className="px-6 py-2 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all disabled:opacity-40">
              Create Test
            </button>
          </div>
        </div>
      )}

      {/* Test list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-text-dim">Loading tests…</div>
      ) : tests.length === 0 && !creating ? (
        <div className="py-20 text-center border border-dashed border-gray-200 rounded-2xl">
          <div className="text-5xl mb-4">🧪</div>
          <p className="font-bold text-text-main mb-2">No synthetic tests yet</p>
          <p className="text-sm text-text-dim mb-6">Create multi-step tests to simulate real user journeys end-to-end</p>
          <button onClick={() => setCreating(true)} className="px-6 py-3 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all">
            Create First Test
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => (
            <div key={test.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              {/* Test header */}
              <div className="flex items-center justify-between px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className={cn("w-2.5 h-2.5 rounded-full",
                    test.lastRunStatus === "pass"  ? "bg-brand" :
                    test.lastRunStatus === "fail"  ? "bg-rose-500" :
                    test.lastRunStatus === "error" ? "bg-orange-500" : "bg-gray-300"
                  )} />
                  <div>
                    <p className="font-bold text-sm">{test.name}</p>
                    {test.description && <p className="text-[10px] text-text-dim mt-0.5">{test.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-text-dim">{test.steps.length} step{test.steps.length !== 1 ? "s" : ""}</span>
                  {test.lastRunAt && <span className="text-[10px] text-text-dim">{timeAgo(test.lastRunAt)}</span>}
                  {test.lastRunStatus && (
                    <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full",
                      test.lastRunStatus === "pass"  ? "bg-brand/10 text-brand" :
                      test.lastRunStatus === "fail"  ? "bg-rose-50 text-rose-600" : "bg-orange-50 text-orange-600"
                    )}>{test.lastRunStatus}</span>
                  )}
                  <button
                    onClick={() => runTest(test.id)}
                    disabled={running === test.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-black text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-black hover:text-brand transition-all disabled:opacity-50"
                  >
                    {running === test.id ? <><RefreshCcw size={10} className="animate-spin" /> Running</> : "▶ Run"}
                  </button>
                  <button onClick={() => deleteTest(test.id)} className="p-1.5 hover:bg-rose-50 rounded-lg transition-colors">
                    <Trash2 size={13} className="text-rose-400" />
                  </button>
                </div>
              </div>

              {/* Step pills */}
              <div className="px-4 pb-3 flex gap-2 flex-wrap">
                {test.steps.map((step: any, i: number) => (
                  <span key={step.id} className="flex items-center gap-1.5 text-[10px] font-mono bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">
                    <span className="text-text-dim">{i + 1}.</span>
                    <span className="font-bold text-purple-600">{step.method}</span>
                    <span className="text-text-dim truncate max-w-[150px]">{step.url}</span>
                  </span>
                ))}
              </div>

              {/* Run result */}
              {selectedId === test.id && runResult && (
                <div className="border-t border-gray-100 p-4 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-text-dim">
                      Last Run · {runResult.duration}ms total
                    </span>
                    <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full",
                      runResult.status === "pass" ? "bg-brand/10 text-brand" : "bg-rose-50 text-rose-600"
                    )}>
                      {runResult.passedSteps}/{runResult.totalSteps} passed
                    </span>
                  </div>
                  <div className="space-y-2">
                    {runResult.steps.map((step: any, i: number) => (
                      <div key={i} className={cn("p-3 rounded-xl border text-xs", step.passed ? "bg-brand/5 border-brand/20" : "bg-rose-50 border-rose-200")}>
                        <div className="flex items-center gap-3">
                          <span className={cn("font-black text-base", step.passed ? "text-brand" : "text-rose-500")}>{step.passed ? "✓" : "✗"}</span>
                          <span className="font-bold text-purple-600">{step.method}</span>
                          <span className="text-text-dim truncate flex-grow">{step.url}</span>
                          {step.statusCode && <span className="font-mono font-bold shrink-0">HTTP {step.statusCode}</span>}
                          <span className="font-mono text-text-dim shrink-0">{step.responseTime}ms</span>
                        </div>
                        {step.error && <p className="mt-1.5 text-rose-600 text-[10px] pl-7">{step.error}</p>}
                        {step.assertions?.length > 0 && (
                          <div className="mt-2 pl-7 space-y-1">
                            {step.assertions.map((a: any, j: number) => (
                              <div key={j} className="flex items-center gap-2 text-[10px]">
                                <span className={a.passed ? "text-brand" : "text-rose-500"}>{a.passed ? "✓" : "✗"}</span>
                                <span className="text-text-dim">{a.type} {a.operator} "{a.value}"</span>
                                {!a.passed && <span className="text-rose-600">got: "{a.actual}"</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<ViewMode>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const lastNotifCountRef = useRef(0);

  const [geminiKeyConfigured, setGeminiKeyConfigured] = useState<boolean | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [newLogCount, setNewLogCount] = useState(0); // unread log badge

  // Analysis state (preserved from original)
  const [intakeType, setIntakeType] = useState<IntakeType>("link");
  const [projectLink, setProjectLink] = useState("");
  const [zipFiles, setZipFiles] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("Initializing analysis...");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loadingError, setLoadingError] = useState<{ step: number; message: string } | null>(null);
  const [components, setComponents] = useState<SystemComponent[]>([]);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [history, setHistory] = useState<AnalysisVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [analysisTab, setAnalysisTab] = useState<"status" | "code" | "incidents" | "alerts">("status");
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [explainingSnippet, setExplainingSnippet] = useState<CodeSnippet | null>(null);
  const [explanation, setExplanation] = useState<CodeExplanation | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isUrlDown, setIsUrlDown] = useState(false);
  const activeVersion = history.find((v) => v.id === activeVersionId);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;

  const fetchProjects = useCallback(async () => {
    const res = await axios.get<Project[]>("/api/projects");
    setProjects(res.data);
    if (selectedProjectRef.current) {
      const updated = res.data.find((p) => p.id === selectedProjectRef.current!.id);
      if (updated) setSelectedProject(updated);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    const res = await axios.get<AppNotification[]>("/api/notifications");
    // Only sync the list — never toast from polling.
    // Toasts are shown exclusively via WebSocket (truly new events).
    // This prevents existing unread notifications from re-toasting on
    // page load, refresh, or each poll cycle.
    setNotifications(res.data);
    lastNotifCountRef.current = res.data.filter((n) => !n.read).length;
  }, []);

  // WebSocket — real-time project + notification updates
  useEffect(() => {
    // Check if Gemini API key is configured (for the AI Analysis banner)
    axios.get<{ key: string }>("/api/settings/gemini-key")
      .then((r) => setGeminiKeyConfigured(!!r.data.key))
      .catch(() => setGeminiKeyConfigured(false));

    // Load recent logs for the console
    axios.get<ConsoleLog[]>("/api/logs?limit=300")
      .then((r) => setConsoleLogs(r.data.reverse())) // oldest first
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchNotifications();

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (e) => {
        try {
          const { event, data } = JSON.parse(e.data as string);
          if (event === "projects_update") {
            setProjects(data as Project[]);
            if (selectedProjectRef.current) {
              const up = (data as Project[]).find((p) => p.id === selectedProjectRef.current!.id);
              if (up) setSelectedProject(up);
            }
          } else if (event === "notification") {
            const notif = data as AppNotification;
            setNotifications((prev) => [notif, ...prev.filter((n) => n.id !== notif.id)]);
            setToasts((prev) => [...prev, notif]);
            lastNotifCountRef.current += 1;
          } else if (event === "log") {
            const log = data as ConsoleLog;
            setConsoleLogs((prev) => {
              const updated = [...prev, log];
              return updated.slice(-1000); // keep last 1000 entries
            });
            setNewLogCount((c) => c + 1);
          }
        } catch {}
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    // Fallback poll for notifications in case WS misses something
    const t = setInterval(fetchNotifications, 60000);
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
      clearInterval(t);
    };
  }, [fetchProjects, fetchNotifications]);

  // ── Project actions ──────────────────────────────────────────────────────────

  const handleAddProject = async (data: Partial<Project>) => {
    await axios.post("/api/projects", data);
    await fetchProjects();
  };

  const handleEditProject = async (data: Partial<Project>) => {
    if (!editingProject) return;
    await axios.put(`/api/projects/${editingProject.id}`, data);
    await fetchProjects();
    setEditingProject(null);
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Delete this project? All its logs and issues will also be removed.")) return;
    await axios.delete(`/api/projects/${id}`);
    await fetchProjects();
    if (selectedProject?.id === id) { setSelectedProject(null); setView("projects"); }
  };

  const handleToggleProject = async (project: Project) => {
    await axios.put(`/api/projects/${project.id}`, { enabled: !project.enabled });
    await fetchProjects();
  };

  const handleCheckProject = async (project: Project) => {
    await axios.post(`/api/projects/${project.id}/check`);
    await fetchProjects();
  };

  const handleMarkAllRead = async () => {
    await axios.post("/api/notifications/read-all");
    await fetchNotifications();
  };

  // ── Analysis helpers (preserved from original) ─────────────────────────────

  const handleLinkChange = (value: string) => {
    setProjectLink(value);
    if (!value) { setUrlError(null); return; }
    if (!/^https?:\/\//i.test(value)) { setUrlError("URL must start with http:// or https://"); return; }
    try {
      const url = new URL(value);
      const hostname = url.hostname;
      if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname)) { setUrlError("IP addresses are not permitted."); return; }
      const domainParts = hostname.split(".");
      if (domainParts.length < 2) { setUrlError("Invalid domain structure."); return; }
      const tld = domainParts[domainParts.length - 1];
      if (!/^[a-zA-Z]{2,18}$/.test(tld)) { setUrlError(`Invalid extension ".${tld}"`); return; }
      if (!/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,18}$/.test(hostname)) { setUrlError("Invalid hostname."); return; }
      setUrlError(null);
    } catch { setUrlError("Malformed URL."); }
  };

  // ── Step 3: Groq analysis (proxied through server so key stays server-side) ─
  const analyzeWithGroq = async (opts: {
    context: string; url: string;
    headers?: Record<string, string>;
    statusCode?: number; responseTime?: number; sslDays?: number | null;
  }) => {
    const res = await axios.post<{ components: SystemComponent[]; error?: string }>("/api/analyze-groq", opts);
    if (res.data.error) throw new Error(res.data.error);
    const data = res.data.components || [];
    setComponents(data);
    return data;
  };

  const handleStartAnalysis = async () => {
    setView("analyze-loading");
    setLoadingProgress(0);
    setLoadingText("Initializing analysis engine...");
    setCurrentStepIndex(0);
    setLoadingError(null);
    setUrlError(null);
    setActiveVersionId(null);
    setComponents([]);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    try {
      // ── STEP 1: CONNECTING TO SOURCE ──────────────────────────────────────
      setCurrentStepIndex(0);
      setLoadingText("Connecting to source & verifying reachability…");
      setLoadingProgress(10);

      if (intakeType === "link") {
        // Real HTTP check — get status, headers, response time
        const connRes = await axios.post<{
          status: string; statusCode?: number; headers?: Record<string, string>;
          error?: string; htmlSnippet?: string;
        }>("/api/analyze-link", { url: projectLink });

        if (connRes.data.status === "down")
          throw new Error(`Connection failed: ${connRes.data.error || "Server unreachable"}`);

        const httpStatus  = connRes.data.statusCode ?? 200;
        const siteHeaders = connRes.data.headers ?? {};
        setLoadingProgress(22);
        setIsUrlDown(false);

        // Detect server tech from headers
        const poweredBy  = siteHeaders["x-powered-by"] || siteHeaders["server"] || "";
        const isVercel   = !!siteHeaders["x-vercel-id"];
        const isCF       = !!siteHeaders["cf-ray"];
        const hostingHint = isVercel ? "Vercel" : isCF ? "Cloudflare" : poweredBy || "Unknown";
        setLoadingText(`Connected · ${httpStatus} · Host: ${hostingHint}`);
        await sleep(600);

        // ── STEP 2: FETCHING ARTIFACTS ────────────────────────────────────
        setCurrentStepIndex(1);
        setLoadingProgress(35);
        setLoadingText("Fetching page artifacts & detecting stack…");

        const previewRes = await axios.post<{
          statusCode?: number; contentType?: string; rawBody?: string;
          textBody?: string; bodyLength?: number; error?: string;
        }>("/api/preview", { url: projectLink });

        const body       = previewRes.data.rawBody || connRes.data.htmlSnippet || projectLink;
        const textBody   = previewRes.data.textBody || body;
        const bodyLen    = previewRes.data.bodyLength ?? body.length;
        const ct         = previewRes.data.contentType || "";
        const rt         = connRes.data.statusCode ? undefined : undefined; // response time not returned yet

        // Framework detection from body content
        const isReact    = body.includes("__react") || body.includes('id="root"') || body.includes("reactroot");
        const isNext     = body.includes("__NEXT_DATA__") || body.includes("/_next/");
        const isVue      = body.includes("vue.runtime") || body.includes('id="app"');
        const isAngular  = body.includes("ng-version") || body.includes("angular");
        const isJson     = ct.includes("application/json");
        const stackHint  = isNext ? "Next.js" : isReact ? "React" : isVue ? "Vue" : isAngular ? "Angular" : isJson ? "JSON API" : "HTML/Unknown";

        setLoadingText(`Artifacts fetched · ${(bodyLen / 1024).toFixed(1)} KB · Stack: ${stackHint}`);
        setLoadingProgress(50);
        await sleep(600);

        // ── STEP 3: ANALYZING ARCHITECTURE (Groq) ────────────────────────
        setCurrentStepIndex(2);
        setLoadingProgress(58);
        setLoadingText("Sending to Groq AI · Analyzing architecture…");

        let analyzed: SystemComponent[] = [];
        try {
          analyzed = await analyzeWithGroq({
            context:      body.slice(0, 4000),
            url:          projectLink,
            headers:      siteHeaders,
            statusCode:   httpStatus,
            responseTime: undefined,
            sslDays:      null,
          });
        } catch (e: any) {
          throw new Error(`Groq analysis failed: ${e.message}`);
        }

        setLoadingProgress(78);
        setLoadingText(`Groq identified ${analyzed.length} component${analyzed.length !== 1 ? "s" : ""}…`);
        await sleep(600);

        // ── STEP 4: HEALTH CHECK ──────────────────────────────────────────
        setCurrentStepIndex(3);
        setLoadingProgress(82);
        setLoadingText("Running real health checks on discovered endpoints…");

        try {
          const hcRes = await axios.post<{
            healthEndpoints: { path: string; status: number; responseTime: number; ok: boolean; body?: string }[];
            matchingProjects: { id: string; name: string; status: string; uptimePct: number; lastResponseTime?: number; sslDaysLeft?: number | null }[];
            sslDaysLeft: number | null;
            overallHealthy: boolean;
          }>("/api/analyze-health-check", { url: projectLink });

          const { healthEndpoints, matchingProjects, sslDaysLeft } = hcRes.data;
          const liveEndpoints = healthEndpoints.filter((e) => e.ok);

          // Enrich component health details with live findings
          analyzed = analyzed.map((comp) => {
            const extra: string[] = [];
            if (liveEndpoints.length > 0)
              extra.push(`✓ Health endpoint found: ${liveEndpoints[0].path} → ${liveEndpoints[0].status} (${liveEndpoints[0].responseTime}ms)`);
            if (sslDaysLeft != null)
              extra.push(`SSL certificate: ${sslDaysLeft} days remaining`);
            if (matchingProjects.length > 0)
              extra.push(`Lumina is monitoring this host · ${matchingProjects[0].uptimePct.toFixed(1)}% uptime`);
            return extra.length > 0
              ? { ...comp, healthDetails: [...(comp.healthDetails || []), ...extra] }
              : comp;
          });

          setComponents(analyzed);
          const summary = liveEndpoints.length > 0
            ? `${liveEndpoints.length} live health endpoint${liveEndpoints.length > 1 ? "s" : ""} found`
            : "No /health endpoint detected";
          setLoadingText(`Health check complete · ${summary}`);
        } catch {
          setLoadingText("Health check completed (limited access)");
        }

        setLoadingProgress(100);
        await sleep(700);

        const newVer: AnalysisVersion = {
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          components: analyzed,
          source: projectLink,
          sourceType: "link",
        };
        setHistory((prev) => [newVer, ...prev]);
        setActiveVersionId(newVer.id);
        await sleep(400);
        setView("analyze-dashboard");

      } else {
        // ── ZIP flow ──────────────────────────────────────────────────────
        setLoadingProgress(15);
        setLoadingText("Verifying ZIP archive structure…");
        await sleep(400);

        setCurrentStepIndex(1);
        setLoadingProgress(30);
        setLoadingText("Indexing files & detecting project type…");
        if (!zipFiles || zipFiles.length === 0) throw new Error("No files found in ZIP archive.");

        const hasPackageJson = zipFiles.some((f) => f.endsWith("package.json"));
        const hasPyReqs      = zipFiles.some((f) => f.includes("requirements"));
        const stackGuess     = hasPackageJson ? "Node.js/JS" : hasPyReqs ? "Python" : "Unknown stack";
        setLoadingText(`${zipFiles.length} files indexed · ${stackGuess} detected`);
        setLoadingProgress(45);
        await sleep(500);

        setCurrentStepIndex(2);
        setLoadingProgress(55);
        setLoadingText("Sending file map to Groq AI…");

        let analyzed: SystemComponent[] = [];
        try {
          analyzed = await analyzeWithGroq({
            context: zipFiles.join("\n").slice(0, 4000),
            url:     fileName || "Local ZIP Archive",
          });
        } catch (e: any) {
          throw new Error(`Groq analysis failed: ${e.message}`);
        }

        setLoadingProgress(80);
        setLoadingText(`Groq identified ${analyzed.length} component${analyzed.length !== 1 ? "s" : ""}…`);
        await sleep(500);

        setCurrentStepIndex(3);
        setLoadingProgress(90);
        setLoadingText("Validating component health signals…");
        await sleep(700);

        setLoadingProgress(100);
        await sleep(400);

        const newVer: AnalysisVersion = {
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          components: analyzed,
          source: fileName || "Local Backup",
          sourceType: "zip",
        };
        setHistory((prev) => [newVer, ...prev]);
        setActiveVersionId(newVer.id);
        await sleep(400);
        setView("analyze-dashboard");
      }
    } catch (err: any) {
      const raw = err.message || "";
      let msg = "The analysis engine encountered an unexpected error.";

      if (raw.includes("not configured") || raw.includes("GROQ_API_KEY")) {
        msg = "Groq API key not configured. Go to Settings → AI Analysis and paste your gsk_ key from console.groq.com.";
      } else if (raw.includes("Invalid API Key") || raw.includes("invalid_api_key") || (raw.includes("401"))) {
        msg = "Invalid Groq API key. Please check your key in Settings → AI Analysis. Keys start with gsk_.";
      } else if (raw.includes("rate_limit") || raw.includes("429")) {
        msg = "Groq rate limit hit. Wait a moment and try again.";
      } else if (raw.includes("Connection failed")) {
        msg = "Could not reach the target URL. Make sure it's publicly accessible.";
      } else if (raw.includes("No files found")) {
        msg = "The uploaded archive appears empty or corrupted.";
      } else if (raw.length > 0) {
        msg = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
      }

      setLoadingError({ step: currentStepIndex, message: msg });
      setLoadingText("Analysis halted due to error.");
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const zip = await JSZip.loadAsync(file);
      const files: string[] = [];
      zip.forEach((p) => files.push(p));
      setZipFiles(files);
    } catch { alert("Failed to read zip file."); }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg-base text-text-main flex flex-col font-sans">

      {/* ── Toast notifications ────────────────────────────────────────────── */}
      <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.slice(0, 3).map((t) => (
            <NotificationToast
              key={t.id}
              notif={t}
              onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Notification panel ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showNotifPanel && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[150] flex justify-end" onClick={() => setShowNotifPanel(false)}>
            <motion.div
              initial={{ x: 400 }}
              animate={{ x: 0 }}
              exit={{ x: 400 }}
              className="w-full max-w-sm bg-white border-l border-gray-100 shadow-2xl flex flex-col h-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <h3 className="font-black text-sm uppercase tracking-tight">Notifications</h3>
                <div className="flex items-center gap-3">
                  {unreadCount > 0 && (
                    <button onClick={handleMarkAllRead} className="text-[10px] font-black uppercase tracking-widest text-brand hover:underline">
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setShowNotifPanel(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div className="flex-grow overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-16 text-center text-sm text-text-dim">No notifications yet.</div>
                ) : (
                  notifications.map((n) => {
                    const m = SEVERITY_META[n.severity];
                    return (
                      <div key={n.id} className={cn("flex items-start gap-3 p-4 border-b border-gray-50 hover:bg-gray-50/50 transition-colors", !n.read && "bg-brand/5")}>
                        <div className={cn("mt-0.5 p-1.5 rounded-lg shrink-0", m.bg)}>
                          <AlertCircle size={12} className={m.color} />
                        </div>
                        <div className="flex-grow min-w-0">
                          <p className="text-xs font-semibold text-text-main leading-snug">{n.message}</p>
                          <p className="text-[10px] text-text-dim mt-0.5">{timeAgo(n.timestamp)}</p>
                        </div>
                        {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />}
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add/Edit project modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {(showAddModal || editingProject) && (
          <AddProjectModal
            onClose={() => { setShowAddModal(false); setEditingProject(null); }}
            onSave={editingProject ? handleEditProject : handleAddProject}
            onAddCompanion={handleAddProject}
            initial={editingProject || undefined}
          />
        )}
      </AnimatePresence>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex justify-between items-center h-16 px-8 bg-white border-b border-border-theme sticky top-0 z-50">
        <button
          onClick={() => setView("projects")}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 bg-brand flex items-center justify-center rounded-md shadow-sm">
            <Activity className="w-5 h-5 text-black" />
          </div>
          <span className="font-bold text-xl tracking-tight uppercase">Lumina Monitor</span>
        </button>

        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          {[
            { id: "projects" as ViewMode, label: "Projects", icon: LayoutDashboard },
            { id: "console" as ViewMode, label: "Console", icon: Terminal },
            { id: "settings" as ViewMode, label: "Settings", icon: Settings },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setView(id); if (id === "console") setNewLogCount(0); }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all relative",
                view === id
                  ? "bg-white text-text-main shadow-sm"
                  : "text-text-dim hover:text-text-main"
              )}
            >
              <Icon size={14} />
              {label}
              {id === "console" && newLogCount > 0 && view !== "console" && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-brand text-black text-[8px] font-black rounded-full flex items-center justify-center px-1">
                  {newLogCount > 99 ? "99+" : newLogCount}
                </span>
              )}
            </button>
          ))}
          {/* Supabase tab */}
          <button
            onClick={() => setView("supabase")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "supabase" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <svg width="12" height="12" viewBox="0 0 109 113" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874L63.708 110.284z" fill={view === "supabase" ? "#3ECF8E" : "#6b7280"}/>
              <path d="M63.708 110.284c-2.86 3.601-8.658 1.628-8.727-2.97l-1.007-67.251h45.22c8.19 0 12.758 9.46 7.665 15.874L63.708 110.284z" fill="url(#paint0_linear)" fillOpacity="0.2"/>
              <path d="M45.317 2.07c2.86-3.601 8.657-1.628 8.726 2.97l.442 67.251H9.283c-8.19 0-12.759-9.46-7.665-15.875L45.317 2.07z" fill={view === "supabase" ? "#3ECF8E" : "#9ca3af"}/>
              <defs><linearGradient id="paint0_linear" x1="53.974" y1="40.063" x2="94.163" y2="68.516" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient></defs>
            </svg>
            Supabase
          </button>
          {/* Health Dashboard tab */}
          <button
            onClick={() => setView("health")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "health" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <Activity size={12} />
            Health
          </button>
          {/* Analytics tab */}
          <button
            onClick={() => setView("analytics")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "analytics" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <Activity size={13} />
            Analytics
          </button>
          {/* APM tab */}
          <button
            onClick={() => setView("apm")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "apm" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <TrendingUp size={12} />
            APM
          </button>
          {/* Traces tab */}
          <button
            onClick={() => setView("traces")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "traces" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <Timer size={12} />
            Traces
          </button>
          {/* Service Map tab */}
          <button
            onClick={() => setView("service-map")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "service-map" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <Network size={12} />
            Map
          </button>
          {/* Synthetics tab */}
          <button
            onClick={() => setView("synthetics")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "synthetics" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <FlaskConical size={12} />
            Synthetics
          </button>
          {/* Logs tab */}
          <button
            onClick={() => setView("logs")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
              view === "logs" ? "bg-white text-text-main shadow-sm" : "text-text-dim hover:text-text-main"
            )}
          >
            <ScrollText size={12} />
            Logs
          </button>
        </div>

        <div className="flex items-center gap-3">
          {view === "projects" && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all"
            >
              <Plus size={14} /> Add Project
            </button>
          )}
          <button
            onClick={() => setShowNotifPanel(true)}
            className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="flex-grow max-w-6xl w-full mx-auto p-8">
        <AnimatePresence mode="wait">

          {/* Projects list */}
          {view === "projects" && (
            <motion.div key="projects" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ProjectsView
                projects={projects}
                onSelectProject={(p) => { setSelectedProject(p); setView("project-detail"); }}
                onAddProject={() => setShowAddModal(true)}
                onEditProject={(p) => setEditingProject(p)}
                onDeleteProject={handleDeleteProject}
                onToggleProject={handleToggleProject}
                onCheckProject={handleCheckProject}
                onRefresh={fetchProjects}
              />
            </motion.div>
          )}

          {/* Project detail */}
          {view === "project-detail" && selectedProject && (
            <motion.div key="project-detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ProjectDetailView
                project={selectedProject}
                onBack={() => setView("projects")}
                onEdit={() => setEditingProject(selectedProject)}
                onRefresh={fetchProjects}
              />
            </motion.div>
          )}

          {/* Settings */}
          {view === "settings" && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SettingsView />
            </motion.div>
          )}

          {/* Console */}
          {view === "console" && (
            <motion.div key="console" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative">
              <ConsoleView
                logs={consoleLogs}
                projects={projects}
                connected={wsConnected}
                onClear={() => setConsoleLogs([])}
              />
            </motion.div>
          )}


          {/* Supabase Edge Functions */}
          {view === "supabase" && (
            <motion.div key="supabase" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SupabaseView />
            </motion.div>
          )}

          {/* Health Dashboard */}
          {view === "health" && (
            <motion.div key="health" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <HealthDashboard />
            </motion.div>
          )}

          {/* Login Analytics */}
          {view === "analytics" && (
            <motion.div key="analytics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AnalyticsView />
            </motion.div>
          )}

          {/* APM */}
          {view === "apm" && (
            <motion.div key="apm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <APMView />
            </motion.div>
          )}

          {/* Traces */}
          {view === "traces" && (
            <motion.div key="traces" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TracesView />
            </motion.div>
          )}

          {/* Service Map */}
          {view === "service-map" && (
            <motion.div key="service-map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ServiceMapView
                onSelectProject={(id) => {
                  const p = projects.find((x) => x.id === id);
                  if (p) { setSelectedProject(p); setView("project-detail"); }
                }}
              />
            </motion.div>
          )}

          {/* Synthetics */}
          {view === "synthetics" && (
            <motion.div key="synthetics" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SyntheticsView />
            </motion.div>
          )}

          {/* Logs */}
          {view === "logs" && (
            <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LogsView />
            </motion.div>
          )}

          {/* AI Analyze setup */}
          {view === "analyze" && (
            <motion.div key="analyze" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-center min-h-[60vh]">
              <div className="w-full max-w-xl bg-white border border-border-theme rounded-2xl shadow-2xl overflow-hidden p-8">
                {/* API key not configured warning */}
                {geminiKeyConfigured === false && (
                  <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800 space-y-1">
                      <p className="font-bold">Gemini API key not configured</p>
                      <p>Go to <strong>Settings → AI Analysis</strong> and enter your free API key from <strong>aistudio.google.com</strong> to use this feature.</p>
                      <button
                        onClick={() => setView("settings")}
                        className="mt-2 px-3 py-1.5 bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-amber-600 transition-colors"
                      >
                        Open Settings →
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 mb-8 justify-center relative">
                  <div className="w-10 h-10 bg-brand flex items-center justify-center rounded-lg shadow-sm">
                    <Sparkles className="w-6 h-6 text-black" />
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight uppercase">AI System Analyzer</h1>
                  {history.length > 0 && (
                    <button
                      onClick={() => setView("analyze-history")}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-text-dim hover:text-brand transition-colors flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100"
                    >
                      <Clock size={12} /> History
                    </button>
                  )}
                </div>

                <div className="min-h-[200px] flex flex-col justify-center bg-gray-50/50 rounded-2xl p-6 border border-gray-100">
                  {intakeType === "link" ? (
                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-text-dim uppercase tracking-widest">Project URL</label>
                      <div className="relative">
                        <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                          type="url"
                          placeholder="https://example.com"
                          className={cn("w-full pl-12 pr-4 py-4 bg-gray-50 border rounded-xl focus:ring-2 transition-all outline-none text-sm", urlError ? "border-rose-500 focus:ring-rose-200" : "border-gray-200 focus:ring-brand focus:border-brand")}
                          value={projectLink}
                          onChange={(e) => handleLinkChange(e.target.value)}
                        />
                      </div>
                      {urlError && <p className="text-[10px] text-rose-500 font-bold uppercase tracking-wider">{urlError}</p>}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-text-dim uppercase tracking-widest">Project Backup (.zip)</label>
                      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                        <Upload className="w-8 h-8 text-gray-400 mb-2" />
                        <p className="text-xs font-medium text-text-muted">{fileName || "Drag and drop or click to upload"}</p>
                        <input type="file" className="hidden" accept=".zip" onChange={handleZipUpload} />
                      </label>
                    </div>
                  )}
                </div>

                <div className="mt-8 space-y-6">
                  <div className="bg-gray-100/80 p-1.5 rounded-2xl flex gap-1.5 border border-gray-200/50">
                    {(["link", "zip"] as IntakeType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setIntakeType(t)}
                        className={cn("flex-1 py-3.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] transition-all flex items-center justify-center gap-3", intakeType === t ? "bg-white text-text-main shadow-xl shadow-gray-200/40 border border-white" : "text-text-dim hover:text-text-main hover:bg-gray-50/50")}
                      >
                        {t === "link" ? <LinkIcon size={16} className={intakeType === t ? "text-brand" : ""} /> : <FileArchive size={16} className={intakeType === t ? "text-brand" : ""} />}
                        {t === "link" ? "External Link" : "Local Backup"}
                      </button>
                    ))}
                  </div>

                  <button
                    disabled={(intakeType === "link" && (!projectLink || !!urlError)) || (intakeType === "zip" && !fileName)}
                    onClick={handleStartAnalysis}
                    className="w-full py-5 bg-brand text-black font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-black hover:text-brand transition-all shadow-xl shadow-brand/10 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed flex items-center justify-center gap-3 group"
                  >
                    <Sparkles size={20} className="animate-pulse" />
                    Proceed with AI Analysis
                    <ArrowRight size={20} className="group-hover:translate-x-2 transition-transform" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Analyze loading */}
          {view === "analyze-loading" && (
            <motion.div key="analyze-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-center min-h-[60vh]">
              <div className="w-full max-w-md">
                <div className="text-center mb-12">
                  <motion.div
                    animate={{ rotate: 360, scale: [1, 1.1, 1] }}
                    transition={{ rotate: { duration: 2, repeat: Infinity, ease: "linear" }, scale: { duration: 2, repeat: Infinity } }}
                    className="w-20 h-20 border-4 border-brand/20 border-t-brand rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg shadow-brand/10"
                  >
                    <Activity className="w-8 h-8 text-brand animate-pulse" />
                  </motion.div>
                  <h2 className="text-2xl font-black italic uppercase tracking-tighter mb-2">AI Analysis In Progress</h2>
                  <p className="text-text-muted text-sm font-medium h-5">{loadingText}</p>
                </div>
                {["Connecting to source", "Fetching artifacts", "Analyzing architecture", "Health check"].map((step, idx) => {
                  const isCompleted = currentStepIndex > idx && !loadingError;
                  const isActive = currentStepIndex === idx && !loadingError;
                  const isFailed = loadingError && loadingError.step === idx;
                  const StepIcons = [Globe, Search, Activity, Settings];
                  const StepIcon = StepIcons[idx];
                  return (
                    <motion.div key={idx} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.1 }} className={cn("flex items-center gap-4 p-4 rounded-xl border transition-all duration-500 mb-3", isCompleted ? "bg-brand/10 border-brand/20 text-brand" : isActive ? "bg-white border-brand shadow-xl scale-[1.02] z-10" : isFailed ? "bg-rose-50 border-rose-200 text-rose-600 scale-[1.02]" : "bg-gray-50 border-gray-100 text-text-dim opacity-50")}>
                      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", isCompleted ? "bg-brand text-black" : isActive ? "bg-brand text-black" : isFailed ? "bg-rose-600 text-white" : "bg-gray-200 text-gray-400")}>
                        {isCompleted ? <CheckCircle2 size={20} /> : isFailed ? <AlertCircle size={20} /> : <StepIcon size={20} className={isActive ? "animate-pulse" : ""} />}
                      </div>
                      <div className="flex-grow">
                        <div className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1">Step {idx + 1}</div>
                        <div className="text-sm font-bold uppercase tracking-tight">{step}</div>
                      </div>
                    </motion.div>
                  );
                })}
                {loadingError ? (
                  <div className="bg-white border-2 border-rose-500 p-6 rounded-2xl mt-4">
                    <p className="text-sm font-bold text-rose-600 mb-4">{loadingError.message}</p>
                    <button onClick={() => setView("analyze")} className="w-full py-3 bg-rose-600 text-white font-black uppercase rounded-xl text-xs flex items-center justify-center gap-2">
                      <RefreshCcw size={14} /> Try Again
                    </button>
                  </div>
                ) : (
                  <div className="bg-white border border-border-theme p-6 rounded-2xl shadow-sm mt-4">
                    <div className="flex justify-between text-[10px] font-black italic uppercase tracking-widest mb-3 text-text-dim">
                      <span>Deep Scan</span>
                      <span>{Math.round(loadingProgress)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden p-0.5 border border-gray-200">
                      <motion.div className="bg-brand h-full rounded-full shadow-[0_0_12px_rgba(62,207,142,0.5)]" initial={{ width: 0 }} animate={{ width: `${loadingProgress}%` }} transition={{ type: "spring", damping: 20, stiffness: 60 }} />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Analyze dashboard (preserved) */}
          {view === "analyze-dashboard" && (
            <motion.div key="analyze-dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Minimal analysis dashboard — go to projects for the full monitoring experience */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight">AI Analysis Result</h2>
                  {activeVersion && <p className="text-xs text-text-dim mt-0.5">{activeVersion.source} · {new Date(activeVersion.timestamp).toLocaleTimeString()}</p>}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setView("analyze-history")} className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors">
                    <Clock size={14} /> History
                  </button>
                  <button onClick={() => setView("analyze")} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors">
                    <RefreshCcw size={14} /> New Scan
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {components.map((comp, i) => (
                  <motion.div key={comp.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="bg-white border border-border-theme p-4 rounded-lg flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                      <StatusIcon status={comp.status} size={20} />
                      <div>
                        <p className="font-bold text-sm">{comp.name}</p>
                        <p className="text-xs text-text-dim">{comp.details}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex gap-[1px] h-5 items-end w-24">
                        {(comp.history || []).slice(-24).map((val, idx) => (
                          <div key={idx} className={cn("flex-1 rounded-[1px]", val === 1 ? "h-full bg-brand/70" : "h-3/4 bg-rose-400")} />
                        ))}
                      </div>
                      <span className="text-sm font-bold font-mono text-text-main">{comp.uptimePct}%</span>
                    </div>
                  </motion.div>
                ))}
                {components.length === 0 && (
                  <div className="py-16 text-center bg-white border border-dashed border-gray-200 rounded-xl text-text-dim">
                    No components identified. Try scanning another source.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Analyze history */}
          {view === "analyze-history" && (
            <motion.div key="analyze-history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black uppercase tracking-tight">Analysis Archive</h2>
                <button onClick={() => setView("analyze")} className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-xl text-xs font-bold hover:bg-gray-200 transition-colors">
                  <ArrowLeft size={14} /> Back to Analyze
                </button>
              </div>
              <div className="space-y-4">
                {history.length === 0 ? (
                  <div className="py-20 text-center bg-white border border-dashed border-gray-200 rounded-2xl text-text-dim">No analysis history yet.</div>
                ) : (
                  history.map((ver) => (
                    <div key={ver.id} className="bg-white border border-gray-100 rounded-2xl p-5 flex items-center justify-between hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-4">
                        {ver.sourceType === "link" ? <LinkIcon size={18} className="text-text-dim" /> : <FileArchive size={18} className="text-text-dim" />}
                        <div>
                          <p className="font-bold text-sm">{ver.source}</p>
                          <p className="text-xs text-text-dim">{new Date(ver.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setComponents(ver.components); setActiveVersionId(ver.id); setView("analyze-dashboard"); }}
                        className="px-5 py-2 bg-text-main text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-brand hover:text-black transition-all"
                      >
                        Restore
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="px-8 py-4 border-t border-border-theme flex justify-between items-center text-text-dim text-[10px] gap-4 bg-white/50 backdrop-blur-sm">
        <div className="font-medium tracking-tight uppercase">Lumina Monitor · {projects.length} project{projects.length !== 1 ? "s" : ""} tracked</div>
        <div className="flex items-center gap-1.5 font-bold text-text-muted">
          {projects.some((p) => p.status === "down") ? (
            <><WifiOff size={10} className="text-rose-400" /> Issues detected</>
          ) : (
            <><Wifi size={10} className="text-brand" /> All systems monitored</>
          )}
        </div>
      </footer>
    </div>
  );
}
