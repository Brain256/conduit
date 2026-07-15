package main

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
)

type Result struct {
	latency time.Duration
	err     error
}

type Aggregate struct {
	ThroughputRPS float64 `json:"throughput_rps"`
	P50MS         float32 `json:"p50_ms"`
	P95MS         float32 `json:"p95_ms"`
	P99MS         float32 `json:"p99_ms"`
	ErrorCount    int     `json:"error_count"`
}

type MetricFrame struct {
	TestID         string    `json:"test_id"`
	Timestamp      string    `json:"timestamp"`
	ElapsedSeconds float64   `json:"elapsed_seconds"`
	Done           bool      `json:"done"`
	Aggregate      Aggregate `json:"aggregate"`
	Agents         []any     `json:"agents"`
	BackendHealth  []any     `json:"backend_health"`
	Events         []any     `json:"events"`
}

// runTest drives the load test and emits one MetricFrame per second over out.
// out is closed when the test finishes so the stream handler's range loop ends.
func runTest(testID string, port, duration, rps, workers int, out chan<- MetricFrame) {
	defer close(out)

	dur := time.Duration(duration) * time.Second
	url := fmt.Sprintf("http://localhost:%d", port)

	tokens := make(chan struct{}, rps)
	interval := time.Second / time.Duration(rps)

	ctx, cancel := context.WithTimeout(context.Background(), dur)
	defer cancel()

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
		},
	}

	// rate limiter
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		defer close(tokens)

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				select {
				case tokens <- struct{}{}:
				default:
				}
			}
		}
	}()

	results := make(chan Result, rps)

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range tokens {
				start := time.Now()
				resp, err := client.Get(url)
				if err != nil {
					results <- Result{err: err}
					continue
				}
				results <- Result{latency: time.Since(start)}
				resp.Body.Close()
			}
		}()
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	overallStart := time.Now()
	lastEmit := overallStart
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var window []float32 
	var errorCount int

	emit := func(done bool) {
		now := time.Now()
		windowSeconds := now.Sub(lastEmit).Seconds()
		lastEmit = now

		out <- buildFrame(testID, now.Sub(overallStart).Seconds(), window, windowSeconds, errorCount, done)
		window = window[:0]
	}

	for {
		select {
		case r, ok := <-results:
			if !ok {
				emit(true)
				return
			}
			if r.err != nil {
				errorCount++
				continue
			}
			window = append(window, float32(r.latency.Seconds()*1000))
		case <-ticker.C:
			emit(false)
		}
	}
}

// buildFrame computes aggregate metrics for the latencies gathered in one window.
func buildFrame(testID string, elapsed float64, latencies []float32, windowSeconds float64, errorCount int, done bool) MetricFrame {
	agg := Aggregate{ErrorCount: errorCount}

	if windowSeconds > 0 {
		agg.ThroughputRPS = float64(len(latencies)) / windowSeconds
	}

	if len(latencies) > 0 {
		sorted := make([]float32, len(latencies))
		copy(sorted, latencies)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

		agg.P50MS = percentile(sorted, 50)
		agg.P95MS = percentile(sorted, 95)
		agg.P99MS = percentile(sorted, 99)
	}

	return MetricFrame{
		TestID:         testID,
		Timestamp:      time.Now().Format(time.RFC3339),
		ElapsedSeconds: elapsed,
		Done:           done,
		Aggregate:      agg,
		Agents:         []any{},
		BackendHealth:  []any{},
		Events:         []any{},
	}
}

func percentile(sorted []float32, p int) float32 {
	idx := (p * len(sorted)) / 100
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}
