Phase 1 — Basic TCP Proxy (Week 1)
The goal here is the simplest possible thing that works: accept a TCP connection and forward it to a single backend. No load balancing yet, no thread pool, no epoll. Just get bytes flowing end to end.
Client → Load Balancer → Single Backend
What you build:
main.cpp reads a hardcoded backend address and port
Simple blocking accept() loop — one connection at a time
For each connection, open a socket to the backend and forward bytes in both directions
Test it manually with curl and netcat
Why start here: you'll hit real issues immediately — how do you forward data in both directions simultaneously, what happens when one side closes the connection, how do you handle partial reads. Better to solve these on a simple blocking server before adding epoll complexity on top.

Phase 2 — Multiple Backends + Round Robin (Week 1-2)
Now introduce multiple backends and the simplest routing algorithm.
What you build:
config.yaml with a list of backend addresses
config.cpp to parse it (use the yaml-cpp library)
router.cpp with a round-robin implementation — an atomic counter mod N backends
Each incoming connection picks the next backend in rotation
Test it:
Start 3 nginx instances on ports 9001, 9002, 9003
Each nginx serves a different static page ("Backend 1", "Backend 2", "Backend 3")
Hit your load balancer repeatedly and confirm responses rotate between backends
This is your first meaningful milestone — a real load balancer in ~200 lines.

Phase 3 — epoll Event Loop (Week 2)
Replace the blocking accept loop with a non-blocking epoll event loop. This is the hardest conceptual leap in the whole project — give it the most time.
What you build:
server.cpp with an epoll instance managing all file descriptors
Non-blocking sockets (O_NONBLOCK)
Event loop that handles EPOLLIN events for new connections and data
Edge-triggered vs level-triggered mode — understand the difference before choosing
Key things you'll hit:
EAGAIN/EWOULDBLOCK — what to do when a read returns these
Partial reads and writes — TCP is a stream, one read() call doesn't necessarily get a full request
Managing state per connection — you need to know which backend each client connection is paired with
This phase will probably take longer than you expect. That's normal — epoll is where most people get stuck. Use the Linux man pages heavily here, they're actually good.

Phase 4 — Thread Pool (Week 2-3)
Add a thread pool so connection handling happens off the main epoll thread.
What you build:
thread_pool.cpp with a fixed number of worker threads
A task queue protected by a mutex and condition variable
Main epoll thread accepts connections and posts tasks to the queue
Worker threads pick up tasks and handle the actual data forwarding
Key things you'll hit:
Mutex contention on the task queue under high load
How many threads to use — start with std::thread::hardware_concurrency()
What happens when all workers are busy — queue backpressure
Test it: try to overwhelm it with many simultaneous connections using ab (Apache Benchmark) or just a simple Python script opening hundreds of sockets.

Phase 5 — Health Checking (Week 3)
Add a background thread that periodically probes backends and marks them up or down.
What you build:
health_checker.cpp running on its own thread
Every 500ms, open a TCP connection to each backend — if it succeeds the backend is healthy
A shared data structure (protected by mutex or std::atomic) storing each backend's health status
router.cpp updated to skip unhealthy backends when routing
Test it:
Start a test, kill one of the nginx backends mid-run
Confirm your load balancer stops routing to it
Measure how long detection takes — this becomes a key metric

Phase 6 — Additional Routing Algorithms (Week 3-4)
Add least-connections and weighted routing alongside round-robin.
What you build:
router.cpp refactored to support multiple algorithms via a strategy pattern or simple enum switch
Least-connections: track active connection count per backend, route to the lowest
Weighted: backends get a weight in config, traffic distributed proportionally
Make the algorithm selectable via config.yaml:
yaml
algorithm: least-connections
This is where your project starts demonstrating real systems thinking — you can now benchmark all three algorithms against each other and show which one performs better under different load patterns.

Phase 7 — Go Agent (Week 4)
Build a single load testing agent in Go before worrying about distribution.
What you build:
agent/worker.go — spawns N goroutines each opening a TCP connection, sending an HTTP request, recording latency, closing
Runs for a specified duration at a specified RPS
Prints p50/p95/p99 latency and total throughput at the end
Test it against your load balancer directly:
go run agent/main.go --target localhost:8080 --rps 1000 --duration 30s
Get this working and producing real numbers before touching the coordinator or gRPC.

Phase 8 — Coordinator + gRPC (Week 4-5)
Now make it distributed.
What you build:
proto/metrics.proto — define the gRPC messages for coordinator ↔ agent communication
coordinator/orchestrator.go — spins up agent Docker containers, sends each one its share of the target RPS
coordinator/aggregator.go — receives metric streams from all agents, merges them into combined percentiles
coordinator/main.go — exposes a REST API to trigger tests and a WebSocket to stream live metrics
Key thing to get right: merging latency percentiles from multiple agents isn't just averaging them. You need to either collect all raw samples or use a histogram merging approach (look up HdrHistogram for Go — it handles this correctly).

Phase 9 — Next.js Dashboard (Week 5-6)
Build the web app now that you have real metrics to display.
What you build:
TestConfig.tsx — form to configure and trigger a test via REST API
websocket.ts — connects to coordinator WebSocket, receives metric updates
LiveChart.tsx — Recharts line graph updating in real time with p50/p95/p99 and throughput
BackendHealth.tsx — green/red indicators updating when health status changes
EventTimeline.tsx — log of notable events with timestamps
FinalReport.tsx — summary that appears when test completes

Phase 10 — Polish + Benchmarking (Week 6)
This phase is what separates a good project from a great one.
What you do:
Run structured benchmarks — test each routing algorithm at 1k, 5k, 10k, 20k req/s
Kill backends mid-test and record failover detection times
Document everything in results/ with real numbers
Write a compelling README with architecture diagram, setup instructions, and key findings
Record a short GIF or video of the dashboard during a live test for the README
The README is what recruiters actually read. Spend real time on it. Lead with what the project does and what you measured, not how you built it.

Summary Timeline
Phase
What
Week
1
Basic TCP proxy
1
2
Multiple backends + round robin
1-2
3
epoll event loop
2
4
Thread pool
2-3
5
Health checking
3
6
Additional routing algorithms
3-4
7
Go agent
4
8
Coordinator + gRPC
4-5
9
Next.js dashboard
5-6
10
Polish + benchmarking
6


