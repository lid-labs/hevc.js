cmake_minimum_required(VERSION 3.16)
project(hevc-decode VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Options
option(BUILD_TESTS "Build unit tests" ON)
option(BUILD_WASM "Build WebAssembly target" OFF)
option(HEVC_DEBUG "Enable debug logging" OFF)

# Warnings
add_compile_options(-Wall -Wextra -Wpedantic -Werror)

# Debug : AddressSanitizer
if(CMAKE_BUILD_TYPE STREQUAL "Debug" AND NOT BUILD_WASM)
    add_compile_options(-fsanitize=address -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address)
endif()

# Debug logging
if(HEVC_DEBUG OR CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_compile_definitions(HEVC_DEBUG=1)
endif()

# Library
add_library(hevc-decode-lib
    src/bitstream/bitstream_reader.cpp
    src/bitstream/nal_parser.cpp
    src/common/picture.cpp
    src/common/thread_pool.cpp
    src/syntax/profile_tier_level.cpp
    src/syntax/vps.cpp
    src/syntax/sps.cpp
    src/syntax/pps.cpp
    src/syntax/slice_header.cpp
    src/syntax/parameter_sets.cpp
    src/decoding/cabac.cpp
    src/decoding/syntax_elements.cpp
    src/decoding/coding_tree.cpp
    src/decoding/residual_coding.cpp
    src/decoding/transform.cpp
    src/decoding/intra_prediction.cpp
    src/decoding/inter_prediction.cpp
    src/decoding/interpolation.cpp
    src/decoding/dpb.cpp
    src/decoding/decoder.cpp
    src/filters/deblocking.cpp
    src/filters/sao.cpp
    src/wasm/hevc_api.cpp
)

target_include_directories(hevc-decode-lib PUBLIC
    ${CMAKE_SOURCE_DIR}/src
)

# CLI executable
add_executable(hevc-decode
    src/main.cpp
)

target_link_libraries(hevc-decode PRIVATE hevc-decode-lib)

# WASM-specific settings
if(BUILD_WASM)
    # WASM target: build the C API as a JS+WASM module (not the CLI)
    add_executable(hevc-wasm src/wasm/hevc_api.cpp)
    target_link_libraries(hevc-wasm PRIVATE hevc-decode-lib)
    set_target_properties(hevc-wasm PROPERTIES
        OUTPUT_NAME "hevc-decode"
        SUFFIX ".js"
    )
    # Enable exceptions + SIMD 128-bit for the whole project in WASM mode
    target_compile_options(hevc-decode-lib PRIVATE -fexceptions -msimd128)
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        target_compile_options(hevc-wasm PRIVATE -O0 -g -fexceptions -msimd128)
    else()
        target_compile_options(hevc-wasm PRIVATE -O3 -fexceptions -msimd128)
    endif()
    target_link_options(hevc-wasm PRIVATE
        "SHELL:-s WASM=1"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_NAME=HEVCDecoderModule"
        "SHELL:-s STACK_SIZE=4194304"
        "SHELL:-s ASSERTIONS=1"
        "SHELL:-s NO_DISABLE_EXCEPTION_CATCHING=1"
        "SHELL:-s EXPORTED_FUNCTIONS=[_hevc_decoder_create,_hevc_decoder_destroy,_hevc_decoder_decode,_hevc_decoder_get_frame_count,_hevc_decoder_get_frame,_hevc_decoder_get_info,_hevc_decoder_feed,_hevc_decoder_drain,_hevc_decoder_get_drained_frame,_hevc_decoder_flush,_malloc,_free]"
        "SHELL:-s EXPORTED_RUNTIME_METHODS=[ccall,cwrap,getValue,HEAPU8,HEAPU16]"
    )
    # Don't build the native CLI in WASM mode
    set_target_properties(hevc-decode PROPERTIES EXCLUDE_FROM_ALL TRUE)
endif()

# Tests
if(BUILD_TESTS AND NOT BUILD_WASM)
    include(FetchContent)
    FetchContent_Declare(
        googletest
        GIT_REPOSITORY https://github.com/google/googletest.git
        GIT_TAG v1.14.0
    )
    FetchContent_MakeAvailable(googletest)

    enable_testing()

    add_executable(hevc_tests
        tests/unit/test_bitstream_reader.cpp
        tests/unit/test_nal_parser.cpp
        tests/unit/test_picture.cpp
        tests/unit/test_parameter_sets.cpp
        tests/unit/test_cabac.cpp
        tests/unit/test_incremental.cpp
        tests/unit/test_ref_pic_lists.cpp
    )

    target_link_libraries(hevc_tests PRIVATE
        hevc-decode-lib
        GTest::gtest_main
    )

    target_compile_definitions(hevc_tests PRIVATE
        FIXTURES_DIR="${CMAKE_SOURCE_DIR}/tests/conformance/fixtures"
    )

    include(GoogleTest)
    # A non-terminating decode loop must fail the suite, not stall it.
    gtest_discover_tests(hevc_tests PROPERTIES TIMEOUT 120)

    # Oracle tests — compare decoded YUV MD5 against reference
    # These tests require the decoder to produce YUV output (-o flag)
    # They are labeled "oracle" so they can be run separately: ctest -L oracle
    set(FIXTURES_DIR "${CMAKE_SOURCE_DIR}/tests/conformance/fixtures")
    set(ORACLE_SCRIPT "${CMAKE_SOURCE_DIR}/tools/oracle_test.sh")

    # All oracle tests skip gracefully when decoder can't produce output yet
    # Exit code 2 = SKIP (decoder not implemented for this feature)

    # Toy bitstreams — ultra-simple for step-by-step debugging (64x64, 1 CTU)
    add_test(NAME oracle_toy_qp30
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/toy_qp30.265 64 64
            9f59878470d904dc2e162d3d191611af $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_toy_qp30 PROPERTIES LABELS "oracle;phase4;toy"
        SKIP_RETURN_CODE 2)

    add_test(NAME oracle_toy_qp45
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/toy_qp45.265 64 64
            52ca5108bd4354383a9d29d96cf64b47 $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_toy_qp45 PROPERTIES LABELS "oracle;phase4;toy"
        SKIP_RETURN_CODE 2)

    add_test(NAME oracle_toy_qp10
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/toy_qp10.265 64 64
            ff469ce7e872152490b9b39b0d05dd7b $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_toy_qp10 PROPERTIES LABELS "oracle;phase4;toy"
        SKIP_RETURN_CODE 2)

    # Phase 4 — I-only, no filters
    add_test(NAME oracle_i_64x64_qp22
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/i_64x64_qp22.265 64 64
            48c64cd2de381113913149e92065d66c $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_i_64x64_qp22 PROPERTIES LABELS "oracle;phase4"
        SKIP_RETURN_CODE 2)

    # Phase 5 — P-frames, no filters
    add_test(NAME oracle_p_qcif_10f
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/p_qcif_10f.265 176 144
            921650ab84b8e366a1aa4e16f2527e46 $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_p_qcif_10f PROPERTIES LABELS "oracle;phase5"
        SKIP_RETURN_CODE 2)

    # Phase 5 — B-frames, no filters
    add_test(NAME oracle_b_qcif_10f
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/b_qcif_10f.265 176 144
            dffe2712c0561c75ee40256d59299826 $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_b_qcif_10f PROPERTIES LABELS "oracle;phase5"
        SKIP_RETURN_CODE 2)

    # Phase 6 — I-frame with deblocking only
    add_test(NAME oracle_i_64x64_deblock
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/i_64x64_deblock.265 64 64
            576ef497ceedffa01709ddfaa13c76c3 $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_i_64x64_deblock PROPERTIES LABELS "oracle;phase6"
        SKIP_RETURN_CODE 2)

    # Phase 6 — I-frame with SAO only
    add_test(NAME oracle_i_64x64_sao
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/i_64x64_sao.265 64 64
            eacb4952591daa891e8dc5344c6c34ee $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_i_64x64_sao PROPERTIES LABELS "oracle;phase6"
        SKIP_RETURN_CODE 2)

    # Phase 6 — I-frame with deblocking + SAO
    add_test(NAME oracle_i_64x64_full
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/i_64x64_full.265 64 64
            dcb7ae02b4514b6e7fd801ae691d901a $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_i_64x64_full PROPERTIES LABELS "oracle;phase6"
        SKIP_RETURN_CODE 2)

    # Phase 6 — Full pipeline (B-frames + deblocking + SAO) = Main profile milestone
    add_test(NAME oracle_full_qcif_10f
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/full_qcif_10f.265 176 144
            a4984ee61d18ac9619808c5338132eaa $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_full_qcif_10f PROPERTIES LABELS "oracle;phase6;milestone"
        SKIP_RETURN_CODE 2)

    # Real-world bitstreams — Big Buck Bunny (Main profile, full pipeline)
    add_test(NAME oracle_bbb1080_50f
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/bbb1080_50f.265 1920 1080
            a7c12e24701e3636ce58246033bff6ed $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_bbb1080_50f PROPERTIES LABELS "oracle;phase6;realworld"
        SKIP_RETURN_CODE 2)

    add_test(NAME oracle_bbb4k_25f
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/bbb4k_25f.265 3840 2160
            69f2ba71153ec5f3c1573fed17631ed4 $<TARGET_FILE:hevc-decode>)
    set_tests_properties(oracle_bbb4k_25f PROPERTIES LABELS "oracle;phase6;realworld"
        SKIP_RETURN_CODE 2)

    # Phase 7 — 10-bit (Main 10 profile)
    add_test(NAME oracle_i_64x64_10bit
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/i_64x64_10bit.265 64 64
            230cf887beecf0dc1722a823f998de47 $<TARGET_FILE:hevc-decode> yuv420p10le)
    set_tests_properties(oracle_i_64x64_10bit PROPERTIES LABELS "oracle;phase7;main10"
        SKIP_RETURN_CODE 2)

    add_test(NAME oracle_full_qcif_10f_10bit
        COMMAND ${ORACLE_SCRIPT} ${FIXTURES_DIR}/full_qcif_10f_10bit.265 176 144
            19efbf36509c6ecb86e42a7f709998b5 $<TARGET_FILE:hevc-decode> yuv420p10le)
    set_tests_properties(oracle_full_qcif_10f_10bit PROPERTIES LABELS "oracle;phase7;main10;milestone"
        SKIP_RETURN_CODE 2)

    # Edge-case conformance tests (generated by tools/fetch_conformance.sh)
    if(EXISTS "${CMAKE_SOURCE_DIR}/tests/conformance/edge-cases/manifest.cmake")
        include("${CMAKE_SOURCE_DIR}/tests/conformance/edge-cases/manifest.cmake")
    endif()
endif()
