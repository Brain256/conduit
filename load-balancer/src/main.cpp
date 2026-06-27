#include <sys/socket.h>
#include <netinet/in.h>
#include <iostream> 
#include <unistd.h>
#include <arpa/inet.h>

void exchange_data(int client_fd, int backend_fd) {
    char buffer[4096] = {0}; 

    ssize_t bytes_read = read(client_fd, buffer, sizeof(buffer)); 

    write(backend_fd, buffer, bytes_read); 

    while (true) {
        std::cout << "reading\n"; 

        /*
        ssize_t bytes_read = read(client_fd, buffer, sizeof(buffer)); 

        if (bytes_read <= 0) {
            std::cout << "no client bytes\n"; 
            break; 
        }
        write(backend_fd, buffer, bytes_read); 
        */

        bytes_read = read(backend_fd, buffer, sizeof(buffer)); 

        if (bytes_read <= 0) {
            std::cout << "no bytes from the backend\n"; 
            break; 
        }

        write(client_fd, buffer, bytes_read); 
    }
}

void handle_connection(int client_fd) {
    int backend_fd = socket(AF_INET, SOCK_STREAM, 0); 

    // bind backend socket
    struct sockaddr_in addr{};      

    addr.sin_family = AF_INET;     
    addr.sin_port = htons(9001);  
    inet_pton(AF_INET, "10.31.7.140", &addr.sin_addr);

    connect(backend_fd, (struct sockaddr*)&addr, sizeof(addr)); 

    std::cout << "backend ip connected\n"; 

    exchange_data(client_fd, backend_fd); 

    std::cout << "client connection closed\n"; 

    close(client_fd); 
    close(backend_fd); 

}

int main() {
    // create socket
    int balancer_fd = socket(AF_INET, SOCK_STREAM, 0); 

    int opt = 1; 
    setsockopt(balancer_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    // bind socket to 8080 port
    struct sockaddr_in addr{};      

    addr.sin_family = AF_INET; // address family
    addr.sin_addr.s_addr = INADDR_ANY; // holds ip address
    addr.sin_port = htons(8080);  // port 

    bind(balancer_fd, (struct sockaddr*)&addr, sizeof(addr)); 

    listen(balancer_fd, 128); 

    std::cout << "load balancer listening on port 8080\n"; 

    // socket accept loop
    while (true) {
        
        struct sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);

        int client_fd = accept(balancer_fd, (struct sockaddr*)&client_addr, &client_len); 
        std::cout << "connection accepted\n"; 

        handle_connection(client_fd); 

    }

    close(balancer_fd); 

    return 0; 

}

