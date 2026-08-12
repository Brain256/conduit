cmake_minimum_required(VERSION 3.16)
project(conduit)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "Build type" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS
        Debug Release RelWithDebInfo MinSizeRel)
endif()

add_executable(conduit
    src/main.cpp
    src/thread_pool.cpp
)

target_compile_options(conduit PRIVATE -Wall -Wextra)

find_package(yaml-cpp REQUIRED)
find_package(Threads REQUIRED)
target_link_libraries(conduit PRIVATE yaml-cpp Threads::Threads)
