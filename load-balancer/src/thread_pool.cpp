#include "../include/thread_pool.hpp"

// constructor
ThreadPool::ThreadPool(int num_threads) {
    for (int i = 0; i < num_threads; ++i) {
        threads.emplace_back(&ThreadPool::worker_loop, this); 
    }
}

// destructor
ThreadPool::~ThreadPool() {

    { 
        std::lock_guard<std::mutex> lock(queue_mutex); 
        stop = true; 
    }

    queue_cv.notify_all(); 

    for (auto& t : threads) {
        t.join(); 
    }
}

// add a task to the task queue
void ThreadPool::submit(std::function<void()> task) {

    {
        std::lock_guard<std::mutex> lock(queue_mutex); 
        task_queue.push(task); 
    }

    queue_cv.notify_one(); 
}

// loop every worker thread will run
void ThreadPool::worker_loop() {

    while (true) {
        std::function<void()> task; 
        {
            std::unique_lock<std::mutex> lock(queue_mutex); 
            queue_cv.wait(lock, [this] { return !task_queue.empty() || stop; });  

            if ( task_queue.empty() && stop ) return; 

            task = task_queue.front(); 
            task_queue.pop(); 
        }

        task(); 
    }
}

