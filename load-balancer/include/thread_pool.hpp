#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <functional>
#include <vector>

class ThreadPool {
public:
    ThreadPool(int num_threads);
    ~ThreadPool();
    void submit(std::function<void()> task);

private:
    void worker_loop();

    std::vector<std::thread> threads;
    std::queue<std::function<void()>> task_queue;
    std::mutex queue_mutex;
    std::condition_variable queue_cv;
    bool stop = false;
};