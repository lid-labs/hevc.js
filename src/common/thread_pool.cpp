#include "common/thread_pool.h"

#include <cstdlib>

namespace hevc {

ThreadPool::ThreadPool(int num_threads) {
#ifdef __EMSCRIPTEN__
    // WASM without -pthread: threads are not available
    (void)num_threads;
    return;
#else
    if (num_threads <= 0) {
        // HEVC_THREADS overrides the core count, for benchmarks: 1 decodes WPP
        // rows serially, as the WASM build does. Invalid values are ignored.
        if (const char* env = std::getenv("HEVC_THREADS")) {
            char* end = nullptr;
            long n = std::strtol(env, &end, 10);
            if (end != env && *end == '\0' && n > 0 && n <= 256)
                num_threads = static_cast<int>(n);
        }
    }
    if (num_threads <= 0) {
        num_threads = static_cast<int>(std::thread::hardware_concurrency());
        if (num_threads <= 0) num_threads = 4;
    }
    workers_.reserve(num_threads);
    for (int i = 0; i < num_threads; i++) {
        workers_.emplace_back(&ThreadPool::worker_loop, this);
    }
#endif
}

ThreadPool::~ThreadPool() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        shutdown_ = true;
    }
    job_available_.notify_all();
    for (auto& w : workers_) {
        w.join();
    }
}

void ThreadPool::submit(std::function<void()> job) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jobs_.push(std::move(job));
        active_jobs_.fetch_add(1, std::memory_order_relaxed);
    }
    job_available_.notify_one();
}

void ThreadPool::wait_all() {
    std::unique_lock<std::mutex> lock(mutex_);
    jobs_done_.wait(lock, [this] {
        return jobs_.empty() && active_jobs_.load(std::memory_order_relaxed) == 0;
    });
}

void ThreadPool::worker_loop() {
    for (;;) {
        std::function<void()> job;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            job_available_.wait(lock, [this] {
                return shutdown_ || !jobs_.empty();
            });
            if (shutdown_ && jobs_.empty())
                return;
            job = std::move(jobs_.front());
            jobs_.pop();
        }
        job();
        if (active_jobs_.fetch_sub(1, std::memory_order_acq_rel) == 1) {
            jobs_done_.notify_one();
        }
    }
}

} // namespace hevc
