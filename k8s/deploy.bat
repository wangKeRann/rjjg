@echo off
setlocal

echo === Cinema Ticket System -- K8s Deploy (Windows) ===
echo.

REM -- Build Docker image --
echo [1] Building Docker image...
docker build -t cinema-ticket-availability-demo:latest ..

REM -- Load into minikube if available --
where minikube >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [2] Loading image into minikube...
    minikube image load cinema-ticket-availability-demo:latest
    if %ERRORLEVEL% NEQ 0 (
        echo WARNING: minikube image load failed. Is minikube running?
    )
)

REM -- Apply manifests --
echo [3] Applying K8s manifests...
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f middleware.yaml
kubectl apply -f cinema-app.yaml

echo.
echo [4] Checking rollout...
kubectl rollout status deployment/cinema-web -n cinema --timeout=120s
kubectl rollout status deployment/cinema-otel-collector -n cinema --timeout=60s

echo.
echo === All pods ===
kubectl get pods -n cinema

echo.
echo === Services ===
kubectl get svc -n cinema

echo.
echo === Done ===
echo.
echo Port forward for local access:
echo   kubectl port-forward -n cinema svc/cinema-web 3000:3000
echo   kubectl port-forward -n cinema svc/cinema-jaeger 16686:16686
echo.
echo Then visit:
echo   http://localhost:3000/login.html   - App
echo   http://localhost:16686              - Jaeger traces
endlocal
