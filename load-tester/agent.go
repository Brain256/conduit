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
	targetURL := fmt.Sprintf("http://localhost:%d", parameters.Port)

	tokens := make(chan struct{}, parameters.TargetRPS)
	interval := time.Second / time.Duration(parameters.TargetRPS)
	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
		},
	}

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

	completions := make(chan RequestCompletion, parameters.TargetRPS)
	var workers sync.WaitGroup
	for i := 0; i < parameters.Workers; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range tokens {
				completions <- executeRequestAttempt(client, ctx, targetURL)
			}
		}()
	}
	go func() {
		workers.Wait()
		close(completions)
	}()

	ticker := time.NewTicker(time.Second)
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
