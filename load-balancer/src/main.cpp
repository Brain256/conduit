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
#include <mutex>
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

struct Connection {
    std::uint64_t id;
    int client_fd; 
    int backend_fd; 
    bool closed = false;
};

std::unordered_map<int, Connection> connections;
std::mutex connections_mutex;
std::atomic<std::uint64_t> next_connection_id{1};
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

bool close_connection(int epoll_fd, int event_fd, CloseReason reason) {
    Connection connection;

    // Keep the map lock through epoll removal and close. In the current fd-keyed
    // design this prevents another setup task from registering a reused fd
    // between removing the old fd and erasing its map entries.
    {
        std::lock_guard<std::mutex> lock(connections_mutex);

        auto it = connections.find(event_fd);
        if (it == connections.end()) {
            diagnostic("[stale-close] fd=", event_fd,
                       " reason=", close_reason_name(reason));
            return false;
        }

        if (it->second.closed) {
            diagnostic("[duplicate-close] id=", it->second.id,
                       " event_fd=", event_fd,
                       " reason=", close_reason_name(reason));
            return false;
        }

        connection = it->second;
        it->second.closed = true;
        connection.closed = true;

        if (epoll_ctl(epoll_fd, EPOLL_CTL_DEL, connection.client_fd, nullptr) == -1) {
            const int error = errno;
            diagnostic("[epoll-del-failed] id=", connection.id,
                       " fd=", connection.client_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }
        if (epoll_ctl(epoll_fd, EPOLL_CTL_DEL, connection.backend_fd, nullptr) == -1) {
            const int error = errno;
            diagnostic("[epoll-del-failed] id=", connection.id,
                       " fd=", connection.backend_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }

        if (close(connection.client_fd) == -1) {
            const int error = errno;
            diagnostic("[close-failed] id=", connection.id,
                       " fd=", connection.client_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }
        if (close(connection.backend_fd) == -1) {
            const int error = errno;
            diagnostic("[close-failed] id=", connection.id,
                       " fd=", connection.backend_fd,
                       " errno=", error,
                       " error=", std::strerror(error));
        }

        connections.erase(connection.client_fd);
        connections.erase(connection.backend_fd);
    }

    diagnostic("[closed] id=", connection.id,
               " client_fd=", connection.client_fd,
               " backend_fd=", connection.backend_fd,
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

void forward_data(int epoll_fd, int connection_fd, std::uint32_t event_flags) {
    char buffer[4096] = {0};

    Connection c;

    {
        std::lock_guard<std::mutex> lock(connections_mutex);

        auto it = connections.find(connection_fd);
        if (it == connections.end()) {
            diagnostic("[stale-event] fd=", connection_fd,
                       " events=0x", std::hex, event_flags, std::dec);
            return;
        }

        c = it->second;
    }

    diagnostic("[event] id=", c.id,
               " fd=", connection_fd,
               " client_fd=", c.client_fd,
               " backend_fd=", c.backend_fd,
               " events=0x", std::hex, event_flags, std::dec);

    ssize_t bytes_read = read(connection_fd, buffer, sizeof(buffer));

    if (bytes_read <= 0) {
        int read_errno = bytes_read < 0 ? errno : 0;
        diagnostic("[read-close] id=", c.id,
                   " fd=", connection_fd,
                   " bytes=", bytes_read,
                   " errno=", read_errno,
                   " error=", read_errno == 0 ? "none" : std::strerror(read_errno));

        close_connection(
            epoll_fd,
            connection_fd,
            bytes_read == 0 ? CloseReason::ClientClosed : CloseReason::ReadError
        );
        return;

    } else {
        int fd = 0;
        if (connection_fd == c.client_fd) {
            fd = c.backend_fd;
        } else {
            fd = c.client_fd;
        }

        ssize_t total_written = 0;
        int write_errno = 0;

        while (total_written < bytes_read) {
            ssize_t n = write(fd, buffer + total_written, bytes_read - total_written);

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
            diagnostic("[write-incomplete] id=", c.id,
                       " source_fd=", connection_fd,
                       " destination_fd=", fd,
                       " read_bytes=", bytes_read,
                       " written_bytes=", total_written,
                       " errno=", write_errno,
                       " error=", write_errno == 0 ? "write returned zero" : std::strerror(write_errno));

            close_connection(epoll_fd, connection_fd, CloseReason::WriteError);
            return;
        }

        if (kVerbose) {
            if (connection_fd == c.client_fd) {
                std::cout << total_written << " bytes written to backend\n";
            } else {
                std::cout << total_written << " bytes written to client\n";
            }
        }

        struct epoll_event ev{};
        ev.events = EPOLLIN | EPOLLONESHOT;
        ev.data.fd = connection_fd;
        if (epoll_ctl(epoll_fd, EPOLL_CTL_MOD, connection_fd, &ev) == -1) {
            diagnostic("[epoll-mod-failed] id=", c.id,
                       " fd=", connection_fd,
                       " errno=", errno,
                       " error=", std::strerror(errno));
        }
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

    {
        std::lock_guard<std::mutex> lock(connections_mutex);
        connections[client_fd] = {connection_id, client_fd, backend_fd, false};
        connections[backend_fd] = {connection_id, client_fd, backend_fd, false};
    }

    struct epoll_event ev{};
    ev.events = EPOLLIN | EPOLLONESHOT;

    ev.data.fd = client_fd;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, client_fd, &ev) == -1) {
        const int error = errno;
        diagnostic("[epoll-add-failed] id=", connection_id,
                   " fd=", client_fd,
                   " errno=", error,
                   " error=", std::strerror(error));
        close_connection(epoll_fd, client_fd, CloseReason::EpollError);
        return;
    }

    ev.data.fd = backend_fd;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, backend_fd, &ev) == -1) {
        const int error = errno;
        diagnostic("[epoll-add-failed] id=", connection_id,
                   " fd=", backend_fd,
                   " errno=", error,
                   " error=", std::strerror(error));
        close_connection(epoll_fd, backend_fd, CloseReason::EpollError);
        return;
    }

    diagnostic("[registered] id=", connection_id,
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
    ev.data.fd = balancer_fd; 

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

            if (events[i].data.fd == balancer_fd) {
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
                // existing connection, forward the data
                int event_fd = events[i].data.fd;

                diagnostic("[queued-event] fd=", event_fd,
                           " events=0x", std::hex, event_flags, std::dec);

                thread_pool.submit([epoll_fd, event_fd, event_flags] () {
                        forward_data(epoll_fd, event_fd, event_flags);
                    }
                );
            }
        }
    }

    close(balancer_fd); 

    return 0; 

}

