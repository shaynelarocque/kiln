#!/bin/bash
# kiln-debug on this machine instead of a board: LVGL, an exported project's UI and kiln-debug,
# compiled natively with a stand-in for Arduino (shim/), as $OUT/kd-host. Run it with "@K …"
# commands as arguments and it prints what a Debug build would over serial.
#
#   build.sh EXPORTED_PROJECT OUT_DIR
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
E="$(cd "$1" && pwd)"
OUT="$2"
LV="$HERE/../lvgl"
mkdir -p "$OUT/obj" "$OUT/conf"
# the export's lv_conf.h, with a host-sized heap and LVGL's logging quiet: memory isn't under test
cat > "$OUT/conf/lv_conf.h" <<CONF
#include "$E/include/lv_conf.h"
#undef LV_MEM_SIZE
#define LV_MEM_SIZE (16 * 1024 * 1024)
#undef LV_LOG_LEVEL
#define LV_LOG_LEVEL LV_LOG_LEVEL_NONE
CONF
FLAGS=(-O1 -DLV_CONF_INCLUDE_SIMPLE -DKILN_DEBUG "-I$OUT/conf" "-I$E/include" "-I$LV" "-I$E/src" "-I$HERE/shim" -w)
export FLAGSTR="${FLAGS[*]}" OBJ="$OUT/obj"
# LVGL once per output folder; the UI and kiln-debug every time
find "$LV/src" -name '*.c' | xargs -P 10 -n 1 sh -c \
  'o="$OBJ/lv_$(echo "$0" | cksum | cut -d" " -f1).o"; [ -f "$o" ] || cc $FLAGSTR -c "$0" -o "$o"'
rm -f "$OUT"/obj/ui_*.o
for f in "$E"/src/ui/*.c; do cc "${FLAGS[@]}" -c "$f" -o "$OUT/obj/ui_$(basename "$f").o"; done
c++ -std=c++17 "${FLAGS[@]}" -c "$E/src/kiln_debug.cpp" -o "$OUT/obj/kiln_debug.o"
c++ -std=c++17 "${FLAGS[@]}" -c "$HERE/host.cpp" -o "$OUT/obj/host.o"
c++ "$OUT"/obj/*.o -o "$OUT/kd-host"
