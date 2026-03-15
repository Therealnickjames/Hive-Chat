// Package tracing initializes the OpenTelemetry SDK for the streaming proxy.
//
// It exports traces via OTLP (gRPC by default) to the collector configured
// via OTEL_EXPORTER_OTLP_ENDPOINT. If the env var is unset, tracing is a no-op.
package tracing

import (
	"context"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"
)

// Tracer is the package-level tracer for the streaming proxy.
var Tracer trace.Tracer

// Init sets up the OpenTelemetry SDK with OTLP gRPC exporter.
// Returns a shutdown function that flushes remaining spans.
// If OTEL_EXPORTER_OTLP_ENDPOINT is not set, returns a no-op shutdown.
func Init(ctx context.Context) (func(context.Context) error, error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		slog.Info("OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled")
		Tracer = otel.Tracer("tavok-streaming")
		return func(context.Context) error { return nil }, nil
	}

	serviceName := os.Getenv("OTEL_SERVICE_NAME")
	if serviceName == "" {
		serviceName = "tavok-streaming"
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion("0.1.0"),
		),
	)
	if err != nil {
		return nil, err
	}

	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithInsecure(),
		otlptracegrpc.WithEndpoint(endpoint),
	)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	Tracer = tp.Tracer("tavok-streaming")

	slog.Info("OpenTelemetry tracing initialized", "endpoint", endpoint, "service", serviceName)
	return tp.Shutdown, nil
}
