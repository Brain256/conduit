package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/google/uuid"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // dev only
}

func startTestHandler(w http.ResponseWriter, r *http.Request) {
	go runTest()
	testID := uuid.New().String()
	json.NewEncoder(w).Encode(map[string]string{"test_id": testID})
}

func streamHandler(w http.ResponseWriter, r *http.Request) {
	testID := r.PathValue("id")
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	defer conn.Close()

	for i := 0; i < 20; i++ {
		frame := map[string]interface{}{
			"test_id":         testID,
			"timestamp":       time.Now().Format(time.RFC3339),
			"elapsed_seconds": float64(i),
			"done":            i == 19,
			"aggregate": map[string]interface{}{
				"throughput_rps": 4000 + rand.Intn(1000),
				"p50_ms":         3.0 + rand.Float64(),
				"p95_ms":         10.0 + rand.Float64()*5,
				"p99_ms":         25.0 + rand.Float64()*10,
				"error_count":    0,
			},
			"agents":         []interface{}{},
			"backend_health": []interface{}{},
			"events":         []interface{}{},
		}
		if err := conn.WriteJSON(frame); err != nil {
			return
		}
		time.Sleep(1 * time.Second)
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