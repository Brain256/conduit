package main 

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Result struct {
	latency time.Duration
	err     error
}

func main() {
	
	port := flag.Int("port", 8080, "Port of the load balancer")
	duration := flag.Duration("duration", 30*time.Second, "how long to run the test")
	reqPerSecond := flag.Int("rps", 100, "Number of requests per second")
	numWorkers := flag.Int("workers", 10, "Number of workers sending requests")

	flag.Parse()

	var latencies []float32

	dur := *duration
	rps := *reqPerSecond
	workers := *numWorkers
	url := fmt.Sprintf("http://localhost:%d", *port)

	tokens := make(chan struct{}, rps)
	interval := time.Second / time.Duration(rps)

	overallStart := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), dur)
	defer cancel()

	// goroutine for rate limiting
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

	var wg sync.WaitGroup

	// eventually needs a separate goroutine to drain this or else it could cause the script to block
	results := make(chan Result, rps * int(dur.Seconds()))

	// worker goroutines 
	for i := 0; i < workers; i++ {

		wg.Add(1)
		
		go func() {
			defer wg.Done()

			for range tokens {
				start := time.Now()
				resp, err := http.Get(url)

				if err != nil { 
					results <- Result{err: err}
					continue
				}

				latency := time.Since(start)
				fmt.Println("ping response time:", latency)

				results <- Result{latency: latency}

				resp.Body.Close()
			}
		} ()
	}

	wg.Wait()

	elapsed := time.Since(overallStart)

	close(results)

	for r := range results {
		if r.err != nil {
			fmt.Println("error:", r.err)
			continue
		}

		latencies = append(latencies, float32(r.latency.Seconds() * 1000))
	}

	var sum float32

	if len(latencies) == 0 {
		fmt.Println("no successful requests")
		return
	}

	minScore := latencies[0]
	maxScore := latencies[0]

	for i := 0; i < len(latencies); i++ {
		sum += latencies[i]

		if latencies[i] < minScore {
			minScore = latencies[i]
		}

		if latencies[i] > maxScore {
			maxScore = latencies[i]
		}
	}

	fmt.Println("--------------- { config } ---------------")
	fmt.Println("workers:", workers)
	fmt.Println("rps:", rps)
	fmt.Println("duration:", elapsed.Seconds(), "s")

	fmt.Println("--------------- { results } ---------------")
	fmt.Println("pings:", len(latencies))
	fmt.Println("avg:", sum / float32(len(latencies)), "ms")
	fmt.Println("max:", maxScore, "ms")
	fmt.Println("min:", minScore, "ms")
	
}