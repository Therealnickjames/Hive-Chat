// OpenTelemetry instrumentation for the Next.js web service.
// Called once on server startup via Next.js instrumentation hook.
// Traces are exported via OTLP HTTP to the collector.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import to avoid loading OTel in edge runtime
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const {
      OTLPTraceExporter,
    } = await import("@opentelemetry/exporter-trace-otlp-http");
    const {
      HttpInstrumentation,
    } = await import("@opentelemetry/instrumentation-http");
    const {
      UndiciInstrumentation,
    } = await import("@opentelemetry/instrumentation-undici");
    const { resourceFromAttributes } = await import("@opentelemetry/resources");
    const {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
    } = await import("@opentelemetry/semantic-conventions");
    const {
      PrismaInstrumentation,
    } = await import("@prisma/instrumentation");

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) {
      console.log(
        "OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled",
      );
      return;
    }

    const serviceName = process.env.OTEL_SERVICE_NAME || "tavok-web";

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: "0.1.0",
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
      }),
      instrumentations: [
        new HttpInstrumentation(),
        new UndiciInstrumentation(),
        new PrismaInstrumentation(),
      ],
    });

    sdk.start();

    console.log(
      `OpenTelemetry tracing initialized: service=${serviceName} endpoint=${endpoint}`,
    );
  }
}
