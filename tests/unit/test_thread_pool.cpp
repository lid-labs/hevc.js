#include <gtest/gtest.h>
#include <cstdlib>
#include <thread>

#include "common/thread_pool.h"

using namespace hevc;

// HEVC_THREADS sets the worker count when the constructor is not given one.
TEST(ThreadPool, HevcThreadsSetsWorkerCount) {
    setenv("HEVC_THREADS", "3", 1);
    ThreadPool from_env;
    ThreadPool explicit_count(2);
    unsetenv("HEVC_THREADS");
    EXPECT_EQ(from_env.num_workers(), 3);
    EXPECT_EQ(explicit_count.num_workers(), 2);
}

TEST(ThreadPool, InvalidHevcThreadsFallsBackToCoreCount) {
    int cores = static_cast<int>(std::thread::hardware_concurrency());
    if (cores <= 0) cores = 4;
    for (const char* bad : {"0", "-2", "abc", "4x", ""}) {
        setenv("HEVC_THREADS", bad, 1);
        ThreadPool pool;
        EXPECT_EQ(pool.num_workers(), cores) << "HEVC_THREADS=\"" << bad << "\"";
    }
    unsetenv("HEVC_THREADS");
}
