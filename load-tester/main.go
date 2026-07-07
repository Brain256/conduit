package main 

import (
	"flag"
	"fmt"
	"log"
//	"io"
	"net/http"
	"time"
)

func main() {

	port := flag.Int("port", 8080, "Port of the load balancer")
	req := flag.Int("req", 100, "Number of requests sent to the load balancer")

	flag.Parse()

	var latencies []float32
	length := *req

	url := fmt.Sprintf("http://localhost:%d", *port)

	for i := 0; i < length; i++ {

		start := time.Now()
		resp, err := http.Get(url)

		if err != nil { log.Fatal(err) }

		//bodyBytes, err := io.ReadAll(resp.Body)

		//if err != nil { log.Fatal(err) }

		//content := string(bodyBytes)

		//fmt.Println("content:", content)
		latency := time.Since(start)
		fmt.Println("ping response time:", latency)

		latencies = append(latencies, float32(latency.Seconds() * 1000))

		resp.Body.Close()
	}

	var sum float32
	minScore := latencies[0]
	maxScore := latencies[0]

	for i := 0; i < length; i++ {
		sum += latencies[i]

		if latencies[i] < minScore {
			minScore = latencies[i]
		}

		if latencies[i] > maxScore {
			maxScore = latencies[i]
		}
	}

	fmt.Println("-----------------------------------------")
	fmt.Println("pings:", length)
	fmt.Println("avg:", sum / float32(length), "ms")
	fmt.Println("max:", maxScore, "ms")
	fmt.Println("min:", minScore, "ms")
	
}