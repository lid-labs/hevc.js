// hevc-bench — decode-only timing, for A/B comparisons of decoder changes.
//
// Unlike `hevc-decode -o`, nothing is written out: each run decodes the whole
// stream into a fresh Decoder, and only the decode calls are timed.
//
//   hevc-bench <file.265> [-n RUNS] [--stream]
//
// --stream feeds one access unit at a time and drains after each, the way the
// WASM worker does, then flushes; the default is one batch decode() call.
// The thread count follows HEVC_THREADS (see src/common/thread_pool.cpp).

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>

#include "decoding/decoder.h"

namespace {

// Offsets where each access unit starts: at the first VCL NAL of a picture
// (first_slice_segment_in_pic_flag = 1), or at the non-VCL NALs just before it.
std::vector<size_t> access_unit_starts(const std::vector<uint8_t>& data) {
    std::vector<size_t> starts;
    size_t pending = SIZE_MAX;  // first non-VCL NAL since the last VCL NAL
    for (size_t i = 0; i + 3 < data.size(); i++) {
        if (data[i] != 0 || data[i + 1] != 0 || data[i + 2] != 1) continue;
        size_t nal = (i > 0 && data[i - 1] == 0) ? i - 1 : i;
        size_t hdr = i + 3;
        if (hdr + 2 >= data.size()) break;
        int type = (data[hdr] >> 1) & 0x3F;
        if (type < 32) {
            bool first_slice = (data[hdr + 2] & 0x80) != 0;
            if (first_slice) starts.push_back(pending != SIZE_MAX ? pending : nal);
            pending = SIZE_MAX;
        } else if (pending == SIZE_MAX) {
            pending = nal;
        }
        i += 2;
    }
    if (starts.empty() || starts[0] != 0) starts.insert(starts.begin(), 0);
    return starts;
}

void usage(const char* argv0) {
    fprintf(stderr, "Usage: %s <file.265> [-n RUNS] [--stream]\n", argv0);
}

}  // namespace

int main(int argc, char* argv[]) {
    const char* path = nullptr;
    int runs = 5;
    bool stream = false;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-n") == 0 && i + 1 < argc) {
            runs = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--stream") == 0) {
            stream = true;
        } else if (argv[i][0] != '-' && !path) {
            path = argv[i];
        } else {
            usage(argv[0]);
            return 1;
        }
    }
    if (!path || runs <= 0) {
        usage(argv[0]);
        return 1;
    }

    std::ifstream f(path, std::ios::binary);
    std::vector<uint8_t> data{std::istreambuf_iterator<char>(f), {}};
    if (data.empty()) {
        fprintf(stderr, "Error: cannot read %s\n", path);
        return 1;
    }
    std::vector<size_t> aus = access_unit_starts(data);
    aus.push_back(data.size());

    const char* threads = getenv("HEVC_THREADS");
    printf("%s: %zu bytes, %s mode, HEVC_THREADS=%s\n", path, data.size(),
           stream ? "stream" : "batch", threads ? threads : "(unset)");

    std::vector<double> times;
    size_t frames = 0;
    for (int r = 0; r < runs; r++) {
        size_t out = 0;
        // Built before t0 and destroyed after t1: the thread pool's start-up and
        // the DPB's release are not decoding.
        hevc::Decoder dec;
        auto t0 = std::chrono::steady_clock::now();
        if (stream) {
            for (size_t a = 0; a + 1 < aus.size(); a++) {
                if (dec.feed(data.data() + aus[a], aus[a + 1] - aus[a]) ==
                    hevc::DecodeStatus::ERROR) {
                    fprintf(stderr, "Error: decode failed at access unit %zu\n", a);
                    return 1;
                }
                out += dec.drain().size();
            }
            out += dec.flush().size();
        } else {
            if (dec.decode(data.data(), data.size()) == hevc::DecodeStatus::ERROR) {
                fprintf(stderr, "Error: decode failed\n");
                return 1;
            }
            out = dec.output_pictures().size();
        }
        auto t1 = std::chrono::steady_clock::now();
        times.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
        frames = out;
        printf("run %d: %.1f ms\n", r + 1, times.back());
    }

    std::vector<double> sorted = times;
    std::sort(sorted.begin(), sorted.end());
    double best = sorted.front();
    double median = sorted[sorted.size() / 2];
    printf("frames %zu  best %.1f ms (%.1f fps)  median %.1f ms (%.1f fps)\n", frames,
           best, frames * 1000.0 / best, median, frames * 1000.0 / median);
    return 0;
}
