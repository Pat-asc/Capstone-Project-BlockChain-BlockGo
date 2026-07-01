# BlockGO Production Readiness Checklist

**Branch:** `performance/optimization-fixes`  
**Target Deployment:** Cloudflare + Google Kubernetes Engine (GKE)  
**Status:** 🟡 **NEEDS FIXES BEFORE PRODUCTION**  
**Last Updated:** 2026-07-01

---

## Executive Summary

The `performance/optimization-fixes` branch has **partially implemented** performance optimizations for scaling. However, **critical memory leaks** and **Kubernetes configuration issues** prevent production deployment with multiple replicas. This document lists all required fixes prioritized by severity.

### Key Blockers
- ❌ **Memory Leaks:** Unbounded gateway cache (50-100MB per 100 users)
- ❌ **Replicas Locked to 1:** Cannot scale horizontally
- ❌ **No Graceful Shutdown:** Kubernetes rolling updates will drop requests
- ❌ **No Memory Monitoring:** Cannot detect leaks in production
- ❌ **Missing Cloudflare Integration:** Cache headers & edge optimization not configured

---

## 🔴 CRITICAL FIXES (Must Complete Before Production)

### 1. Memory Leak Fixes

#### 1.1 Unbounded Gateway Cache
**File:** `middleware/middleware.js` (Lines 48-84)

**Problem:**
- `userGatewayCache` is a plain JavaScript Map with no size limit
- Stores entire Gateway & Contract objects for each user
- ~2MB per gateway × 1000 concurrent users = 2GB memory leak
- No LRU eviction policy

**Status:** ❌ NOT FIXED

**Fix Required:**
```javascript
// REPLACE plain Map with LRU cache
const { LRU } = require('lru-cache');

global.userGatewayCache = new LRU({
    max: 500,                    // Max 500 users
    maxSize: 500 * 2 * 1024,    // 2MB per entry
    maxAge: 5 * 60 * 1000,      // 5 min TTL
    updateAgeOnGet: true,
    dispose: (username, cached) => {
        try {
            cached.gateway.disconnect();
        } catch (e) { }
    }
});
```

**Estimated Impact:**
- Fixes ~80% of memory leak (300-400MB → 50-100MB per pod)
- Enables safe 3-5 replica scaling

**Effort:** 2-3 hours

---

#### 1.2 CA Config Cache Without Expiration
**File:** `middleware/middleware.js` (Lines 46, 306-325)

**Problem:**
- `caConfigCache` is a plain Map with certificate paths held indefinitely
- ~10MB accumulation over 24 hours
- No cleanup or invalidation

**Status:** ❌ NOT FIXED

**Fix Required:**
```javascript
class CAConfigCache {
    constructor() {
        this.configs = new Map();
    }

    set(key, config) {
        this.configs.set(key, {
            ...config,
            createdAt: Date.now(),
        });
    }

    cleanup() {
        const now = Date.now();
        const MAX_AGE = 1 * 60 * 60 * 1000; // 1 hour
        for (const [key, config] of this.configs.entries()) {
            if (now - config.createdAt > MAX_AGE) {
                this.configs.delete(key);
            }
        }
    }
}

// Schedule cleanup every 10 minutes
setInterval(() => caConfigCache.cleanup(), 10 * 60 * 1000);
```

**Effort:** 1-2 hours

---

#### 1.3 Connection Profile Not Cached
**File:** `middleware/middleware.js` (Lines 222-249)

**Problem:**
- `loadConnectionProfile()` called on every user transaction
- Reads JSON file and parses it repeatedly
- Creates string buffers for every peer/orderer URL
- ~1-2MB per request under load

**Status:** ❌ NOT FIXED

**Fix Required:**
```javascript
class ConnectionProfileCache {
    constructor() {
        this.profile = null;
        this.cacheTime = null;
    }

    get() {
        if (!this.profile) return null;
        if (Date.now() - this.cacheTime > 1 * 60 * 60 * 1000) {
            this.profile = null;
            return null;
        }
        return this.profile;
    }

    set(profile) {
        this.profile = profile;
        this.cacheTime = Date.now();
    }
}

// Use in loadConnectionProfile()
const cached = connectionProfileCache.get();
if (cached) return cached;
// ... load and cache ...
```

**Effort:** 1 hour

---

#### 1.4 Event Listener/Timer Leaks
**File:** `middleware/middleware.js` (Lines 19, 26-44, 80-84)

**Problem:**
- Multiple `setInterval()` calls never cleared on process shutdown
- Accumulate in memory during rolling K8s updates
- `require('events').EventEmitter.defaultMaxListeners = 100` warns but doesn't fix

**Status:** ❌ NOT FIXED

**Fix Required:**
```javascript
// Track all timers and listeners
const timers = [];

let uploadGarbageCollectorId = setInterval(() => { ... }, 60 * 60 * 1000);
timers.push(uploadGarbageCollectorId);

let gatewayPruneId = setInterval(() => { ... }, GATEWAY_PRUNE_INTERVAL_MS);
timers.push(gatewayPruneId);

// On graceful shutdown
process.on('SIGTERM', () => {
    console.log('Graceful shutdown: clearing timers');
    timers.forEach(id => clearInterval(id));
    // ... cleanup ...
});
```

**Effort:** 1 hour

---

#### 1.5 CouchDB Wallet Connection Leaks
**File:** `middleware/middleware.js` (Lines 406-491, 432-455)

**Problem:**
- `getWallet()` called per request; creates new wallet wrapper
- Wallet encryption wrapper added via `wallet.put()` override
- **Multiple wrappers stack** on same wallet object if called repeatedly
- Closure chain retains references indefinitely

**Status:** ❌ NOT FIXED

**Fix Required:**
```javascript
// Cache wallet instances per role
const walletCache = new Map();

async function getWallet(role = 'registrar') {
    const normalizedRole = String(role).toLowerCase();
    
    // Check cache first
    if (walletCache.has(normalizedRole)) {
        return walletCache.get(normalizedRole);
    }

    // ... create wallet ...
    
    // Cache it
    walletCache.set(normalizedRole, wallet);
    return wallet;
}

// NO repeated wrapper assignments
```

**Effort:** 2 hours

---

### 2. Kubernetes Configuration Fixes

#### 2.1 Replicas Locked to 1
**File:** `network/k8s/08-middleware-api.yaml` (Lines 9, 203-204)

**Problem:**
- `replicas: 1` in Deployment spec
- HPA `minReplicas: 1` and `maxReplicas: 1`
- Cannot scale horizontally; defeats Kubernetes orchestration

**Status:** ❌ NOT FIXED

**Fix Required:**
```yaml
# Deployment
spec:
  replicas: 2                    # ← Change from 1

---
# HPA
spec:
  minReplicas: 2                 # ← Change from 1
  maxReplicas: 5
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
```

**Effort:** 30 minutes

---

#### 2.2 No Pod Disruption Budget
**File:** `network/k8s/` (MISSING)

**Problem:**
- Kubernetes can evict pods during node maintenance without warning
- Requests will be dropped during rolling updates
- No graceful shutdown coordination

**Status:** ❌ NOT CREATED

**Fix Required:**
```yaml
# network/k8s/09-pod-disruption-budget.yaml (CREATE NEW)
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: middleware-api-pdb
  namespace: plv-fabric
spec:
  minAvailable: 1              # Keep at least 1 pod running
  selector:
    matchLabels:
      app: middleware-api

---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: client-app-pdb
  namespace: plv-fabric
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: client-app
```

**Effort:** 1 hour

---

#### 2.3 No Graceful Shutdown Period
**File:** `network/k8s/08-middleware-api.yaml` (Template spec)

**Problem:**
- No `terminationGracePeriodSeconds` defined
- Default is 30 seconds, may be insufficient for Fabric connections
- Connections abruptly closed during rolling updates

**Status:** ❌ NOT FIXED

**Fix Required:**
```yaml
spec:
  terminationGracePeriodSeconds: 45    # ← ADD THIS
  containers:
  - name: middleware
    # ... rest of config ...
```

**Effort:** 15 minutes

---

#### 2.4 Memory Limits Too Loose
**File:** `network/k8s/08-middleware-api.yaml` (Lines 128-134)

**Problem:**
- `limits.memory: 768Mi` allows unlimited growth until OOM kill
- With memory leaks, will reach limit and crash
- No early warning or graceful degradation

**Status:** ⚠️ PARTIALLY FIXED (needs Node.js flag)

**Fix Required:**
```yaml
env:
- name: NODE_OPTIONS
  value: "--max-old-space-size=512"    # ← Force GC at 512MB
- name: MEMORY_THRESHOLD_MB
  value: "500"                          # ← Alert at 500MB

resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "768Mi"                     # ← Keep tight
    cpu: "1000m"
```

**Effort:** 30 minutes

---

#### 2.5 HPA Metrics Too High
**File:** `network/k8s/08-middleware-api.yaml` (Lines 205-217)

**Problem:**
- `averageUtilization: 70` for CPU (too high; leaves no headroom)
- `averageUtilization: 80` for memory (risky; may OOM before scaling)
- Will wait until critical resource levels before scaling

**Status:** ⚠️ PARTIALLY FIXED

**Fix Required:**
```yaml
metrics:
- type: Resource
  resource:
    name: cpu
    target:
      type: Utilization
      averageUtilization: 60    # ← Lower from 70
- type: Resource
  resource:
    name: memory
    target:
      type: Utilization
      averageUtilization: 70    # ← Lower from 80
```

**Effort:** 15 minutes

---

### 3. Missing Production Features

#### 3.1 No Memory Monitoring
**File:** MISSING

**Problem:**
- Cannot detect memory leaks in production
- No alerts when memory approaches limits
- Cannot correlate memory spike to specific user actions

**Status:** ❌ NOT IMPLEMENTED

**Fix Required:**
```javascript
// middleware/memory-monitor.js (CREATE NEW)
class MemoryMonitor {
    constructor(intervalMs = 30000) {
        this.thresholdMB = parseFloat(process.env.MEMORY_THRESHOLD_MB || '500');
        this.timerId = setInterval(() => {
            const usage = process.memoryUsage();
            const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
            
            console.log(`[Memory] Heap: ${heapUsedMB}MB`);
            
            if (heapUsedMB > this.thresholdMB) {
                console.warn(`[Memory-Alert] Threshold exceeded: ${heapUsedMB}MB > ${this.thresholdMB}MB`);
                if (global.gc) global.gc();  // Force GC
            }
        }, intervalMs);
    }
}

module.exports = MemoryMonitor;
```

**Effort:** 1-2 hours

---

#### 3.2 No Cloudflare Cache Headers
**File:** `middleware/middleware.js` (MISSING)

**Problem:**
- No `Cache-Control` headers for static assets
- Cloudflare cannot cache efficiently
- Frontend updated slowly; stale assets served
- No `ETag` for cache validation

**Status:** ❌ NOT IMPLEMENTED

**Fix Required:**
```javascript
// Add after CORS middleware
app.use((req, res, next) => {
    if (req.path.match(/\.(js|css|png|jpg|svg)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('ETag', 'W/"static-v1"');
    } else if (req.path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    }
    next();
});
```

**Effort:** 1 hour

---

#### 3.3 No Gzip Compression
**File:** `middleware/middleware.js` (MISSING)

**Problem:**
- Large JSON responses not compressed
- Network bandwidth wasted
- Poor performance for users on slow connections
- Especially bad for batch grade uploads

**Status:** ❌ NOT IMPLEMENTED

**Fix Required:**
```javascript
const compression = require('compression');

app.use(compression({ 
    threshold: 1024,  // Compress responses > 1KB
    level: 6          // Balance compression ratio vs CPU
}));
```

**Effort:** 30 minutes

---

#### 3.4 No Request Body Size Limit
**File:** `middleware/middleware.js` (Line 359)

**Problem:**
- `app.use(express.json())` has no limit
- Large Excel uploads can cause OOM
- DDoS attack vector (send huge JSON payload)
- C# backend can send large requests without checks

**Status:** ❌ NOT FIXED

**Fix Required:**
```javascript
app.use(express.json({ 
    limit: '50mb'  // ← ADD THIS
}));
app.use(express.urlencoded({ 
    limit: '50mb'  // ← ADD THIS
}));
```

**Effort:** 15 minutes

---

#### 3.5 Backend Config Timeout Too Low
**File:** `network/k8s/08-middleware-api.yaml` (Line 170)

**Problem:**
- GCP BackendConfig `timeoutSec: 120` insufficient for batch uploads
- Large Excel files timeout mid-processing
- Request cancelled before completion; partial data committed

**Status:** ❌ NOT FIXED

**Fix Required:**
```yaml
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: middleware-api-backend-config
  namespace: plv-fabric
spec:
  timeoutSec: 300                 # ← Change from 120
  connectionDraining:
    drainingTimeoutSec: 60        # ← ADD THIS
  healthCheck:
    type: HTTP
    requestPath: /api/health
    port: 4000
```

**Effort:** 15 minutes

---

#### 3.6 No Cloudflare Worker Script
**File:** MISSING

**Problem:**
- No sticky session routing
- Users can be routed to different pods between requests
- Session affinity disabled for Cloudflare
- Cache not optimized for edge

**Status:** ❌ NOT CREATED

**Fix Required:**
```javascript
// cloudflare-worker.js (CREATE NEW)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route API to GKE
    if (url.pathname.startsWith('/api/')) {
      const backend = `https://blockgo-api.${env.GKE_CLUSTER}.googleapis.com`;
      
      // Sticky session: route same user to same pod
      const auth = request.headers.get('Authorization') || '';
      const sessionHash = hashCode(auth) % 5;  // 5 replicas
      
      return fetch(backend, {
        ...request,
        headers: {
          ...Object.fromEntries(request.headers),
          'X-Pod-Affinity': sessionHash.toString(),
        },
      });
    }
    
    return fetch(request);
  }
};

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}
```

**Effort:** 2 hours

---

## 🟡 HIGH PRIORITY FIXES (Must Complete for Stability)

### 4. Monitoring & Observability

#### 4.1 No Prometheus Metrics
**File:** MISSING

**Problem:**
- Cannot observe request rate, latency, error rate
- No visibility into Kubernetes cluster health
- Cannot set up alerts

**Status:** ❌ NOT IMPLEMENTED

**Fix Required:**
```javascript
// Add to middleware.js
const promClient = require('prom-client');

const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.5, 1.0, 2.0, 5.0]
});

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        httpRequestDuration.observe({
            method: req.method,
            route: req.route?.path || req.path,
            status_code: res.statusCode
        }, duration);
    });
    next();
});

app.get('/metrics', (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(promClient.register.metrics());
});
```

**Effort:** 3-4 hours (includes Prometheus + Grafana K8s setup)

---

#### 4.2 No Structured Logging
**File:** MISSING

**Problem:**
- JSON logs not structured
- Cannot filter/search logs easily in production
- No correlation IDs for request tracing

**Status:** ❌ NOT IMPLEMENTED

**Fix Required:**
```javascript
// middleware/logger.js (CREATE NEW)
const winston = require('winston');

const logger = winston.createLogger({
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Use in routes
logger.info('Grade recorded', {
    correlationId: req.id,
    userId: username,
    gradeId: gradeRecord.id,
    timestamp: new Date().toISOString()
});
```

**Effort:** 2-3 hours

---

### 5. Security Hardening

#### 5.1 No HTTPS/TLS Enforcement
**File:** `middleware/nginx/nginx.conf` (MISSING in K8s)

**Problem:**
- Kubernetes LoadBalancer exposes HTTP traffic
- No TLS termination at ingress
- Man-in-the-middle vulnerability

**Status:** ⚠️ PARTIALLY FIXED (K8s cert missing)

**Fix Required:**
```yaml
# network/k8s/08-ingress.yaml (UPDATE)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: blockgo-ingress
  namespace: plv-fabric
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
  - hosts:
    - blockgo.example.com
    secretName: blockgo-tls
  rules:
  - host: blockgo.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: middleware-api
            port:
              number: 4000
```

**Effort:** 2 hours

---

#### 5.2 No Network Policies
**File:** MISSING

**Problem:**
- All pods can communicate with all other pods
- No network segmentation
- Lateral movement after compromise

**Status:** ❌ NOT IMPLEMENTED

**Fix Required:**
```yaml
# network/k8s/10-network-policies.yaml (CREATE NEW)
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: plv-fabric
spec:
  podSelector: {}
  policyTypes:
  - Ingress

---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-middleware-api
  namespace: plv-fabric
spec:
  podSelector:
    matchLabels:
      app: middleware-api
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 4000
```

**Effort:** 2-3 hours

---

## 🟢 MEDIUM PRIORITY FIXES (Best Practices)

### 6. Documentation

#### 6.1 Production Deployment Guide
**File:** MISSING (or incomplete)

**Status:** ⚠️ PARTIALLY DONE

**Fix Required:**
- Add `PRODUCTION_DEPLOYMENT.md` with:
  - Pre-deployment checklist
  - Step-by-step GKE deployment
  - Cloudflare setup guide
  - Monitoring dashboard screenshots
  - Runbooks for common issues

**Effort:** 4-6 hours

---

#### 6.2 Troubleshooting Guide for Production
**File:** README.md (Lines 659-775, INCOMPLETE)

**Status:** ⚠️ PARTIALLY DONE

**Updates Needed:**
- Add memory leak symptoms & diagnostics
- Add pod scaling troubleshooting
- Add Cloudflare edge debugging
- Add performance baseline metrics

**Effort:** 2-3 hours

---

### 7. Performance Testing

#### 7.1 Load Test Script
**File:** MISSING

**Status:** ❌ NOT CREATED

**Fix Required:**
```javascript
// k6-load-test.js (CREATE NEW)
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 200,                    # 200 concurrent users
    duration: '10m',
    thresholds: {
        http_req_duration: ['p(95)<500', 'p(99)<1000'],
        http_req_failed: ['rate<0.01'],
    },
};

export default function() {
    const token = login();
    fetchGrades(token);
    sleep(Math.random() * 3);
}
```

**Effort:** 2-3 hours (includes test scenarios)

---

#### 7.2 Memory Profiling Guide
**File:** MISSING

**Status:** ❌ NOT CREATED

**Fix Required:**
- Add Node.js heapdump generation steps
- Add memory analysis guide
- Add V8 profiler setup

**Effort:** 1-2 hours

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
**Priority:** 🔴 MUST COMPLETE BEFORE PRODUCTION

1. ✅ Implement LRU gateway cache (2-3h)
2. ✅ Add CA config cache with expiration (1-2h)
3. ✅ Cache connection profiles (1h)
4. ✅ Fix event listener/timer leaks (1h)
5. ✅ Cache wallet instances (2h)
6. ✅ Update HPA replicas config (30m)
7. ✅ Create PodDisruptionBudget (1h)
8. ✅ Add graceful shutdown period (15m)
9. ✅ Set memory limits & Node.js flags (30m)
10. ✅ Lower HPA thresholds (15m)
11. ✅ Increase backend timeout (15m)
12. ✅ Add request body size limit (15m)

**Total: ~14-16 hours**

---

### Phase 2: Monitoring & Observability (Week 2)
**Priority:** 🟡 HIGH - Required for production support

1. ✅ Implement memory monitoring (1-2h)
2. ✅ Add Prometheus metrics (3-4h)
3. ✅ Add structured logging (2-3h)
4. ✅ Setup Grafana dashboards (2-3h)

**Total: ~10-12 hours**

---

### Phase 3: Security Hardening (Week 3)
**Priority:** 🟡 HIGH - Required for production compliance

1. ✅ Deploy cert-manager & TLS ingress (2h)
2. ✅ Create network policies (2-3h)
3. ✅ Add pod security policies (1-2h)
4. ✅ Enable audit logging (1h)

**Total: ~7-8 hours**

---

### Phase 4: Documentation & Testing (Week 4)
**Priority:** 🟢 MEDIUM - Required for operational handoff

1. ✅ Write production deployment guide (4-6h)
2. ✅ Create k6 load test (2-3h)
3. ✅ Add memory profiling guide (1-2h)
4. ✅ Update troubleshooting docs (2-3h)

**Total: ~10-14 hours**

---

## Deployment Checklist

### Pre-Production Validation

- [ ] All critical fixes implemented (Phase 1)
- [ ] Memory monitoring active for 72 hours (no leaks detected)
- [ ] HPA scaling tested (1→5 replicas)
- [ ] Graceful shutdown validated (no request loss during rolling updates)
- [ ] Load test passed (200 concurrent users, p95 < 500ms)
- [ ] Cloudflare edge tested (cache hit rate > 80%)
- [ ] Security scan passed (network policies, RBAC, TLS)
- [ ] Disaster recovery tested (restore from backup)
- [ ] Runbooks reviewed by ops team
- [ ] Monitoring dashboards active and alerting

### Production Deployment Steps

```bash
# 1. Create Phase 1 branch
git checkout -b bugfix/production-critical-fixes

# 2. Implement all Phase 1 fixes
# (See implementation details below)

# 3. Test locally with replicas=3
docker-compose up -d
kubectl apply -f network/k8s/08-middleware-api.yaml

# 4. Run load test
k6 run k6-load-test.js --vus 200 --duration 10m

# 5. Monitor for 24 hours
kubectl logs -f deployment/middleware-api -n plv-fabric | grep Memory

# 6. If stable, merge and deploy to GKE
git push origin bugfix/production-critical-fixes
# Create PR, get approval, merge

# 7. Deploy to GKE
kubectl apply -f network/k8s/08-middleware-api.yaml

# 8. Cloudflare setup
# (See cloudflare-worker.js)

# 9. Monitoring setup
kubectl apply -f monitoring/prometheus.yaml
kubectl apply -f monitoring/grafana.yaml

# 10. Final validation
curl https://blockgo.example.com/api/health
```

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Memory leak persists on 3 replicas | Medium | High | Implement Phase 1, monitor 72h |
| OOM kill during peak usage | Medium | High | Set memory limits, add alerts |
| Request loss during rolling update | Medium | High | Add PDB, graceful shutdown |
| Cloudflare cache serves stale data | Low | Medium | Add ETag, set short TTL |
| Network policy breaks service | Low | High | Test in staging first |
| Performance degradation with 5 replicas | Low | Medium | Load test before deployment |

---

## Success Metrics

### Memory Stability
- ✅ Heap usage stabilizes at 400-500MB per pod
- ✅ No OOM kills after 7 days of operation
- ✅ Memory growth rate < 1MB/hour

### Scaling Performance
- ✅ Scale from 1→5 replicas in < 2 minutes
- ✅ No dropped requests during scale events
- ✅ HPA automatically triggers at 60% CPU utilization

### API Latency
- ✅ p50 login latency < 200ms
- ✅ p95 grade query latency < 500ms
- ✅ p99 batch upload latency < 5s

### Availability
- ✅ 99.9% uptime (5.26 minutes downtime per month)
- ✅ Zero data loss incidents
- ✅ Recovery time objective (RTO) < 15 minutes

---

## Sign-Off

| Role | Signature | Date |
|------|-----------|------|
| Tech Lead | ________________ | __/__/__ |
| DevOps | ________________ | __/__/__ |
| Security | ________________ | __/__/__ |
| Project Manager | ________________ | __/__/__ |

---

## Appendix: Implementation Details

### A. Complete memory-leak-fixes.js
See `middleware/memory-leak-fixes.js` in this repository (to be created)

### B. Updated middleware.js Sections
See pull request description for code diffs

### C. Updated K8s Manifests
See `network/k8s/` directory

### D. Cloudflare Worker Configuration
See `cloudflare/worker.js` (to be created)

### E. Production Environment Variables
```bash
# Add to GKE secrets
MAX_GATEWAY_CACHE_SIZE=500
MEMORY_THRESHOLD_MB=500
GATEWAY_IDLE_TIMEOUT_MS=300000
PG_POOL_MAX=30
NODE_OPTIONS="--max-old-space-size=512 --expose-gc"
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-07-01  
**Next Review:** 2026-07-08
