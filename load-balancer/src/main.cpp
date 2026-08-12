#include <sys/socket.h>
#include <netinet/in.h>
#include <iostream> 
#include <unistd.h>
#include <arpa/inet.h>
#include <yaml-cpp/yaml.h>
#include <sys/epoll.h>
#include <fcntl.h>
#include <cerrno>
#include <cstring>
#include <cstdint>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <utility>
#include "../include/thread_pool.hpp"


struct Backend {
    std::string host;
    int port;
};

struct Config {
    int port;
    std::vector<Backend> backends;
};

enum class EndpointSide {
    Client,
    Backend
};

struct Connection {
    std::uint64_t id;
    int client_fd;
    int backend_fd;
    std::uint64_t client_token;
    std::uint64_t backend_token;
    bool closed = false;
    std::mutex io_mutex;
};

struct Endpoint {
    std::uint64_t token;
    int fd;
    EndpointSide side;
    std::shared_ptr<Connection> connection;
};

constexpr std::uint64_t kListenerToken = 0;

std::unordered_map<std::uint64_t, Endpoint> endpoints;
std::mutex connections_mutex;
std::atomic<std::uint64_t> next_connection_id{1};
std::atomic<std::uint64_t> next_endpoint_token{1};
// unsigned: a signed counter wraps to negative after 2^31 connections, and a
// negative index into backends is out-of-bounds UB.
std::atomic<unsigned> counter{0};

// Per-connection and per-chunk tracing. Off by default: these sit on the data
// path, where an unbuffered stream write costs a syscall and takes the global
// iostream lock. Compiled out entirely in an optimized build.
constexpr bool kVerbose = false;

const bool kDiagnostics = [] {
    const char* value = std::getenv("CONDUIT_DIAGNOSTICS");
    return value != nullptr && value[0] == '1';
}();

std::mutex diagnostics_mutex;

template <typename... Args>
void diagnostic(Args&&... args) {
    if (!kDiagnostics) return;

    std::lock_guard<std::mutex> lock(diagnostics_mutex);
    (std::cerr << ... << std::forward<Args>(args)) << '\n';
}

bool set_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags == -1) return false;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK) != -1;
}

const Backend& pick_backend(const std::vector<Backend>& backends) {
    unsigned index = counter.fetch_add(1, std::memory_order_relaxed) % backends.size();
    return backends[index];
}

Config load_config(const std::string& path) {
    YAML::Node yaml = YAML::LoadFile(path); 
    
    Config config; 
    config.port = yaml["load_balancer"]["port"].as<int>(); 

    for (const auto& backend : yaml["backends"]) {
        Backend b; 
        b.host = backend["host"].as<std::string>(); 
        b.port = backend["port"].as<int>(); 
        config.backends.push_back(b); 
    }

    return config; 
}

enum class CloseReason {
    ClientClosed,
    BackendClosed,
    ReadError,
    WriteError,
    EpollError
};

const char* close_reason_name(CloseReason reason) {
    switch (reason) {
        case CloseReason::ClientClosed: return "client-closed";
        case CloseReason::BackendClosed: return "backend-closed";
        case CloseReason::ReadError: return "read-error";
        case CloseReason::WriteError: return "write-error";
        case CloseReason::EpollError: return "epoll-error";
    }

    return "unknown";
}

bool close_connection(int epoll_fd, std::uint64_t token, CloseReason reason) {
    std::shared_ptr<Connection> connection;

    {
        std::lock_guard<std::mutex> lock(connections_mutex);

        auto it = endpoints.find(token);
        if (it == endpoints.end()) {
            diagnostic("[stale-close] token=", token,
                       " reason=", close_reason_name(reason));
            return false;
        }

        connection = it->second.connection;
    }

    // Serialize cleanup with reads and writes on this logical connection.
    std::lock_guard<std::mutex> io_lock(connection->io_mutex);

    {
        // Keep the map lock through epoll removal and close so a new endpoint
        // cannot be registered while these fds are being retired and reused.
        std::lock_guard<std::mutex> lock(connections_mutex);

        auto it = endpoints.find(token);
        if (it == endpoints.end()) {
            diagnostic("[stale-close] token=", token,
                       " reason=", close_reason_name(reason));
            return false;
        }

        connection = it->second.connection;
        if (connection->closed) {
            diagnostic("[duplicate-close] id=", connection->id,
                       " token=", token,
                       " reason=", close_reason_name(reason));
            return false;
        }

        connection->closed = true;

        if (epoll_ctl(epoll_fd, EPOLL_CTL_DEL, connection->client_fd, nullptr) == -1) {
            const int error = errno;
            diagnostic("[epoll-del-failed] id=", connection->id,
                       " fd=", connection->client_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }
        if (epoll_ctl(epoll_fd, EPOLL_CTL_DEL, connection->backend_fd, nullptr) == -1) {
            const int error = errno;
            diagnostic("[epoll-del-failed] id=", connection->id,
                       " fd=", connection->backend_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }

        if (close(connection->client_fd) == -1) {
            const int error = errno;
            diagnostic("[close-failed] id=", connection->id,
                       " fd=", connection->client_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }
        if (close(connection->backend_fd) == -1) {
            const int error = errno;
            diagnostic("[close-failed] id=", connection->id,
                       " fd=", connection->backend_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }

        endpoints.erase(connection->client_token);
        endpoints.erase(connection->backend_token);
    }

    diagnostic("[closed] id=", connection->id,
               " client_fd=", connection->client_fd,
               " backend_fd=", connection->backend_fd,
               " reason=", close_reason_name(reason));
    return true;
}

void close_unregistered_sockets(int client_fd, int backend_fd, const char* reason) {
    diagnostic("[unregistered-close] client_fd=", client_fd,
               " backend_fd=", backend_fd,
               " reason=", reason);

    if (backend_fd >= 0) close(backend_fd);
    if (client_fd >= 0) close(client_fd);
}

void forward_data(int epoll_fd, std::uint64_t token, std::uint32_t event_flags) {
    char buffer[4096] = {0};
    Endpoint endpoint;

    {
        std::lock_guard<std::mutex> lock(connections_mutex);

        auto it = endpoints.find(token);
        if (it == endpoints.end()) {
            diagnostic("[stale-event] token=", token,
                       " events=0x", std::hex, event_flags, std::dec);
            return;
        }

        endpoint = it->second;
    }

    const std::shared_ptr<Connection>& connection = endpoint.connection;
    std::unique_lock<std::mutex> io_lock(connection->io_mutex);

    if (connection->closed) {
        diagnostic("[closed-event] id=", connection->id,
                   " token=", token,
                   " fd=", endpoint.fd);
        return;
    }

    diagnostic("[event] id=", connection->id,
               " token=", token,
               " fd=", endpoint.fd,
               " client_fd=", connection->client_fd,
               " backend_fd=", connection->backend_fd,
               " events=0x", std::hex, event_flags, std::dec);

    ssize_t bytes_read = read(endpoint.fd, buffer, sizeof(buffer));

    if (bytes_read <= 0) {
        int read_errno = bytes_read < 0 ? errno : 0;
        diagnostic("[read-close] id=", connection->id,
                   " token=", token,
                   " fd=", endpoint.fd,
                   " bytes=", bytes_read,
                   " errno=", read_errno,
                   " error=", read_errno == 0 ? "none" : std::strerror(read_errno));

        const CloseReason reason = bytes_read < 0
            ? CloseReason::ReadError
            : endpoint.side == EndpointSide::Client
                ? CloseReason::ClientClosed
                : CloseReason::BackendClosed;

        io_lock.unlock();
        close_connection(epoll_fd, token, reason);
        return;
    }

    const int destination_fd = endpoint.side == EndpointSide::Client
        ? connection->backend_fd
        : connection->client_fd;

    ssize_t total_written = 0;
    int write_errno = 0;

    while (total_written < bytes_read) {
        ssize_t n = write(
            destination_fd,
            buffer + total_written,
            bytes_read - total_written
        );

        if (n < 0) {
            write_errno = errno;
            break;
        }
        if (n == 0) {
            break;
        }

        total_written += n;
    }

    if (total_written != bytes_read) {
        diagnostic("[write-incomplete] id=", connection->id,
                   " token=", token,
                   " source_fd=", endpoint.fd,
                   " destination_fd=", destination_fd,
                   " read_bytes=", bytes_read,
                   " written_bytes=", total_written,
                   " errno=", write_errno,
                   " error=", write_errno == 0 ? "write returned zero" : std::strerror(write_errno));

        io_lock.unlock();
        close_connection(epoll_fd, token, CloseReason::WriteError);
        return;
    }

    if (kVerbose) {
        if (endpoint.side == EndpointSide::Client) {
            std::cout << total_written << " bytes written to backend\n";
        } else {
            std::cout << total_written << " bytes written to client\n";
        }
    }

    struct epoll_event ev{};
    ev.events = EPOLLIN | EPOLLONESHOT;
    ev.data.u64 = token;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_MOD, endpoint.fd, &ev) == -1) {
        const int error = errno;
        diagnostic("[epoll-mod-failed] id=", connection->id,
                   " token=", token,
                   " fd=", endpoint.fd,
                   " errno=", error,
                   " error=", std::strerror(error));

        io_lock.unlock();
        close_connection(epoll_fd, token, CloseReason::EpollError);
        return;
    }
}

void create_connection(int epoll_fd, int client_fd, const std::vector<Backend>& backends) {
    const std::uint64_t connection_id = next_connection_id.fetch_add(1, std::memory_order_relaxed);
    int backend_fd = socket(AF_INET, SOCK_STREAM, 0);

    if (backend_fd == -1) {
        diagnostic("[socket-failed] id=", connection_id,
                   " client_fd=", client_fd,
                   " errno=", errno,
                   " error=", std::strerror(errno));
        close_unregistered_sockets(client_fd, -1, "backend-socket-failed");
        return;
    }

    diagnostic("[accepted] id=", connection_id,
               " client_fd=", client_fd,
               " backend_fd=", backend_fd);

    // choose next backend server (round robin)
    const Backend& b = pick_backend(backends);

    // connect backend socket
    struct sockaddr_in addr{};

    addr.sin_family = AF_INET;
    addr.sin_port = htons(b.port);

    // convert IPv4 address string into its binary format for network routing
    if (inet_pton(AF_INET, b.host.c_str(), &addr.sin_addr) <= 0) {
        diagnostic("[invalid-backend-address] id=", connection_id,
                   " client_fd=", client_fd,
                   " backend_fd=", backend_fd,
                   " host=", b.host);

        close_unregistered_sockets(client_fd, backend_fd, "invalid-backend-address");
        return;
    }

    // connect the backend TCP socket to the correct nginx backend ip address
    if (connect(backend_fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        diagnostic("[backend-connect-failed] id=", connection_id,
                   " client_fd=", client_fd,
                   " backend_fd=", backend_fd,
                   " backend=", b.host, ":", b.port,
                   " errno=", errno,
                   " error=", std::strerror(errno));

        close_unregistered_sockets(client_fd, backend_fd, "backend-connect-failed");
        return;
    }

    if (kVerbose) {
        std::cout << "backend ip connected: " << b.host << ":" << b.port << "\n";
    }

    auto connection = std::make_shared<Connection>();
    connection->id = connection_id;
    connection->client_fd = client_fd;
    connection->backend_fd = backend_fd;
    connection->client_token = next_endpoint_token.fetch_add(1, std::memory_order_relaxed);
    connection->backend_token = next_endpoint_token.fetch_add(1, std::memory_order_relaxed);

    {
        std::lock_guard<std::mutex> lock(connections_mutex);
        endpoints.emplace(
            connection->client_token,
            Endpoint{
                connection->client_token,
                client_fd,
                EndpointSide::Client,
                connection
            }
        );
        endpoints.emplace(
            connection->backend_token,
            Endpoint{
                connection->backend_token,
                backend_fd,
                EndpointSide::Backend,
                connection
            }
        );
    }

    struct epoll_event ev{};
    ev.events = EPOLLIN | EPOLLONESHOT;

    ev.data.u64 = connection->client_token;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, client_fd, &ev) == -1) {
        const int error = errno;
        diagnostic("[epoll-add-failed] id=", connection_id,
                   " token=", connection->client_token,
                   " fd=", client_fd,
                   " errno=", error,
                   " error=", std::strerror(error));
        close_connection(epoll_fd, connection->client_token, CloseReason::EpollError);
        return;
    }

    ev.data.u64 = connection->backend_token;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, backend_fd, &ev) == -1) {
        const int error = errno;
        diagnostic("[epoll-add-failed] id=", connection_id,
                   " token=", connection->backend_token,
                   " fd=", backend_fd,
                   " errno=", error,
                   " error=", std::strerror(error));
        close_connection(epoll_fd, connection->backend_token, CloseReason::EpollError);
        return;
    }

    diagnostic("[registered] id=", connection_id,
               " client_token=", connection->client_token,
               " backend_token=", connection->backend_token,
               " client_fd=", client_fd,
               " backend_fd=", backend_fd,
               " backend=", b.host, ":", b.port);

    if (kVerbose) {
        std::cerr << "registered client_fd=" << client_fd
              << " backend_fd=" << backend_fd << " with epoll\n";
    }
}

int main() {

    std::ios::sync_with_stdio(false);

    // hardware_concurrency() is allowed to return 0, which would build a pool
    // with no workers: connections get accepted and then never served.
    unsigned num_threads = std::thread::hardware_concurrency();
    if (num_threads == 0) num_threads = 4;

    ThreadPool thread_pool(num_threads);

    std::cout << "thread pool opened with " << num_threads << " threads\n"; 

    Config config = load_config("config.yaml"); 

    std::cout << config.backends.size() << " backends loaded from config file\n"; 

    // create socket
    int balancer_fd = socket(AF_INET, SOCK_STREAM, 0); 

    int opt = 1; 
    setsockopt(balancer_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    set_nonblocking(balancer_fd);

    // bind socket to config port
    struct sockaddr_in addr{};      

    addr.sin_family = AF_INET; // address family
    addr.sin_addr.s_addr = INADDR_ANY; // holds ip address
    addr.sin_port = htons(config.port);  // port 

    bind(balancer_fd, (struct sockaddr*)&addr, sizeof(addr)); 

    listen(balancer_fd, SOMAXCONN); 

    int epoll_fd = epoll_create1(0); 

    struct epoll_event ev{}; 
    ev.events = EPOLLIN; 
    ev.data.u64 = kListenerToken; 

    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, balancer_fd, &ev); 

    // endl, not "\n": sync_with_stdio(false) leaves cout buffered, and this
    // process never exits, so an unflushed startup banner is never seen.
    std::cout << "load balancer listening on port " << config.port << std::endl;

    // epoll event loop
    struct epoll_event events[64]; 

    while (true) {
        int n = epoll_wait(epoll_fd, events, 64, -1);

        if (n == -1) {
            if (errno == EINTR) continue;

            diagnostic("[epoll-wait-failed] errno=", errno,
                       " error=", std::strerror(errno));
            break;
        }

        for (int i = 0; i < n; ++i) {
            const std::uint32_t event_flags = events[i].events;

            if (events[i].data.u64 == kListenerToken) {
                // new client connection
                while (true) {
                    struct sockaddr_in client_addr{};
                    socklen_t client_len = sizeof(client_addr);

                    int client_fd = accept(balancer_fd, (struct sockaddr*)&client_addr, &client_len);

                    if (client_fd < 0) {
                        if (errno == EAGAIN || errno == EWOULDBLOCK) {
                            break;
                        }

                        if (errno == EINTR) {
                            continue;
                        }

                        diagnostic("[accept-failed] errno=", errno,
                                   " error=", std::strerror(errno));
                        break;
                    }

                    thread_pool.submit([epoll_fd, client_fd, &config] () {
                            create_connection(epoll_fd, client_fd, config.backends);
                        }
                    );
                }
            } else {
                // Existing connection endpoint, identified by a non-reused token.
                const std::uint64_t token = events[i].data.u64;

                diagnostic("[queued-event] token=", token,
                           " events=0x", std::hex, event_flags, std::dec);

                thread_pool.submit([epoll_fd, token, event_flags] () {
                        forward_data(epoll_fd, token, event_flags);
                    }
                );
            }
        }
    }

    close(balancer_fd); 

    return 0; 

}

