#include <sys/socket.h>
#include <netinet/in.h>
#include <iostream> 
#include <unistd.h>
#include <arpa/inet.h>
#include <yaml-cpp/yaml.h>

struct Backend {
    std::string host; 
    int port; 
};

struct Config {
    int port;
    std::vector<Backend> backends;
};

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

void exchange_data(int client_fd, int backend_fd) {
    char buffer[4096] = {0}; 

    ssize_t bytes_read = read(client_fd, buffer, sizeof(buffer)); 

    write(backend_fd, buffer, bytes_read); 

    while (true) {
        std::cout << "reading\n"; 

        bytes_read = read(backend_fd, buffer, sizeof(buffer)); 

        if (bytes_read <= 0) {
            std::cout << "no bytes from the backend\n"; 
            break; 
        }

        write(client_fd, buffer, bytes_read); 
    }
}

void handle_connection(int client_fd, const std::vector<Backend>& backends) {

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

    exchange_data(client_fd, backend_fd); 

    std::cout << "backend ip disconnected: " << b.host << ":" << b.port << "\n"; 

    close(client_fd); 
    close(backend_fd); 

}

int main() {
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

    std::cout << "load balancer listening on port " << config.port << "\n"; 

    // socket accept loop
    while (true) {
        
        struct sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);

        int client_fd = accept(balancer_fd, (struct sockaddr*)&client_addr, &client_len); 
        std::cout << "connection accepted\n"; 

        handle_connection(client_fd, config.backends); 

    }

    close(balancer_fd); 

    return 0; 

}

