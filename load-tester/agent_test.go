package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

type trackingBody struct {
	io.Reader
	closed *bool
}

func (body trackingBody) Close() error {
	*body.closed = true
	return nil
}

func TestExecuteRequestAttemptCapturesCompleteOutcomes(t *testing.T) {
	closed := false
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.String() != "http://target.test/health" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL)
		}
		return &http.Response{StatusCode: http.StatusCreated, Header: http.Header{"X-Result": {"ok"}}, Body: trackingBody{Reader: strings.NewReader("response body"), closed: &closed}}, nil
	})}

	success := executeRequestAttempt(client, context.Background(), "http://target.test/health")
	if success.Response == nil || success.Failure != "" || success.Response.Body != "response body" || !closed || success.CompletedAt.Location() != time.UTC || success.PingMS < 0 {
		t.Fatalf("incomplete successful outcome: %#v, body closed: %t", success, closed)
	}

	failure := executeRequestAttempt(&http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("target unavailable")
	})}, context.Background(), "http://target.test/health")
	if failure.Response != nil || failure.Failure == "" || failure.CompletedAt.Location() != time.UTC || failure.PingMS < 0 {
		t.Fatalf("incomplete failed outcome: %#v", failure)
	}
}
