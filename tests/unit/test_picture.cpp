#include <gtest/gtest.h>
#include "common/picture.h"
#include <cstdio>
#include <fstream>

using namespace hevc;

TEST(Picture, Allocate420) {
    Picture pic;
    pic.allocate(64, 64, ChromaFormat::YUV420, 8, 8);

    EXPECT_EQ(pic.width[0], 64);
    EXPECT_EQ(pic.height[0], 64);
    EXPECT_EQ(pic.stride[0], 64);
    EXPECT_EQ(pic.plane_size(0), 64u * 64);

    // Chroma is half in both dimensions for 4:2:0
    EXPECT_EQ(pic.width[1], 32);
    EXPECT_EQ(pic.height[1], 32);
    EXPECT_EQ(pic.stride[1], 32);
    EXPECT_EQ(pic.plane_size(1), 32u * 32);
    EXPECT_EQ(pic.plane_size(2), 32u * 32);
}

TEST(Picture, Allocate422) {
    Picture pic;
    pic.allocate(64, 64, ChromaFormat::YUV422, 8, 8);

    EXPECT_EQ(pic.width[1], 32);   // half width
    EXPECT_EQ(pic.height[1], 64);  // full height
}

TEST(Picture, Allocate444) {
    Picture pic;
    pic.allocate(64, 64, ChromaFormat::YUV444, 8, 8);

    EXPECT_EQ(pic.width[1], 64);
    EXPECT_EQ(pic.height[1], 64);
}

TEST(Picture, AllocateMonochrome) {
    Picture pic;
    pic.allocate(64, 64, ChromaFormat::MONOCHROME, 8, 8);

    EXPECT_EQ(pic.plane_size(0), 64u * 64);
    EXPECT_EQ(pic.plane_size(1), 0u);
    EXPECT_EQ(pic.plane_size(2), 0u);
}

// 8-bit luma and chroma take one byte per sample; any other depth two.
TEST(Picture, StorageFollowsBitDepth) {
    Picture p8, p10, mixed;
    p8.allocate(16, 16, ChromaFormat::YUV420, 8, 8);
    p10.allocate(16, 16, ChromaFormat::YUV420, 10, 10);
    mixed.allocate(16, 16, ChromaFormat::YUV420, 8, 10);
    EXPECT_TRUE(p8.eight_bit);
    EXPECT_EQ(p8.planes8[0].size(), 16u * 16);
    EXPECT_TRUE(p8.planes16[0].empty());
    EXPECT_FALSE(p10.eight_bit);
    EXPECT_EQ(p10.planes16[0].size(), 16u * 16);
    EXPECT_TRUE(p10.planes8[0].empty());
    EXPECT_FALSE(mixed.eight_bit);
    p10.set(0, 3, 2, 1023);
    EXPECT_EQ(p10.get(0, 3, 2), 1023);
}

TEST(Picture, SampleAccess) {
    Picture pic;
    pic.allocate(16, 16, ChromaFormat::YUV420, 8, 8);

    pic.set(0, 5, 3, 128);
    EXPECT_EQ(pic.get(0, 5, 3), 128);

    pic.set(1, 2, 1, 200);
    EXPECT_EQ(pic.get(1, 2, 1), 200);
}

TEST(Picture, ZeroInitialized) {
    Picture pic;
    pic.allocate(16, 16, ChromaFormat::YUV420, 8, 8);

    for (int c = 0; c < 3; c++)
        for (int y = 0; y < pic.height[c]; y++)
            for (int x = 0; x < pic.width[c]; x++)
                EXPECT_EQ(pic.get(c, x, y), 0);
}

TEST(Picture, WriteYuv8bit) {
    Picture pic;
    pic.allocate(4, 4, ChromaFormat::YUV420, 8, 8);

    // Fill luma with gradient
    for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++)
            pic.set(0, x, y, y * 4 + x);

    // Fill chroma with constants
    for (int y = 0; y < 2; y++)
        for (int x = 0; x < 2; x++) {
            pic.set(1, x, y, 128);
            pic.set(2, x, y, 64);
        }

    const char* path = "/tmp/test_picture.yuv";
    ASSERT_TRUE(pic.write_yuv(path));

    // Verify file size: 4*4 (Y) + 2*2 (Cb) + 2*2 (Cr) = 24 bytes
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    EXPECT_EQ(f.tellg(), 24);

    // Verify first luma byte
    f.seekg(0);
    uint8_t first;
    f.read(reinterpret_cast<char*>(&first), 1);
    EXPECT_EQ(first, 0);

    // Verify last luma byte (4*4-1 = 15)
    f.seekg(15);
    uint8_t last_luma;
    f.read(reinterpret_cast<char*>(&last_luma), 1);
    EXPECT_EQ(last_luma, 15);

    // Verify first Cb byte (offset 16)
    f.seekg(16);
    uint8_t cb;
    f.read(reinterpret_cast<char*>(&cb), 1);
    EXPECT_EQ(cb, 128);

    std::remove(path);
}
