package main

import (
	"context"
	"flag"
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

	// defines a timeout
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
		},
	}

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
	var resultsWg sync.WaitGroup

	results := make(chan Result, rps*int(dur.Seconds()))

	// worker goroutines
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

				latency := time.Since(start)
				fmt.Println("ping response time:", latency)

				results <- Result{latency: latency}

				resp.Body.Close()
			}
		}()
	}

	resultsWg.Add(1)

	go func() {
		defer resultsWg.Done()

		for r := range results {
			if r.err != nil {
				fmt.Println("error:", r.err)
				continue
			}

			latencies = append(latencies, float32(r.latency.Seconds()*1000))
		}
	}()

	wg.Wait()

	elapsed := time.Since(overallStart)

	close(results)
	resultsWg.Wait()

	if len(latencies) == 0 {
		fmt.Println("no successful requests")
		return
	}

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

	var sum float32

	for _, latency := range latencies {
		sum += latency
	}

	minScore := latencies[0]
	maxScore := latencies[len(latencies)-1]

	p50 := percentile(latencies, 50)
	p95 := percentile(latencies, 95)
	p99 := percentile(latencies, 99)

	throughput := float64(len(latencies)) / elapsed.Seconds()

	fmt.Println("--------------- { config } ---------------")
	fmt.Println("workers:", workers)
	fmt.Println("requested rps:", rps)
	fmt.Println("duration:", elapsed.Seconds(), "s")

	fmt.Println("--------------- { results } ---------------")
	fmt.Println("pings:", len(latencies))
	fmt.Println("throughput (rps):", throughput)
	fmt.Println("avg:", sum/float32(len(latencies)), "ms")
	fmt.Println("min:", minScore, "ms")
	fmt.Println("p50:", p50, "ms")
	fmt.Println("p95:", p95, "ms")
	fmt.Println("p99:", p99, "ms")
	fmt.Println("max:", maxScore, "ms")
}

func percentile(sorted []float32, p int) float32 {
	idx := (p * len(sorted)) / 100
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}