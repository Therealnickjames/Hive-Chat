// Package metrics provides Prometheus metrics for the streaming proxy.
package metrics

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Metrics holds all application-level counters and gauges.
type Metrics struct {
	mu sync.RWMutex

	// Stream lifecycle
	StreamsStarted   int64
	StreamsCompleted int64
	StreamsErrored   int64
	ActiveStreams     int64

	// Token throughput
	TokensEmitted int64

	// Provider errors
	ProviderErrors int64

	// Latency tracking (simple histogram buckets)
	TTFTSamples []float64 // Time-to-first-token in ms
}

var global = &Metrics{}

// Get returns the global metrics instance.
func Get() *Metrics { return global }

func (m *Metrics) StreamStarted() {
	m.mu.Lock()
	m.StreamsStarted++
	m.ActiveStreams++
	m.mu.Unlock()
}

func (m *Metrics) StreamCompleted() {
	m.mu.Lock()
	m.StreamsCompleted++
	if m.ActiveStreams > 0 {
		m.ActiveStreams--
	}
	m.mu.Unlock()
}

func (m *Metrics) StreamError() {
	m.mu.Lock()
	m.StreamsErrored++
	if m.ActiveStreams > 0 {
		m.ActiveStreams--
	}
	m.mu.Unlock()
}

func (m *Metrics) TokenEmitted(count int64) {
	m.mu.Lock()
	m.TokensEmitted += count
	m.mu.Unlock()
}

func (m *Metrics) ProviderError() {
	m.mu.Lock()
	m.ProviderErrors++
	m.mu.Unlock()
}

func (m *Metrics) RecordTTFT(d time.Duration) {
	m.mu.Lock()
	m.TTFTSamples = append(m.TTFTSamples, float64(d.Milliseconds()))
	// Keep only last 1000 samples
	if len(m.TTFTSamples) > 1000 {
		m.TTFTSamples = m.TTFTSamples[len(m.TTFTSamples)-1000:]
	}
	m.mu.Unlock()
}

// Handler serves Prometheus-format metrics at /metrics.
func Handler(w http.ResponseWriter, r *http.Request) {
	m := global
	m.mu.RLock()
	defer m.mu.RUnlock()

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	fmt.Fprintf(w, "# HELP tavok_streams_started_total Total streams started\n")
	fmt.Fprintf(w, "# TYPE tavok_streams_started_total counter\n")
	fmt.Fprintf(w, "tavok_streams_started_total %d\n\n", m.StreamsStarted)

	fmt.Fprintf(w, "# HELP tavok_streams_completed_total Total streams completed successfully\n")
	fmt.Fprintf(w, "# TYPE tavok_streams_completed_total counter\n")
	fmt.Fprintf(w, "tavok_streams_completed_total %d\n\n", m.StreamsCompleted)

	fmt.Fprintf(w, "# HELP tavok_streams_errored_total Total streams that errored\n")
	fmt.Fprintf(w, "# TYPE tavok_streams_errored_total counter\n")
	fmt.Fprintf(w, "tavok_streams_errored_total %d\n\n", m.StreamsErrored)

	fmt.Fprintf(w, "# HELP tavok_streams_active Currently active streams\n")
	fmt.Fprintf(w, "# TYPE tavok_streams_active gauge\n")
	fmt.Fprintf(w, "tavok_streams_active %d\n\n", m.ActiveStreams)

	fmt.Fprintf(w, "# HELP tavok_tokens_emitted_total Total tokens emitted\n")
	fmt.Fprintf(w, "# TYPE tavok_tokens_emitted_total counter\n")
	fmt.Fprintf(w, "tavok_tokens_emitted_total %d\n\n", m.TokensEmitted)

	fmt.Fprintf(w, "# HELP tavok_provider_errors_total Total provider/LLM API errors\n")
	fmt.Fprintf(w, "# TYPE tavok_provider_errors_total counter\n")
	fmt.Fprintf(w, "tavok_provider_errors_total %d\n\n", m.ProviderErrors)

	// TTFT summary (p50, p95, p99)
	if len(m.TTFTSamples) > 0 {
		sorted := make([]float64, len(m.TTFTSamples))
		copy(sorted, m.TTFTSamples)
		// Simple sort for percentile calculation
		for i := range sorted {
			for j := i + 1; j < len(sorted); j++ {
				if sorted[j] < sorted[i] {
					sorted[i], sorted[j] = sorted[j], sorted[i]
				}
			}
		}
		p50 := sorted[len(sorted)/2]
		p95 := sorted[int(float64(len(sorted))*0.95)]
		p99 := sorted[int(float64(len(sorted))*0.99)]

		fmt.Fprintf(w, "# HELP tavok_ttft_ms Time to first token in milliseconds\n")
		fmt.Fprintf(w, "# TYPE tavok_ttft_ms summary\n")
		fmt.Fprintf(w, "tavok_ttft_ms{quantile=\"0.5\"} %.1f\n", p50)
		fmt.Fprintf(w, "tavok_ttft_ms{quantile=\"0.95\"} %.1f\n", p95)
		fmt.Fprintf(w, "tavok_ttft_ms{quantile=\"0.99\"} %.1f\n", p99)
		fmt.Fprintf(w, "tavok_ttft_ms_count %d\n\n", len(m.TTFTSamples))
	}
}
