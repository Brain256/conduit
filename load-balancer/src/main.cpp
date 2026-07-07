#include <sys/socket.h>
#include <netinet/in.h>
#include <iostream> 
#include <unistd.h>
#include <arpa/inet.h>
#include <yaml-cpp/yaml.h>
#include <sys/epoll.h>
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
    int client_fd; 
    int backend_fd; 
    bool closed = false;
};

std::unordered_map<int, Connection> connections; 
std::mutex connections_mutex;
std::atomic<int> counter{0}; 

Backend pick_backend(const std::vector<Backend>& backends) {
    int index = counter.fetch_add(1) % backends.size(); 
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

void forward_data(int epoll_fd, int connection_fd) {
    char buffer[4096] = {0};

    Connection c; 

    {
        std::lock_guard<std::mutex> lock(connections_mutex); 

        if (connections.find(connection_fd) == connections.end()) return; 

        c = connections[connection_fd];
    }

    ssize_t bytes_read = read(connection_fd, buffer, sizeof(buffer)); 

    if (bytes_read <= 0) {
        // no bytes meaning this is epoll saying the connection closed

        {
            std::lock_guard<std::mutex> lock(connections_mutex);

            auto it = connections.find(connection_fd);

            if (it == connections.end()) return;
            if (it->second.closed) return;  

            it->second.closed = true;

            int client_fd = it->second.client_fd;
            int backend_fd = it->second.backend_fd;

            std::cerr << "connection closed fd=" << client_fd << "\n";

            epoll_ctl(epoll_fd, EPOLL_CTL_DEL, client_fd, nullptr); 
            epoll_ctl(epoll_fd, EPOLL_CTL_DEL, backend_fd, nullptr); 

            close(client_fd); 
            close(backend_fd); 

            connections.erase(client_fd); 
            connections.erase(backend_fd); 
        }

    } else { 
        // bytes to forward
        
        if (connection_fd == c.client_fd) {
            write(c.backend_fd, buffer, bytes_read); 
            std::cout << bytes_read << " bytes forwarded to backend\n"; 
        } else {
            write(c.client_fd, buffer, bytes_read); 
            std::cout << bytes_read << " bytes forwarded to client\n"; 
        }

        // re-arm
        struct epoll_event ev{};
        ev.events = EPOLLIN | EPOLLONESHOT;
        ev.data.fd = connection_fd;
        epoll_ctl(epoll_fd, EPOLL_CTL_MOD, connection_fd, &ev);
    }
}

void create_connection(int epoll_fd, int client_fd, const std::vector<Backend>& backends) {

    int backend_fd = socket(AF_INET, SOCK_STREAM, 0);
    
    // choose next backend server (round robin)
    Backend b = pick_backend(backends); 

    // connect backend socket 
    struct sockaddr_in addr{};      

    addr.sin_family = AF_INET;     
    addr.sin_port = htons(b.port);  
    inet_pton(AF_INET, b.host.c_str(), &addr.sin_addr);

    connect(backend_fd, (struct sockaddr*)&addr, sizeof(addr)); 

    std::cout << "backend ip connected: " << b.host << ":" << b.port << "\n"; 

    {
        std::lock_guard<std::mutex> lock(connections_mutex); 
        connections[client_fd] = {client_fd, backend_fd}; 
        connections[backend_fd] = {client_fd, backend_fd}; 
    }
    
    struct epoll_event ev{}; 
    ev.events = EPOLLIN | EPOLLONESHOT; 

    ev.data.fd = client_fd; 
    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, client_fd, &ev); 

    ev.data.fd = backend_fd; 
    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, backend_fd, &ev);

    std::cerr << "registered client_fd=" << client_fd 
          << " backend_fd=" << backend_fd << " with epoll\n";
}

int main() {

    int num_threads = std::thread::hardware_concurrency(); 

    ThreadPool thread_pool(num_threads); 

    std::cout << "thread pool opened with " << num_threads << " threads\n"; 

    Config config = load_config("config.yaml"); 

    std::cout << config.backends.size() << " backends loaded from config file\n"; 

    // create socket
    int balancer_fd = socket(AF_INET, SOCK_STREAM, 0); 

    int opt = 1; 
    setsockopt(balancer_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    // bind socket to config port
    struct sockaddr_in addr{};      

    addr.sin_family = AF_INET; // address family
    addr.sin_addr.s_addr = INADDR_ANY; // holds ip address
    addr.sin_port = htons(config.port);  // port 

    bind(balancer_fd, (struct sockaddr*)&addr, sizeof(addr)); 

    listen(balancer_fd, 128); 

    int epoll_fd = epoll_create1(0); 

    struct epoll_event ev{}; 
    ev.events = EPOLLIN; 
    ev.data.fd = balancer_fd; 

    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, balancer_fd, &ev); 

    std::cout << "load balancer listening on port " << config.port << "\n"; 

    // epoll event loop
    struct epoll_event events[64]; 

    while (true) {
        int n = epoll_wait(epoll_fd, events, 64, -1); 

        for (int i = 0; i < n; ++i) {
            
                if (events[i].data.fd == balancer_fd) {
                    // new client connection
                    struct sockaddr_in client_addr{};
                    socklen_t client_len = sizeof(client_addr);

                    int client_fd = accept(balancer_fd, (struct sockaddr*)&client_addr, &client_len); 

                    thread_pool.submit([epoll_fd, client_fd, &config] () {
                            create_connection(epoll_fd, client_fd, config.backends); 
                        }
                    );
                } else { 
                    // existing connection, forward the data
                    int event_fd = events[i].data.fd; 
                    thread_pool.submit([epoll_fd, event_fd] () {
                            forward_data(epoll_fd, event_fd); 
                        }
                    );
                }
        }
    }

    close(balancer_fd); 

    return 0; 

}

