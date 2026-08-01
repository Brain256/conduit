# Conduit

**A Layer 4 TCP load balancer written from scratch in C++, with a Go load-testing CLI that
drives traffic through it and reports latency percentiles and achieved throughput.**

![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C?logo=cplusplus&logoColor=white)
![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

No networking libraries and no load-testing frameworks — raw POSIX sockets and an `epoll`
event loop underneath, a hand-rolled metrics pipeline on top.

---

## Project status

The **load balancer** and the **CLI load tester** are the working, supported path. Run the
balancer, point the CLI at it, read the percentile table. That's the loop this repo is built
around today.

The **React dashboard** are a work in progress. The code for the go agent with websockets streaming is in `load-tester/` (root package) and a React client in `dashboard/` 

---

## Architecture

```mermaid
flowchart LR
    subgraph go["Go CLI"]
        T["load tester<br/>cmd/loadtest"]
    end

    subgraph cpp["C++ service"]
        LB["Load balancer<br/>epoll + thread pool<br/>:8080"]
    end

    subgraph backends["nginx backends"]
        B1[":9001"]
        B2[":9002"]
        B3[":9003"]
    end

    T -->|"HTTP GET x N workers"| LB
    LB -->|round-robin| B1
    LB --> B2
    LB --> B3
```

**Load balancer** (`load-balancer/`) — a Layer 4 TCP proxy built on raw POSIX sockets. A
non-blocking listener feeds an `epoll` event loop, which dispatches connection setup and
byte forwarding onto a thread pool sized to `std::thread::hardware_concurrency()`. Each
accepted client is paired with a backend chosen round-robin from a YAML config, and both
file descriptors are registered with the same event loop. No `libevent`, no framework.

**Load tester CLI** (`load-tester/cmd/loadtest/`) — a single-file Go program with two load
models, selected by `-mode`. In **closed** mode a ticker goroutine fills a token bucket at the
requested RPS and N worker goroutines pull tokens; when the context deadline expires the token
producer closes the channel, workers drain and exit. In **open** mode there is no ticker — each
worker loops flat out until the context deadline. Either way, workers push outcomes onto a
results channel that one collector goroutine drains, and the collector's samples are sorted for
the percentile report.

---

## Quick start

> The load balancer uses Linux `epoll`, so it must be built and run on Linux or WSL2. The Go
> CLI runs anywhere.

**Prerequisites:** Docker (with WSL2 integration on Windows), CMake 3.16+, a C++17 compiler,
`yaml-cpp` (`sudo apt install libyaml-cpp-dev`), Go 1.22+.

### 1. Start the backend servers

```bash
cd docker
docker-compose up
```

Three `nginx:alpine` containers on ports `9001`, `9002`, and `9003`, each serving a distinct
page from `dummy-backends/` so you can see which backend answered.

### 2. Build and run the load balancer

```bash
cd load-balancer
cp config.example.yaml config.yaml
cmake -B build && cmake --build build
./build/conduit
```

Listens on `8080` and round-robins across the backends listed in `config.yaml`.

### 3. Run the load tester

```bash
cd load-tester
go run ./cmd/loadtest -port 8080 -rps 500 -workers 20 -duration 30s   # closed: hold 500 rps
go run ./cmd/loadtest -port 8080 -mode open -workers 50 -duration 30s # open: find max throughput
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `-port` | `8080` | Port on `127.0.0.1` to target |
| `-mode` | `closed` | `closed` holds a target rate of `-rps`; `open` sends flat out to find max throughput |
| `-rps` | `100` | Requested requests per second (closed mode only) |
| `-workers` | `10` | Concurrent worker goroutines |
| `-duration` | `30s` | How long to run (any Go duration string) |
| `-verbose` | `false` | Print every request. Distorts timings at high rates — the stdout I/O contends with the workers doing the measuring. |

The two modes answer different questions. **Closed** mode paces requests with a ticker, so
`-rps` is a ceiling and the result tells you whether the target kept up with the rate you
asked for. **Open** mode drops the ticker and lets each worker loop as fast as it can, so
throughput becomes `workers / mean-latency` — sweep `-workers` to find where it stops
improving. Quote throughput numbers from open mode only; closed mode structurally cannot
report more than you asked for.

Output (shape only — numbers are illustrative, not a measured result):

```
--------------- { config } ---------------
mode: closed
target: http://127.0.0.1:8080
workers: 20
requested rps: 500
duration: 30.002 s
--------------- { results } ---------------
successful pings: 14998 / 15000
success rate: 99.98666
failed: 2
throughput (rps): 499.9
avg: 2.13 ms
min: 0.71 ms
p50: 1.8 ms
p95: 7.4 ms
p99: 19.2 ms
max: 84.3 ms
```

In closed mode, requested RPS is a ceiling, not a guarantee. If workers can't keep up, the token bucket drops
tokens rather than queueing them, so achieved throughput falls below the request while
latency stays honest.

---

## Project structure

```
conduit/
├── load-balancer/          # C++17 L4 TCP load balancer
│   ├── src/main.cpp        # epoll event loop, round-robin, YAML config
│   ├── src/thread_pool.cpp
│   ├── include/thread_pool.hpp
│   ├── config.example.yaml
│   └── CMakeLists.txt
├── load-tester/            # Go module
│   ├── cmd/loadtest/       # CLI load tester  ← the supported entry point
│   │   └── main.go
│   ├── main.go             # parked: REST + WebSocket handlers, session map
│   ├── agent.go            # parked: worker pool, rate limiting, frame emission
│   ├── test_run.go         # parked: wire types + single-owner TestRun reducer
│   └── agent_test.go
├── dashboard/              # parked: React + TypeScript + Vite client
├── docker/                 # docker-compose for the nginx backend fleet
├── dummy-backends/         # static HTML served by each backend
└── results/                # raw ApacheBench output
```

Two `main` packages live in one module: `load-tester/` (the parked service) and
`load-tester/cmd/loadtest/` (the CLI). `go run .` starts the service; `go run ./cmd/loadtest`
runs the CLI. `go build ./...` builds both.

---

## Benchmarking

The load balancer has been benchmarked with ApacheBench across concurrency levels from 1 to
1000 against the three-backend nginx fleet:

```bash
ab -n 10000 -c <N> http://localhost:8080/
```

Raw output lives in `results/`. **These runs predate the current build**, so treat the
numbers as historical rather than a current performance claim — re-benchmarking against the
present load balancer is on the roadmap.

---

## Known limitations

Deliberate scope cuts and known weak points, kept here rather than hidden:

**Load balancer**

- **Connection lifetime is not thread-safe.** `EPOLLONESHOT` serializes events per *fd*, but
  a client and its backend are two separate epoll registrations, so both can be in flight at
  once. Thread A can be inside `read()`/`write()` on a fd while thread B takes the teardown
  branch and closes *both* fds (`src/main.cpp:97-98`) — and since `accept()` reuses fd numbers
  immediately, A may then write one connection's bytes into another's socket. This is the most
  serious known bug. Fix: make the connection, not the fd, the unit of ownership — refcount it
  and store `Conn*` in `epoll_event.data.ptr`, or shard per-thread (below), which removes the
  sharing altogether.
- **Blocking `connect()`** — a slow backend parks a worker thread and can exhaust the pool
  under load. Measurement suggests this, not userspace CPU, is the current throughput ceiling.
  Fix: `O_NONBLOCK` plus `EINPROGRESS` handling.
- **Blocking `write()` with no backpressure** — a peer with a full socket buffer blocks a pool
  worker; enough slow peers wedge every worker. There are no per-connection output buffers and
  `EPOLLOUT` is never used. Fix: output buffers plus `EPOLLOUT`, and stop reading from the
  opposite endpoint when the buffer is full.
- **Dropped writes** — the write loop handles short writes but silently discards the remainder
  on error (`src/main.cpp:119-121`). Harmless today only because the sockets are blocking; it
  becomes silent truncation the moment they aren't.
- **Global mutex** — all threads contend on one lock per read/write. Fix: per-thread `epoll`
  instances with `SO_REUSEPORT`, eliminating the sharing entirely.
- **One `read()` per wakeup** — 4 KiB per epoll round-trip, level-triggered with a re-arm each
  time, so a large response costs one wakeup + one task + one `epoll_ctl` per 4 KiB. Fix:
  edge-triggered plus a drain loop.
- **No health checking** — failed backends still receive traffic, and with a blocking
  `connect()` each attempt ties up a worker until it times out.
- **Round-robin only** — no awareness of backend load.
- **Hostnames are not resolved** — `inet_pton` (`src/main.cpp:152`) parses dotted-quad only and
  its return is unchecked, so a hostname or typo'd IP silently leaves the address as `0.0.0.0`,
  which Linux then treats as loopback. Fix: `getaddrinfo`, and check the result.

**Load tester CLI**

- Sends `GET` to the root path on `127.0.0.1` only; no method, path, header, or body
  configuration.
- Keep-alives are disabled, so every request opens a fresh TCP connection. This measures
  connection setup as well as service time — intentional for exercising the load balancer,
  but not representative of a keep-alive client.
- Latency is measured to response headers, not to a fully-read body; response bodies are
  closed without being read.
- Percentiles are computed over the whole run including warm-up, so startup transients stay in
  the p99 permanently.

---

## streaming dashboard (work in progress, ui needs improvement)

A React and Typescript that wraps the load tester in an HTTP + WebSocket service and streamed
`MetricFrame`s to a React dashboard with live charts, a packet inspector, an event timeline,
and SVG export. All of it is still in the tree and still builds.

To run it anyway: `cd load-tester && go run .` (listens on `:8081`), then
`cd dashboard && npm install && npm run dev`.

---

## Roadmap

- [x] Basic TCP proxy (single backend)
- [x] Round-robin routing across multiple backends
- [x] `epoll` event loop with non-blocking I/O
- [x] Thread pool for concurrent connection handling
- [x] Go load-testing CLI with percentile reporting
- [ ] Re-benchmark the current build and publish results
- [ ] **Non-blocking `connect()` and I/O** — measurement points here as the real ceiling:
      per-connection output buffers, `EPOLLOUT`, `EINPROGRESS` handling
- [ ] **Connection lifetime safety** — refcounted connections, or per-thread `epoll` shards
      with `SO_REUSEPORT`, which removes the cross-thread sharing entirely
- [ ] Health checking and automatic failover
- [ ] Least-connections and weighted routing
- [ ] Configurable request method, path, headers, and body
- [ ] Revisit streaming metrics on a batched frame model
