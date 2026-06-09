#!/usr/bin/env bash
set -euo pipefail

K8S_CTX="${1:-}"

echo "=== Cinema Ticket System — K8s Deploy ==="
echo ""

# ── Use minikube or kind ──
if [ -z "$K8S_CTX" ]; then
  if command -v minikube &>/dev/null; then
    echo "[1] Target: minikube"
    minikube status &>/dev/null || minikube start --cpus=4 --memory=6144
  elif command -v kind &>/dev/null; then
    echo "[1] Target: kind"
    kind get clusters 2>/dev/null | grep -q cinema || kind create cluster --name cinema
  else
    echo "ERROR: No K8s cluster found. Install minikube or kind, or pass a kubeconfig context."
    exit 1
  fi
fi

# ── Build Docker image for K8s ──
echo "[2] Building Docker image..."
docker build -t cinema-ticket-availability-demo:latest ..

# ── If using minikube, load image into minikube ──
if command -v minikube &>/dev/null && minikube status &>/dev/null; then
  echo "[2b] Loading image into minikube..."
  minikube image load cinema-ticket-availability-demo:latest
elif command -v kind &>/dev/null; then
  echo "[2b] Loading image into kind..."
  kind load docker-image cinema-ticket-availability-demo:latest --name cinema
fi

# ── Apply manifests ──
echo "[3] Applying K8s manifests..."
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f middleware.yaml
kubectl apply -f cinema-app.yaml

# ── Wait and show ──
echo ""
echo "[4] Waiting for deployments..."
kubectl rollout status deployment/cinema-web -n cinema --timeout=120s
kubectl rollout status deployment/cinema-otel-collector -n cinema --timeout=60s

echo ""
echo "=== All pods ==="
kubectl get pods -n cinema

echo ""
echo "=== Services ==="
kubectl get svc -n cinema

echo ""
echo "=== Ingress ==="
kubectl get ingress -n cinema

echo ""
echo "=== Done ==="
echo ""
echo "Port forward for local access:"
echo "  kubectl port-forward -n cinema svc/cinema-web 3000:3000"
echo "  kubectl port-forward -n cinema svc/cinema-jaeger 16686:16686"
echo ""
echo "Then visit:"
echo "  http://localhost:3000/login.html            — App"
echo "  http://localhost:16686                       — Jaeger traces"
