#pragma once

#include <array>
#include <optional>
#include <cstdio>

#include "syntax/vps.h"
#include "syntax/sps.h"
#include "syntax/pps.h"
#include "syntax/slice_header.h"
#include "bitstream/nal_unit.h"
#include "bitstream/bitstream_reader.h"

namespace hevc {

// Parameter Set Manager — stores VPS/SPS/PPS by ID (AD-003)
// Spec: VPS 0-15, SPS 0-15, PPS 0-63
class ParameterSetManager {
public:
    // Parse and store a parameter set NAL unit
    // Returns true if parsing succeeded
    bool process_nal(const NalUnit& nal);

    // Parse a slice header using active parameter sets
    // Returns true if parsing succeeded (PPS/SPS must be available)
    bool parse_slice_header(SliceHeader& sh, const NalUnit& nal);

    // Accessors
    const VPS* get_vps(int id) const {
        if (id < 0 || id > 15 || !vps_[id]) return nullptr;
        return &vps_[id].value();
    }
    const SPS* get_sps(int id) const {
        if (id < 0 || id > 15 || !sps_[id]) return nullptr;
        return &sps_[id].value();
    }
    const PPS* get_pps(int id) const {
        if (id < 0 || id > 63 || !pps_[id]) return nullptr;
        return &pps_[id].value();
    }

    // Active parameter sets (set by last parsed slice header)
    const SPS* active_sps() const { return (active_sps_id_ >= 0) ? get_sps(active_sps_id_) : nullptr; }
    const PPS* active_pps() const { return (active_pps_id_ >= 0) ? get_pps(active_pps_id_) : nullptr; }

private:
    std::array<std::optional<VPS>, 16> vps_;
    std::array<std::optional<SPS>, 16> sps_;
    std::array<std::optional<PPS>, 64> pps_;

    // §7.4.3.3: a PPS may arrive before the SPS it refers to, and that SPS may be
    // replaced before the PPS is used — only its activation needs the SPS. The
    // RBSP is kept, and parsed again at activation when the SPS it was parsed
    // against has changed since, or was missing.
    std::array<std::vector<uint8_t>, 64> pps_rbsp_;
    std::array<uint32_t, 64> pps_sps_generation_{};
    std::array<uint32_t, 16> sps_generation_{};
    bool parse_pps_rbsp(int pps_id);

    int active_sps_id_ = -1;
    int active_pps_id_ = -1;
};

} // namespace hevc
