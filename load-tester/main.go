package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type TestRequest struct {
	Port     int    `json:"port"`
	Duration int    `json:"dur"`
	Rps      int    `json:"rps"`
	Workers  int    `json:"workers"`
	Mode     string `json:"mode"`
}

// testParameters validates a start request and resolves it to the immutable
// parameters a run executes with. Mode defaults to closed so existing clients
// keep working. Closed mode requires a positive rate because it divides by it
// to size the pacer interval; open mode ignores the rate entirely.
func testParameters(request TestRequest) (TestParameters, error) {
	mode := LoadMode(strings.TrimSpace(strings.ToLower(request.Mode)))
	if mode == "" {
		mode = LoadModeClosed
	}
	if mode != LoadModeClosed && mode != LoadModeOpen {
		return TestParameters{}, fmt.Errorf("mode must be %q or %q", LoadModeClosed, LoadModeOpen)
	}
	if request.Port < 1 || request.Port > 65535 {
		return TestParameters{}, errors.New("port must be between 1 and 65535")
	}
	if request.Duration < 1 {
		return TestParameters{}, errors.New("dur must be at least 1 second")
	}
	if request.Workers < 1 {
		return TestParameters{}, errors.New("workers must be at least 1")
	}

	rate := 0
	if mode == LoadModeClosed {
		if request.Rps < 1 {
			return TestParameters{}, errors.New("rps must be at least 1 in closed mode")
		}
		rate = request.Rps
	}

	return TestParameters{
		Port:            request.Port,
		DurationSeconds: request.Duration,
		TargetRPS:       rate,
		Workers:         request.Workers,
		LoadMode:        mode,
	}, nil
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // dev only
}

// sessions maps a test_id to the channel of live frames produced by runTest,
// letting the stream handler attach to a test started by the start handler.
var (
	sessions   = make(map[string]chan MetricFrame)
	sessionsMu sync.Mutex
)

func addSession(id string, frames chan MetricFrame) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	sessions[id] = frames
}

func takeSession(id string) (chan MetricFrame, bool) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	frames, ok := sessions[id]
	delete(sessions, id)
	return frames, ok
}

func startTestHandler(w http.ResponseWriter, r *http.Request) {
	var reqData TestRequest
	if err := json.NewDecoder(r.Body).Decode(&reqData); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	parameters, err := testParameters(reqData)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	testID := uuid.New().String()
	frames := make(chan MetricFrame, 64)
	run := NewTestRun(testID, parameters, time.Now().UTC())
	addSession(testID, frames)

	go runTest(run, frames)

	json.NewEncoder(w).Encode(map[string]string{"test_id": testID})
}

func streamHandler(w http.ResponseWriter, r *http.Request) {
	testID := r.PathValue("id")
	frames, ok := takeSession(testID)
	if !ok {
		http.Error(w, "unknown test id", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	defer conn.Close()

	for frame := range frames {
		if err := conn.WriteJSON(frame); err != nil {
			return
		}
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*") // dev only
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /test/start", startTestHandler)
	mux.HandleFunc("GET /test/{id}/stream", streamHandler)
	log.Println("listening on :8081")
	log.Fatal(http.ListenAndServe(":8081", corsMiddleware(mux)))
}
