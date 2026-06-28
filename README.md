# Conduit

A distributed load testing platform built around a custom C++ load balancer, Go testing agents, and a Next.js web dashboard.

## Overview

Conduit is a systems project with three components:

- **Load Balancer** — a Layer 4 TCP load balancer written in C++ using raw POSIX sockets and Linux epoll
- **Load Testing Platform** — a distributed Go testing platform with a coordinator and containerized agents
- **Web Dashboard** — a Next.js dashboard for configuring tests and visualizing live performance metrics

## Current Progress

### Phase 3 Complete — C++ Load Balancer (Layer 4)

Created a Layer 4 (transport layer) TCP load balancer running on port `8080` using an linux epoll event loop and multithreading. Routes incoming traffic across multiple backend servers using the **round-robin** algorithm. Backends are defined in a YAML config file. Built with raw POSIX TCP sockets — no networking abstractions.

**Tech stack:** C++17, POSIX sockets, yaml-cpp, CMake, Docker

### Benchmarking

Load balancer performance has been measured using ApacheBench across varying concurrency levels. All tests run against the epoll event loop (Phase 3) with round-robin routing across 3 nginx backends.

Phase 4 work (multithreading and other optimizations) in progress. 

**Test commands**

```bash
ab -n 100 -c 1 http://localhost:8080/ 
ab -n 100 -c 10 http://localhost:8080/ 
ab -n 500 -c 50 http://localhost:8080/ 
ab -n 1000 -c 100 http://localhost:8080/ 
ab -n 1000 -c 200 http://localhost:8080/ 
```

Raw results are saved in `results`.

### Known Load Balancer Improvements
 
Current limitations to be addressed in later phases:
 
- **Blocking `connect()`** — a slow backend parks a worker thread, exhausting the pool under load. Fix: `O_NONBLOCK` + `EINPROGRESS` handling
- **Global mutex** — all threads contend on one lock per read/write. Fix: per-thread epoll instances eliminate sharing entirely
- **Unchecked `write()`** — short writes silently drop bytes. Fix: loop until all bytes sent or buffer partial writes
- **Single `accept()` per wakeup** — leaves connections queued under bursts. Fix: loop until `EAGAIN`
- **No health checking** — failed backends still receive traffic. Fix: background prober thread (Phase 5)
- **Round-robin only** — no awareness of backend load. Fix: least-connections and weighted routing (Phase 6)

## Getting Started

### Prerequisites

- Docker Desktop with WSL2 integration enabled
- CMake 3.16+
- A C++17 compiler (`build-essential` on Ubuntu/WSL)
- yaml-cpp (`sudo apt install libyaml-cpp-dev`)

### 1. Start the backend servers

```bash
cd docker
docker-compose up
```

This spins up 3 nginx alpine instances on ports `9001`, `9002`, and `9003`.

### 2. Build and run the load balancer

```bash
cmake -B build
cmake --build build
./build/conduit
```

The load balancer will start listening on port `8080`.

### 3. Send traffic

```bash
curl  http://localhost:8080
```

Each request will be routed to the next backend in rotation. The response will contain the backend's HTML content confirming which server was hit.

## Project Structure

```
conduit/
├── load-balancer/          # C++ load balancer
│   ├── src/
│   ├── include/
│   ├── tests/
│   └── CMakeLists.txt
├── load-tester/            # Go distributed testing platform
│   ├── coordinator/
│   ├── agent/
│   └── proto/
├── dashboard/              # Next.js web dashboard
│   ├── app/
│   └── components/
├── docker/                 # Docker Compose and Dockerfiles
├── dummy-backends/               # nginx static HTML files
├── results/                # Benchmark results and analysis
└── README.md
```

## Roadmap

- [x] Phase 1 — Basic TCP proxy (single backend)
- [x] Phase 2 — Round-robin routing across multiple backends
- [x] Phase 3 — epoll event loop (non-blocking I/O)
- [ ] Phase 4 — Thread pool (concurrent connection handling)
- [ ] Phase 5 — Health checking and automatic failover
- [ ] Phase 6 — Additional routing algorithms (least-connections, weighted)
- [ ] Phase 7 — Go load testing agent
- [ ] Phase 8 — Coordinator and gRPC metric aggregation
- [ ] Phase 9 — Next.js dashboard with live WebSocket metrics
- [ ] Phase 10 — Benchmarking and results
