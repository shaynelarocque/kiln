#!/bin/sh
# Builds the LVGL preview runtime into src/shared/lvgl/runtime/kiln-rt.wasm.
# Needs a clang with the wasm32 backend (Xcode 26+ or Homebrew llvm) and wasm-ld
# (Homebrew lld, or the rust-lld that ships with every rustup toolchain).
set -eu
cd "$(dirname "$0")"

LVGL_TAG=v9.6.0
[ -d lvgl ] || git clone --depth 1 --branch "$LVGL_TAG" https://github.com/lvgl/lvgl.git lvgl

CC=${CC:-clang}
if [ -z "${WASM_LD:-}" ]; then
  if command -v wasm-ld >/dev/null; then WASM_LD="wasm-ld"
  else
    HOST=$(rustc -vV | sed -n 's/^host: //p')
    WASM_LD="$(rustc --print sysroot)/lib/rustlib/$HOST/bin/rust-lld -flavor wasm"
  fi
fi

node gen-consts.mjs

OUT=build/obj
mkdir -p "$OUT"
CFLAGS="--target=wasm32 -O2 -ffreestanding -nostdlib -mbulk-memory -fvisibility=default
  -DLV_CONF_INCLUDE_SIMPLE -I. -Ilibc -Ilvgl -w"

# Compile LVGL in parallel; files for disabled features compile to empty objects.
export CC CFLAGS OUT
find lvgl/src -name '*.c' | xargs -P "$(sysctl -n hw.ncpu 2>/dev/null || nproc)" -n 1 sh -c '
  obj="$OUT/$(echo "${1#lvgl/src/}" | tr / _).o"
  if [ ! "$obj" -nt "$1" ] || [ ! "$obj" -nt lv_conf.h ]; then $CC $CFLAGS -c "$1" -o "$obj"; fi' _

$CC $CFLAGS -c kiln_helpers.c -o build/kiln_helpers.o
$CC $CFLAGS -c kiln_rt.c -o build/kiln_rt.o

DEST=../src/shared/lvgl/runtime
mkdir -p "$DEST"
$WASM_LD --no-entry --export-dynamic --gc-sections -z stack-size=1048576 \
  -o "$DEST/kiln-rt.wasm" build/kiln_rt.o build/kiln_helpers.o "$OUT"/*.o
echo "built $DEST/kiln-rt.wasm ($(wc -c < "$DEST/kiln-rt.wasm" | tr -d ' ') bytes)"
