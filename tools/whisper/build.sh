#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git -c advice.detachedHead=false clone --quiet --depth 1 --branch v1.8.3 \
  https://github.com/ggml-org/whisper.cpp "$work/whisper.cpp"
# Run one thread inside a Web Worker so static hosting needs no isolation headers.
sed '/set(CMAKE_.*-pthread")/d' "$work/whisper.cpp/CMakeLists.txt" > "$work/CMakeLists.txt"
mv "$work/CMakeLists.txt" "$work/whisper.cpp/CMakeLists.txt"

emcmake cmake -S "$root/tools/whisper" -B "$work/build" \
  -DWHISPER_SOURCE="$work/whisper.cpp" -DCMAKE_BUILD_TYPE=Release
cmake --build "$work/build" --target whisper-runtime --parallel 4

mkdir -p "$root/assets/whisper"
cp "$work/build/whisper-runtime.js" "$work/build/whisper-runtime.wasm" "$root/assets/whisper/"
chmod 644 "$root/assets/whisper/whisper-runtime.wasm"
cp "$work/whisper.cpp/LICENSE" "$root/assets/whisper/LICENSE"
