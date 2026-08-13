package main

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"time"
)

// LoadMode selects how workers pace their requests.
type LoadMode string

const (
	// LoadModeClosed paces requests with a token bucket so TargetRPS acts as a
	// ceiling. It answers "did the target keep up with this rate".
	LoadModeClosed LoadMode = "closed"
	// LoadModeOpen drops the pacer and lets every worker send flat out, so
	// achieved throughput becomes workers/mean-latency. It answers "what is the
	// maximum". TargetRPS is not used and is reported as 0.
	LoadModeOpen LoadMode = "open"
)

// TestParameters are the immutable settings supplied when a test starts.
// TargetRPS is meaningful only when LoadMode is LoadModeClosed.
type TestParameters struct {
	Port            int      `json:"port"`
	DurationSeconds int      `json:"duration_seconds"`
	TargetRPS       int      `json:"target_rps"`
	Workers         int      `json:"workers"`
	LoadMode        LoadMode `json:"load_mode"`
}

// AggregateMetrics are cumulative measurements for a test at a frame time.
type AggregateMetrics struct {
	ThroughputRPS  float64 `json:"throughput_rps"`
	CompletedCount int     `json:"completed_count"`
	FailedCount    int     `json:"failed_count"`
	P50MS          float64 `json:"p50_ms"`
	P95MS          float64 `json:"p95_ms"`
	P99MS          float64 `json:"p99_ms"`
}

// Aggregate preserves the previous Go name while the wire contract uses the
// cumulative AggregateMetrics fields.
type Aggregate = AggregateMetrics

type RequestPayload struct {
	Method    string              `json:"method"`
	TargetURL string              `json:"target_url"`
	Headers   map[string][]string `json:"headers"`
	Body      string              `json:"body"`
}

type ResponsePayload struct {
	StatusCode int                 `json:"status_code"`
	Headers    map[string][]string `json:"headers"`
	Body       string              `json:"body"`
}

// RequestResponseRecord describes exactly one completed request. Exactly one
// of Response and Failure must be populated.
type RequestResponseRecord struct {
	CompletedAt string           `json:"completed_at"`
	PingMS      float64          `json:"ping_ms"`
	Request     RequestPayload   `json:"request"`
	Response    *ResponsePayload `json:"response,omitempty"`
	Failure     string           `json:"failure,omitempty"`
}

type TestEvent struct {
	EventID   string `json:"event_id"`
	TestID    string `json:"test_id"`
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Message   string `json:"message"`
}

type FinalSummary struct {
	TestID                string         `json:"test_id"`
	Parameters            TestParameters `json:"parameters"`
	ElapsedSeconds        float64        `json:"elapsed_seconds"`
	CompletedCount        int            `json:"completed_count"`
	FailedCount           int            `json:"failed_count"`
	AchievedThroughputRPS float64        `json:"achieved_throughput_rps"`
	P50MS                 float64        `json:"p50_ms"`
	P95MS                 float64        `json:"p95_ms"`
	P99MS                 float64        `json:"p99_ms"`
}

type MetricFrame struct {
	TestID                string                 `json:"test_id"`
	Timestamp             string                 `json:"timestamp"`
	ElapsedSeconds        float64                `json:"elapsed_seconds"`
	Done                  bool                   `json:"done"`
	Aggregate             AggregateMetrics       `json:"aggregate"`
	RequestResponseRecord *RequestResponseRecord `json:"request_response_record,omitempty"`
	Events                []TestEvent            `json:"events,omitempty"`
	FinalSummary          *FinalSummary          `json:"final_summary,omitempty"`
	Agents                []any                  `json:"agents"`
	BackendHealth         []any                  `json:"backend_health"`
}

// RequestCompletion is a worker-produced completion fact. TestRun copies it on
// submission, so later mutation by a worker cannot alter emitted frames.
type RequestCompletion struct {
	CompletedAt time.Time
	PingMS      float64
	Request     RequestPayload
	Response    *ResponsePayload
	Failure     string
}

// TestRun is owned by the test coordinator. Workers submit immutable values;
// only the coordinator calls SubmitCompletion, Frame, and Complete.
type TestRun struct {
	testID        string
	parameters    TestParameters
	startedAt     time.Time
	completions   []RequestCompletion
	completed     int
	failed        int
	latencies     []float64
	nextEventID   int
	pendingEvents []TestEvent
	terminal      *MetricFrame
}

func NewTestRun(testID string, parameters TestParameters, startedAt time.Time) *TestRun {
	run := &TestRun{
		testID:     testID,
		parameters: parameters,
		startedAt:  startedAt.UTC(),
	}
	run.queueEvent(run.startedAt, "test-started", "Test started.")
	return run
}

func (r *TestRun) queueEvent(timestamp time.Time, eventType, message string) {
	r.nextEventID++
	r.pendingEvents = append(r.pendingEvents, TestEvent{
		EventID:   fmt.Sprintf("%d", r.nextEventID),
		TestID:    r.testID,
		Timestamp: timestamp.UTC().Format(time.RFC3339Nano),
		Type:      eventType,
		Message:   message,
	})
}

// SubmitCompletion accepts one complete outcome. It rejects incomplete or
// ambiguous outcomes and stores a deep value copy of accepted input.
func (r *TestRun) SubmitCompletion(completion RequestCompletion) error {
	if completion.CompletedAt.IsZero() {
		return errors.New("request completion timestamp is required")
	}
	if math.IsNaN(completion.PingMS) || math.IsInf(completion.PingMS, 0) || completion.PingMS < 0 {
		return errors.New("request completion ping must be finite and non-negative")
	}
	if (completion.Response == nil) == (completion.Failure == "") {
		return errors.New("request completion must contain exactly one response or failure")
	}

	copy := cloneCompletion(completion)
	r.completions = append(r.completions, copy)
	r.latencies = append(r.latencies, copy.PingMS)
	if copy.Response != nil {
		r.completed++
	} else {
		r.failed++
		r.queueEvent(copy.CompletedAt, "request-failed", copy.Failure)
	}
	return nil
}

// Frame creates a value snapshot at timestamp. It includes the completion with
// the latest timestamp not later than timestamp, if one exists, and atomically
// drains any events not included in an earlier frame.
func (r *TestRun) Frame(timestamp time.Time) MetricFrame {
	return r.frameAt(timestamp, false, nil)
}

// Complete creates the single terminal snapshot. A second call returns false
// and never replaces the first terminal summary.
func (r *TestRun) Complete(completedAt time.Time) (MetricFrame, bool) {
	if r.terminal != nil {
		return MetricFrame{}, false
	}

	frameTime := completedAt.UTC()
	elapsed := r.elapsedAt(frameTime)
	aggregate := r.aggregateAt(elapsed)
	summary := &FinalSummary{
		TestID:                r.testID,
		Parameters:            r.parameters,
		ElapsedSeconds:        elapsed,
		CompletedCount:        aggregate.CompletedCount,
		FailedCount:           aggregate.FailedCount,
		AchievedThroughputRPS: aggregate.ThroughputRPS,
		P50MS:                 aggregate.P50MS,
		P95MS:                 aggregate.P95MS,
		P99MS:                 aggregate.P99MS,
	}
	r.queueEvent(frameTime, "test-completed", "Test completed.")
	frame := r.frameAt(frameTime, true, summary)
	r.terminal = cloneMetricFrame(frame)
	return frame, true
}

func (r *TestRun) frameAt(timestamp time.Time, done bool, summary *FinalSummary) MetricFrame {
	frameTime := timestamp.UTC()
	frame := MetricFrame{
		TestID:         r.testID,
		Timestamp:      frameTime.Format(time.RFC3339Nano),
		ElapsedSeconds: r.elapsedAt(frameTime),
		Done:           done,
		Aggregate:      r.aggregateAt(r.elapsedAt(frameTime)),
		Agents:         []any{},
		BackendHealth:  []any{},
	}
	if record := r.latestEligibleRecord(frameTime); record != nil {
		frame.RequestResponseRecord = record
	}
	if len(r.pendingEvents) > 0 {
		frame.Events = append([]TestEvent(nil), r.pendingEvents...)
		r.pendingEvents = nil
	}
	if summary != nil {
		copied := *summary
		frame.FinalSummary = &copied
	}
	return frame
}

func (r *TestRun) elapsedAt(timestamp time.Time) float64 {
	elapsed := timestamp.Sub(r.startedAt).Seconds()
	if elapsed <= 0 {
		return math.SmallestNonzeroFloat64
	}
	return elapsed
}

func (r *TestRun) aggregateAt(elapsed float64) AggregateMetrics {
	aggregate := AggregateMetrics{
		CompletedCount: r.completed,
		FailedCount:    r.failed,
	}
	if elapsed > 0 {
		aggregate.ThroughputRPS = float64(r.completed+r.failed) / elapsed
	}
	if len(r.latencies) == 0 {
		return aggregate
	}

	sorted := append([]float64(nil), r.latencies...)
	sort.Float64s(sorted)
	aggregate.P50MS = percentileMS(sorted, 50)
	aggregate.P95MS = percentileMS(sorted, 95)
	aggregate.P99MS = percentileMS(sorted, 99)
	return aggregate
}

func (r *TestRun) latestEligibleRecord(timestamp time.Time) *RequestResponseRecord {
	var latest *RequestCompletion
	for i := range r.completions {
		completion := &r.completions[i]
		if completion.CompletedAt.After(timestamp) {
			continue
		}
		if latest == nil || completion.CompletedAt.After(latest.CompletedAt) {
			latest = completion
		}
	}
	if latest == nil {
		return nil
	}
	return completionRecord(*latest)
}

func percentileMS(sorted []float64, percentile int) float64 {
	index := percentile * len(sorted) / 100
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func completionRecord(completion RequestCompletion) *RequestResponseRecord {
	record := &RequestResponseRecord{
		CompletedAt: completion.CompletedAt.UTC().Format(time.RFC3339Nano),
		PingMS:      completion.PingMS,
		Request:     cloneRequestPayload(completion.Request),
		Failure:     completion.Failure,
	}
	if completion.Response != nil {
		response := cloneResponsePayload(*completion.Response)
		record.Response = &response
	}
	return record
}

func cloneCompletion(completion RequestCompletion) RequestCompletion {
	copy := completion
	copy.CompletedAt = completion.CompletedAt.UTC()
	copy.Request = cloneRequestPayload(completion.Request)
	if completion.Response != nil {
		response := cloneResponsePayload(*completion.Response)
		copy.Response = &response
	}
	return copy
}

func cloneRequestPayload(payload RequestPayload) RequestPayload {
	return RequestPayload{
		Method:    payload.Method,
		TargetURL: payload.TargetURL,
		Headers:   cloneHeaders(payload.Headers),
		Body:      payload.Body,
	}
}

func cloneResponsePayload(payload ResponsePayload) ResponsePayload {
	return ResponsePayload{
		StatusCode: payload.StatusCode,
		Headers:    cloneHeaders(payload.Headers),
		Body:       payload.Body,
	}
}

func cloneHeaders(headers map[string][]string) map[string][]string {
	if headers == nil {
		return nil
	}
	copy := make(map[string][]string, len(headers))
	for name, values := range headers {
		copy[name] = append([]string(nil), values...)
	}
	return copy
}

func cloneMetricFrame(frame MetricFrame) *MetricFrame {
	copy := frame
	if frame.RequestResponseRecord != nil {
		record := *frame.RequestResponseRecord
		record.Request = cloneRequestPayload(record.Request)
		if record.Response != nil {
			response := cloneResponsePayload(*record.Response)
			record.Response = &response
		}
		copy.RequestResponseRecord = &record
	}
	if frame.FinalSummary != nil {
		summary := *frame.FinalSummary
		copy.FinalSummary = &summary
	}
	copy.Events = append([]TestEvent(nil), frame.Events...)
	copy.Agents = append([]any(nil), frame.Agents...)
	copy.BackendHealth = append([]any(nil), frame.BackendHealth...)
	return &copy
}
