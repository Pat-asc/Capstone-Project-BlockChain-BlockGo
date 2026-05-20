# Design Specification: Kubernetes & Hyperledger Fabric Cluster Performance Boost

**Date**: 2026-05-20
**Status**: Approved (Design Phase)
**Goal**: Increase system throughput (TPS) and resolve slowness in user-facing features (Login/Chat) through infrastructure scaling and protocol tuning.

## 1. Architecture Overview

The system consists of a Hyperledger Fabric blockchain network, a Node.js middleware, and a C# .NET client application, all running on Google Kubernetes Engine (GKE).

## 2. Infrastructure & Scaling

### 2.1 Storage Upgrade
- **Target**: `StorageClass` named `fabric-storage`.
- **Change**: Switch `type` from `pd-balanced` to `pd-ssd`.
- **Rationale**: Faster IOPS and lower latency for Peers (Ledger), Orderers (Block Storage), and Databases (CouchDB/Postgres).

### 2.2 Horizontal Pod Autoscaling (HPA)
- **Target**: `middleware-api-hpa` and `client-app-hpa`.
- **Change**: Update `maxReplicas` from `1` to `10`.
- **Scaling Metric**: CPU Utilization (Target 70%) and Memory Utilization (Target 80%).
- **Rationale**: Allows the application layer to scale horizontally during high traffic, resolving bottlenecks in concurrent request processing.

### 2.3 Resource Quotas & Limits
- **Namespace**: `plv-fabric`, `plv-main-campus`, etc.
- **Change**: Increase `ResourceQuota` limits to provide more headroom for bursty blockchain operations.
- **Peer/Orderer Resources**: Update `LimitRange` to allow up to 4 CPU and 8Gi Memory per pod if needed.

## 3. Fabric & Database Tuning

### 3.1 Ordering Service Tuning
- **Target**: `configtx.yaml`.
- **Parameters**:
    - `BatchTimeout`: Reduce from default (likely 2s) to `500ms`.
    - `MaxMessageCount`: Increase from default (likely 10) to `100`.
    - `AbsoluteMaxBytes`: Increase to `99 MB`.
- **Rationale**: Faster block cutting and higher transaction density per block.

### 3.2 State Database (CouchDB) Optimization
- **Parameters**: Tune `stateCacheSize` in Peer configurations.
- **Resources**: Increase memory limits for CouchDB StatefulSets to allow better caching.

### 3.3 Postgres Connection Tuning
- **Target**: `postgres-config` and Middleware env vars.
- **Change**: Increase `PG_POOL_MAX` from `20` to `50` or higher.
- **Database**: Ensure `max_connections` in Postgres matches the aggregate pool size of all middleware replicas.

## 4. Implementation Strategy

1. **Phase 1: Storage & Quotas**: Apply changes to StorageClass and ResourceQuotas.
2. **Phase 2: Scaling**: Update HPA configurations and deploy.
3. **Phase 3: Fabric Tuning**: Reconfigure channel and ordering service parameters.
4. **Phase 4: Verification**: Use existing `stress-test.yml` pipeline with `autocannon` to verify throughput improvements.

## 5. Success Criteria
- Sustained Throughput (TPS) increase of at least 2x.
- Significant reduction in perceived latency for Login and Chat operations under concurrent load.
