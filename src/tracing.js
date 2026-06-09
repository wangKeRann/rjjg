const { NodeSDK } = require("@opentelemetry/sdk-node");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { ConsoleSpanExporter } = require("@opentelemetry/sdk-trace-node");
const { Resource } = require("@opentelemetry/resources");
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require("@opentelemetry/semantic-conventions");

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "cinema-web",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  }),
  traceExporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

process.on("SIGTERM", () => {
  sdk.shutdown().then(() => process.exit(0));
});

module.exports = sdk;
