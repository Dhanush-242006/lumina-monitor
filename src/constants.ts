import { SystemComponent, Incident, Metric } from './types';

export const COMPONENTS: SystemComponent[] = [
  {
    id: 'api-gateway',
    name: 'API Gateway',
    description: 'Entry point for all traffic',
    details: '99.9% success rate on edge nodes',
    healthDetails: ['Global load balancing active', 'TLS 1.3 handshake optimization enabled'],
    status: 'operational',
    uptimePct: 99.98,
    history: Array.from({ length: 45 }, () => (Math.random() > 0.05 ? 1 : 0)),
  },
  {
    id: 'auth',
    name: 'Authentication',
    description: 'User login and management',
    details: 'JWT validation latency < 15ms',
    healthDetails: ['Token revocation check operational', 'Session replication synced across 3 nodes'],
    status: 'operational',
    uptimePct: 99.84,
    history: Array.from({ length: 45 }, () => (Math.random() > 0.02 ? 1 : 0)),
  },
  {
    id: 'database',
    name: 'Database Cluster',
    description: 'Primary data storage',
    details: 'Primary replica experiencing high CPU load',
    healthDetails: ['CPU utilization at 85%', 'Parallel query optimization recommended'],
    status: 'degraded',
    uptimePct: 99.8,
    history: Array.from({ length: 45 }, () => (Math.random() > 0.08 ? 1 : 0)),
  },
  {
    id: 'edge-functions',
    name: 'Edge Functions',
    description: 'Serverless compute at edge',
    details: 'All regions active with 0% error rate',
    healthDetails: ['Cold start latency under 100ms', 'Memory usage per invocation within limits'],
    status: 'operational',
    uptimePct: 99.92,
    history: Array.from({ length: 45 }, () => (Math.random() > 0.01 ? 1 : 0)),
  },
  {
    id: 'realtime',
    name: 'Realtime Engine',
    description: 'Websocket and pub/sub',
    details: 'Active connections steady at 12k/sec',
    healthDetails: ['Socket heartbeats verified', 'Message delivery latency < 5ms'],
    status: 'operational',
    uptimePct: 99.95,
    history: Array.from({ length: 45 }, () => (Math.random() > 0.03 ? 1 : 0)),
  },
  {
    id: 'storage',
    name: 'Object Storage',
    description: 'File and asset CDN',
    details: 'CDN cache hit ratio at 94.2%',
    healthDetails: ['Edge cache persistence confirmed', 'Brotli compression applied'],
    status: 'operational',
    uptimePct: 99.93,
    history: Array.from({ length: 45 }, () => (Math.random() > 0.01 ? 1 : 0)),
  }
];

export const INCIDENTS: Incident[] = [
  {
    id: 'inc-1',
    title: 'Edge Traffic Latency Issues',
    status: 'investigating',
    severity: 'medium',
    startedAt: 'May 13, 2026 - 16:15 UTC',
    updates: [
      {
        timestamp: 'May 13, 2026 - 17:31 UTC',
        title: 'Update',
        message: 'Our team continues to actively investigate the connectivity issues impacting access to certain regions. We are validating the scope of impact with upstream providers.'
      },
      {
        timestamp: 'May 13, 2026 - 16:46 UTC',
        title: 'Update',
        message: 'Connectivity issues identified originating from specific VPN providers. We are working to resolve this with regional ISPs.'
      }
    ]
  },
  {
    id: 'maint-1',
    title: 'Shared Pooler Maintenance',
    status: 'scheduled',
    severity: 'low',
    startedAt: 'May 14, 2026 - 18:00 UTC',
    updates: [
      {
        timestamp: 'May 07, 2026 - 22:16 UTC',
        title: 'Post',
        message: 'The Shared Pooler will be upgraded to V2 for better scalability. Some connection timeouts might occur for legacy strings.'
      }
    ]
  }
];

export const LATENCY_METRICS: Metric[] = Array.from({ length: 24 }, (_, i) => ({
  timestamp: `${i}:00`,
  value: 65 + Math.random() * 20,
}));
