// HEVC Decoder C API implementation

#include "wasm/hevc_api.h"
#include "decoding/decoder.h"
#include "common/types.h"

#include <cstring>
#include <vector>

struct HEVCDecoder {
    hevc::Decoder decoder;
    std::vector<hevc::Picture*> output;   // batch mode
    std::vector<hevc::Picture*> drained;  // incremental mode
    std::vector<hevc::SuppressedPicture> suppressed;  // pending PicOutputFlag = 0
    const hevc::SPS* last_sps = nullptr;
};

// The JS wrapper reads HEVCFrame by hardcoded byte offsets and allocates 48
// bytes for it (decoder.ts, worker.ts). Under wasm32 that is exactly its size,
// so a field added here without updating those offsets would corrupt the read.
#ifdef __EMSCRIPTEN__
static_assert(sizeof(HEVCFrame) == 48, "HEVCFrame layout changed — update decoder.ts and worker.ts");
#endif

extern "C" {

HEVCDecoder* hevc_decoder_create(void) {
    return new (std::nothrow) HEVCDecoder();
}

void hevc_decoder_destroy(HEVCDecoder* dec) {
    delete dec;
}

int hevc_decoder_decode(HEVCDecoder* dec, const uint8_t* data, size_t size) {
    if (!dec || !data || size == 0) return HEVC_ERROR;

    try {
        auto status = dec->decoder.decode(data, size);
        if (status != hevc::DecodeStatus::OK) return HEVC_ERROR;

        dec->output = dec->decoder.output_pictures();
        return HEVC_OK;
    } catch (...) {
        // Catch C++ exceptions (e.g. BitstreamReader read past end on multi-slice)
        // Still return partial results if any frames were decoded
        dec->output = dec->decoder.output_pictures();
        return dec->output.empty() ? HEVC_ERROR : HEVC_OK;
    }
}

int hevc_decoder_get_frame_count(HEVCDecoder* dec) {
    if (!dec) return 0;
    return static_cast<int>(dec->output.size());
}

int hevc_decoder_get_frame(HEVCDecoder* dec, int index, HEVCFrame* frame) {
    if (!dec || !frame || index < 0 || index >= static_cast<int>(dec->output.size()))
        return HEVC_ERROR;

    const auto* pic = dec->output[index];
    int sub_w = hevc::SubWidthC(pic->chroma_format);
    int sub_h = hevc::SubHeightC(pic->chroma_format);

    // Cropped dimensions
    int crop_w = pic->pic_width_in_luma - pic->conf_win_left - pic->conf_win_right;
    int crop_h = pic->pic_height_in_luma - pic->conf_win_top - pic->conf_win_bottom;

    // Plane pointers offset by conformance window
    int y_offset = pic->conf_win_top * pic->stride[0] + pic->conf_win_left;
    int c_offset = (pic->conf_win_top / sub_h) * pic->stride[1] +
                   (pic->conf_win_left / sub_w);

    frame->y  = pic->planes[0].data() + y_offset;
    frame->cb = pic->planes[1].data() + c_offset;
    frame->cr = pic->planes[2].data() + c_offset;
    frame->width = crop_w;
    frame->height = crop_h;
    frame->stride_y = pic->stride[0];
    frame->stride_c = pic->stride[1];
    frame->chroma_width = crop_w / sub_w;
    frame->chroma_height = crop_h / sub_h;
    frame->bit_depth = pic->bit_depth_luma;
    frame->poc = pic->poc;
    frame->cvs_id = pic->cvs_id;

    return HEVC_OK;
}

// --- Incremental API ---

int hevc_decoder_feed(HEVCDecoder* dec, const uint8_t* data, size_t size) {
    if (!dec || !data || size == 0) return HEVC_ERROR;

    try {
        auto status = dec->decoder.feed(data, size);
        return (status == hevc::DecodeStatus::OK) ? HEVC_OK : HEVC_ERROR;
    } catch (...) {
        return HEVC_ERROR;
    }
}

int hevc_decoder_drain(HEVCDecoder* dec, int* count) {
    if (!dec || !count) return HEVC_ERROR;

    try {
        dec->drained = dec->decoder.drain();
        *count = static_cast<int>(dec->drained.size());
        return HEVC_OK;
    } catch (...) {
        *count = 0;
        return HEVC_ERROR;
    }
}

int hevc_decoder_get_drained_frame(HEVCDecoder* dec, int index, HEVCFrame* frame) {
    if (!dec || !frame || index < 0 || index >= static_cast<int>(dec->drained.size()))
        return HEVC_ERROR;

    const auto* pic = dec->drained[index];
    int sub_w = hevc::SubWidthC(pic->chroma_format);
    int sub_h = hevc::SubHeightC(pic->chroma_format);

    int crop_w = pic->pic_width_in_luma - pic->conf_win_left - pic->conf_win_right;
    int crop_h = pic->pic_height_in_luma - pic->conf_win_top - pic->conf_win_bottom;

    int y_offset = pic->conf_win_top * pic->stride[0] + pic->conf_win_left;
    int c_offset = (pic->conf_win_top / sub_h) * pic->stride[1] +
                   (pic->conf_win_left / sub_w);

    frame->y  = pic->planes[0].data() + y_offset;
    frame->cb = pic->planes[1].data() + c_offset;
    frame->cr = pic->planes[2].data() + c_offset;
    frame->width = crop_w;
    frame->height = crop_h;
    frame->stride_y = pic->stride[0];
    frame->stride_c = pic->stride[1];
    frame->chroma_width = crop_w / sub_w;
    frame->chroma_height = crop_h / sub_h;
    frame->bit_depth = pic->bit_depth_luma;
    frame->poc = pic->poc;
    frame->cvs_id = pic->cvs_id;

    return HEVC_OK;
}

int hevc_decoder_flush(HEVCDecoder* dec) {
    if (!dec) return HEVC_ERROR;

    try {
        dec->drained = dec->decoder.flush();
        return HEVC_OK;
    } catch (...) {
        return HEVC_ERROR;
    }
}

int hevc_decoder_get_suppressed_picture_count(HEVCDecoder* dec) {
    if (!dec) return 0;
    // Buffer the list here: the count and the copy are two calls, and
    // Decoder::take_suppressed_pictures() empties its own list.
    auto fresh = dec->decoder.take_suppressed_pictures();
    dec->suppressed.insert(dec->suppressed.end(), fresh.begin(), fresh.end());
    return static_cast<int>(dec->suppressed.size());
}

int hevc_decoder_take_suppressed_pictures(HEVCDecoder* dec, int32_t* out, int max) {
    if (!dec || !out || max < 0) return HEVC_ERROR;

    auto fresh = dec->decoder.take_suppressed_pictures();
    dec->suppressed.insert(dec->suppressed.end(), fresh.begin(), fresh.end());

    const int count = static_cast<int>(dec->suppressed.size());
    if (max < count) return HEVC_ERROR;

    // Two int32_t per picture: cvs_id then poc, in decode order
    for (int i = 0; i < count; i++) {
        out[2 * i]     = dec->suppressed[i].cvs_id;
        out[2 * i + 1] = dec->suppressed[i].poc;
    }
    dec->suppressed.clear();
    return count;
}

int hevc_decoder_get_info(HEVCDecoder* dec, HEVCStreamInfo* info) {
    if (!dec || !info || dec->output.empty()) return HEVC_ERROR;

    const auto* pic = dec->output[0];
    info->width = pic->pic_width_in_luma - pic->conf_win_left - pic->conf_win_right;
    info->height = pic->pic_height_in_luma - pic->conf_win_top - pic->conf_win_bottom;
    info->bit_depth = pic->bit_depth_luma;
    info->chroma_format = static_cast<int>(pic->chroma_format);
    info->profile = 0;
    info->level = 0;

    return HEVC_OK;
}

} // extern "C"
