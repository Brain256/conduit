cmake_minimum_required(VERSION 3.16)
project(conduit)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(conduit
    src/main.cpp
    src/thread_pool.cpp
)

target_compile_options(conduit PRIVATE -Wall -Wextra -g)

find_package(yaml-cpp REQUIRED)
target_link_libraries(conduit PRIVATE yaml-cpp)