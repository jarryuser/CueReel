cmake_minimum_required(VERSION 3.16)
project(cuereel_whisper LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "")
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "")
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "")
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "")
set(GGML_OPENMP OFF CACHE BOOL "")
add_compile_options(-msimd128)
add_subdirectory("${WHISPER_SOURCE}" whisper)

add_executable(whisper-runtime bindings.cpp)
target_link_libraries(whisper-runtime PRIVATE whisper)
target_link_options(whisper-runtime PRIVATE
  --bind -msimd128
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5242880
)
