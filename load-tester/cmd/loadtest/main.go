package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
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
	reqPerSecond := flag.Int("rps", 100, "Number of requests per second (closed mode only)")
	numWorkers := flag.Int("workers", 10, "Number of workers sending requests")
	mode := flag.String("mode", "closed", "closed: hold a target rate of -rps. open: send as fast as -workers allows, to find max throughput")
	verbose := flag.Bool("verbose", false, "print every request; distorts timings at high rates")

	flag.Parse()

	if *mode != "closed" && *mode != "open" {
		fmt.Println("mode must be 'closed' or 'open'")
		os.Exit(2)
	}

	var latencies []float32

	dur := *duration
	rps := *reqPerSecond
	workers := *numWorkers

	// 127.0.0.1, not localhost: the balancer binds IPv4 only, so a dual-stack
	// resolver tries ::1 first and burns a failed connect on every request.
	url := fmt.Sprintf("http://127.0.0.1:%d", *port)

	tokens := make(chan struct{}, rps)
	interval := time.Second / time.Duration(rps)

	overallStart := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), dur)
	defer cancel()

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
		},
	}

	// goroutine for rate limiting.
	//
	// Closed mode only. The ticker makes -rps a ceiling, so achieved throughput
	// can never exceed the number you asked for -- it answers "did it keep up",
	// not "what is the maximum". Open mode drops the ticker so that workers run
	// flat out and max RPS falls out as workers/mean-latency.
	if *mode == "closed" {
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

	var wg sync.WaitGroup
	var resultsWg sync.WaitGroup

	buffered := rps * int(dur.Seconds())
	if *mode == "open" || buffered < 4096 {
		buffered = 4096
	}
	results := make(chan Result, buffered)

	sendOne := func() {
		start := time.Now()
		resp, err := client.Get(url)

		if err != nil {
			results <- Result{err: err}
			return
		}

		if _, bodyErr := io.Copy(io.Discard, resp.Body); bodyErr != nil {
			resp.Body.Close()
			results <- Result{err: bodyErr}
			return
		}
		if closeErr := resp.Body.Close(); closeErr != nil {
			results <- Result{err: closeErr}
			return
		}

		latency := time.Since(start)
		if *verbose {
			fmt.Println("ping response time:", latency)
		}

		results <- Result{latency: latency}
	}

	// worker goroutines
	for i := 0; i < workers; i++ {

		wg.Add(1)

		go func() {
			defer wg.Done()

			if *mode == "open" {
				for ctx.Err() == nil {
					sendOne()
				}
				return
			}

			for range tokens {
				sendOne()
			}
		}()
	}

	var totalPings int
	var errorCount int
	var lastErr error

	resultsWg.Add(1)

	go func() {
		defer resultsWg.Done()

		for r := range results {
			totalPings++

			if r.err != nil {
				errorCount++
				if *verbose {
					fmt.Println("error:", r.err)
				}
				lastErr = r.err
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
		fmt.Println("no successful requests out of", totalPings, "attempts")
		if lastErr != nil {
			fmt.Println("last error:", lastErr)
		}
		os.Exit(1)
	}

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })

	var sum float32
	for _, l := range latencies {
		sum += l
	}

	minScore := latencies[0]
	maxScore := latencies[len(latencies)-1]

	p50 := percentile(latencies, 50)
	p95 := percentile(latencies, 95)
	p99 := percentile(latencies, 99)

	achievedRPS := float64(len(latencies)) / elapsed.Seconds()

	fmt.Println("--------------- { config } ---------------")
	fmt.Println("mode:", *mode)
	fmt.Println("target:", url)
	fmt.Println("workers:", workers)
	if *mode == "closed" {
		fmt.Println("requested rps:", rps)
	}
	fmt.Println("duration:", elapsed.Seconds(), "s")

	successRate := float64(len(latencies)) / float64(totalPings) * 100

	fmt.Println("--------------- { results } ---------------")
	fmt.Println("successful pings:", len(latencies), "/", totalPings)
	fmt.Println("success rate:", successRate)
	fmt.Println("failed:", errorCount)
	if lastErr != nil {
		fmt.Println("last error:", lastErr)
	}
	fmt.Println("throughput (rps):", achievedRPS)
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
