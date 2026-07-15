package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type TestRequest struct {
	Port     int `json:"port"`
	Duration int `json:"dur"`
	Rps      int `json:"rps"`
	Workers  int `json:"workers"`
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

	testID := uuid.New().String()
	frames := make(chan MetricFrame, 64)
	addSession(testID, frames)

	go runTest(testID, reqData.Port, reqData.Duration, reqData.Rps, reqData.Workers, frames)

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
