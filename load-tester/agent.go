package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// executeRequestAttempt captures one complete HTTP request outcome for the
// coordinator. It always returns either a response payload or a non-empty
// failure description, and closes any response body before returning.
func executeRequestAttempt(client *http.Client, ctx context.Context, targetURL string) RequestCompletion {
	startedAt := time.Now()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return failedCompletion(startedAt, RequestPayload{
			Method:    http.MethodGet,
			TargetURL: targetURL,
			Headers:   map[string][]string{},
		}, err)
	}

	requestPayload := RequestPayload{
		Method:    request.Method,
		TargetURL: request.URL.String(),
		Headers:   cloneHeaders(request.Header),
		Body:      "",
	}
	response, err := client.Do(request)
	if err != nil {
		return failedCompletion(startedAt, requestPayload, err)
	}

	body, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		return failedCompletion(startedAt, requestPayload, fmt.Errorf("read HTTP response body: %w", readErr))
	}
	if closeErr != nil {
		return failedCompletion(startedAt, requestPayload, fmt.Errorf("close HTTP response body: %w", closeErr))
	}

	completedAt := time.Now().UTC()
	return RequestCompletion{
		CompletedAt: completedAt,
		PingMS:      time.Since(startedAt).Seconds() * 1000,
		Request:     requestPayload,
		Response: &ResponsePayload{
			StatusCode: response.StatusCode,
			Headers:    cloneHeaders(response.Header),
			Body:       string(body),
		},
	}
}

func failedCompletion(startedAt time.Time, request RequestPayload, err error) RequestCompletion {
	failure := "HTTP request failed"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		failure = err.Error()
	}
	completedAt := time.Now().UTC()
	return RequestCompletion{
		CompletedAt: completedAt,
		PingMS:      time.Since(startedAt).Seconds() * 1000,
		Request:     request,
		Failure:     failure,
	}
}

// runTest drives the load test and emits TestRun snapshots once per second.
// It emits the sole terminal snapshot only after all workers have drained, then
// closes out so the stream handler's range loop preserves its existing lifecycle.
func runTest(run *TestRun, out chan<- MetricFrame) {
	defer close(out)

	parameters := run.parameters
	duration := time.Duration(parameters.DurationSeconds) * time.Second
	// 127.0.0.1, not localhost: the balancer binds IPv4 only, so a dual-stack
	// resolver tries ::1 first and burns a failed connect on every request. With
	// keep-alives disabled that cost is paid per request and lands in PingMS.
	targetURL := fmt.Sprintf("http://127.0.0.1:%d", parameters.Port)

	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
		},
	}

	// Closed mode paces work through a token bucket, making TargetRPS a
	// ceiling. Open mode has no pacer at all: workers loop flat out so the
	// achieved rate reveals the maximum rather than the requested rate.
	var tokens chan struct{}
	if parameters.LoadMode != LoadModeOpen {
		tokens = make(chan struct{}, parameters.TargetRPS)
		interval := time.Second / time.Duration(parameters.TargetRPS)

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
	}

	buffer := parameters.TargetRPS
	if buffer < 1024 {
		buffer = 1024
	}
	completions := make(chan RequestCompletion, buffer)

	// A request still in flight when the test window closes was cut off by the
	// deadline, not by the target, so it is dropped rather than counted as a
	// target failure. Otherwise every run would end with up to one phantom
	// failure per worker.
	submit := func(completion RequestCompletion) {
		if completion.Failure != "" && ctx.Err() != nil {
			return
		}
		completions <- completion
	}

	var workers sync.WaitGroup
	for i := 0; i < parameters.Workers; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if parameters.LoadMode == LoadModeOpen {
				for ctx.Err() == nil {
					submit(executeRequestAttempt(client, ctx, targetURL))
				}
				return
			}
			for range tokens {
				submit(executeRequestAttempt(client, ctx, targetURL))
			}
		}()
	}
	go func() {
		workers.Wait()
		close(completions)
	}()

	ticker := time.NewTicker(time.Second / 10)
	defer ticker.Stop()
	for {
		select {
		case completion, ok := <-completions:
			if !ok {
				if terminal, emitted := run.Complete(time.Now().UTC()); emitted {
					out <- terminal
				}
				return
			}
			_ = run.SubmitCompletion(completion)
		case <-ticker.C:
			out <- run.Frame(time.Now().UTC())
		}
	}
}
