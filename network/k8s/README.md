# K8s Deployment Guide for PLV BLOCKGO

## Quick Start

### 1. Prerequisites
- Kubernetes cluster (v1.24+) running (local: Docker Desktop, minikube, kind)
- `kubectl` CLI installed and configured
- Sufficient resources: 4 CPU cores, 16GB RAM minimum

### 2. Deploy to Kubernetes

```bash
# Navigate to the network directory
cd ../network
chmod +x ./full_deploy.sh

# Deploy Hybrid Architecture (K8s Apps + Compose Data)
./full_deploy.sh k8s apply

# Monitor deployment status
./full_deploy.sh k8s status

# View logs
kubectl logs deployment/plv-middleware -n plv-fabric -f
```

### 3. Verify Deployment

```bash
# Check all pods running
kubectl get pods -n plv-fabric
kubectl get pods -n plv-main-campus

# Check services
kubectl get svc -n plv-fabric
kubectl get svc -n plv-main-campus

# Check persistent volumes
kubectl get pvc --all-namespaces
```

### 4. Access the API

```bash
# Port-forward middleware API
kubectl port-forward -n plv-fabric svc/middleware-api 4000:4000

# Test health endpoint
curl http://localhost:4000/api/health
```

### 5. Initialize Fabric Network

After pods are running:

```bash
# Create channel
./k8s/init-channel.sh

# Install chaincode
./k8s/install-chaincode.sh

# Instantiate chaincode
./k8s/instantiate-chaincode.sh
```

## Architecture Overview

### Namespaces
- **plv-fabric**: Core blockchain + IPFS + API middleware
- **plv-main-campus**: Registrar org (orderer, peer, CA)
- **plv-annex-campus**: Faculty org (CA, peer, CouchDB)
- **plv-pubad-campus**: Department org (CA, peer, CouchDB)

### Components

| Component | Type | Replicas | Storage |
|-----------|------|----------|---------|
| PostgreSQL | StatefulSet | 1 | 100Gi |
| Fabric Orderer | StatefulSet | 1 | 20Gi |
| Fabric Peer | Deployment | 1 | 50Gi |
| Fabric CA | Deployment | 3 | ephemeral |
| CouchDB | StatefulSet | 1 | 30Gi |
| Middleware API | Deployment | 2-5 (HPA) | ephemeral |
| IPFS Nodes | StatefulSet | 3 | 100Gi |

## Storage

- **StorageClass**: `fabric-storage` (host-path provisioner)
- **Persistent Volumes**: Created on node `/mnt/data/` directories
- **For production**: Use CSI drivers (AWS EBS, GCP Persistent Disk, Azure Disk, NFS)

## Security

### Secrets Management
- All credentials in `02-configmap-secret.yaml`
- For production: Use HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault

### RBAC
- ServiceAccounts per component
- ClusterRoles restrict pod access to necessary resources

### Network Policies
- Deny-all ingress by default
- Allow specific pod-to-pod communication
- Restrict egress to necessary services

### TLS/mTLS
- Enabled for all Fabric components (CORE_PEER_TLS_ENABLED=true)
- Certificate paths mounted from secrets

## Troubleshooting

### Pod stuck in Pending
```bash
kubectl describe pod <pod-name> -n <namespace>
# Check PVC, StorageClass, resource limits
```

### Pod CrashLoopBackOff
```bash
kubectl logs <pod-name> -n <namespace> --previous
# Check environment variables, volume mounts
```

### Networking issues between pods
```bash
kubectl exec -it <pod-name> -n <namespace> -- ping <service-name>
# Verify DNS resolution and network policies
```

### Database connection errors
```bash
# Check PostgreSQL service
kubectl get svc postgres -n plv-main-campus
kubectl exec -it postgres-0 -n plv-main-campus -- psql -U BLOCKGO -d ActivityLogs

# Verify credentials in Secret
kubectl get secret blockgo-secrets -n plv-fabric -o yaml
```

## Cleanup

```bash
# Delete all resources
./k8s/deploy-k8s.sh plv-fabric delete

# Or manually
kubectl delete namespace plv-fabric plv-main-campus plv-annex-campus plv-pubad-campus
```

## Production Considerations

1. **High Availability**
   - Deploy orderers as StatefulSet with replicas: 3
   - Deploy peers with anti-affinity rules
   - Use PodDisruptionBudgets

2. **Persistent Storage**
   - Replace host-path with cloud storage (EBS, GCP PD, Azure Disk)
   - Enable automated backups
   - Test disaster recovery

3. **Monitoring**
   - Deploy Prometheus + Grafana
   - Enable audit logging
   - Set up alerts for pod failures

4. **Secrets**
   - Rotate credentials regularly
   - Use external secrets operator
   - Encrypt secrets at rest (etcd encryption)

5. **Scaling**
   - HPA configured for middleware-api
   - Consider KPA (Knative) for auto-scaling
   - Monitor resource usage

## References

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Hyperledger Fabric on Kubernetes](https://hyperledger-fabric.readthedocs.io/)
- [IPFS Kubernetes Deployment](https://docs.ipfs.io/how-to/run-ipfs-inside-docker/)
