/* Kiln preview runtime: LVGL compiled to wasm32.
 * Matches the firmware defaults (RGB565, no OS, no float) so the canvas shows what the panel shows.
 * Anything not set here falls back to lv_conf_internal.h defaults. */
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_FORMAT_DEFAULT LV_COLOR_FORMAT_RGB565

#define LV_USE_STDLIB_MALLOC LV_STDLIB_BUILTIN
#define LV_USE_STDLIB_STRING LV_STDLIB_BUILTIN
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_BUILTIN
#define LV_MEM_SIZE (96 * 1024 * 1024)
#define LV_INTTYPES_INCLUDE "kiln_inttypes.h"

#define LV_USE_OS LV_OS_NONE
#define LV_DEF_REFR_PERIOD 16
#define LV_USE_FLOAT 0
#define LV_USE_OBSERVER 1
#define LV_USE_SNAPSHOT 0

#define LV_USE_LOG 1
#define LV_LOG_LEVEL LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF 0

/* A failed assert traps, which surfaces in JS as a RuntimeError instead of hanging the editor. */
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1
#define LV_USE_ASSERT_OBJ 1
#define LV_USE_ASSERT_STYLE 1
#define LV_ASSERT_HANDLER __builtin_trap();

/* Every built-in font, so any size picked in the inspector renders. Export enables only the used ones. */
#define LV_FONT_MONTSERRAT_8 1
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_18 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_22 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_26 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_30 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_MONTSERRAT_34 1
#define LV_FONT_MONTSERRAT_36 1
#define LV_FONT_MONTSERRAT_38 1
#define LV_FONT_MONTSERRAT_40 1
#define LV_FONT_MONTSERRAT_42 1
#define LV_FONT_MONTSERRAT_44 1
#define LV_FONT_MONTSERRAT_46 1
#define LV_FONT_MONTSERRAT_48 1
#define LV_FONT_UNSCII_8 1
#define LV_FONT_UNSCII_16 1

/* Imported TTF/OTF fonts, drawn by the same TinyTTF the board runs. */
#define LV_USE_TINY_TTF 1
#define LV_TINY_TTF_FILE_SUPPORT 0

/* stb_truetype (inside TinyTTF) takes these from libc, which wasm32 doesn't have. floor, ceil, sqrt
 * and fabs are wasm instructions. pow, fmod, cos, acos and rect packing only appear in stb's SDF and
 * atlas code, which TinyTTF never calls, so -O2 drops them; if that changes, the link fails on pow. */
#define STBTT_ifloor(x) ((int)__builtin_floor(x))
#define STBTT_iceil(x) ((int)__builtin_ceil(x))
#define STBTT_sqrt(x) ((float)__builtin_sqrt(x))
#define STBTT_pow(x, y) __builtin_pow(x, y)
#define STBTT_fmod(x, y) __builtin_fmod(x, y)
#define STBTT_cos(x) __builtin_cos(x)
#define STBTT_acos(x) __builtin_acos(x)
#define STBTT_fabs(x) ((float)__builtin_fabs(x))
#define STBTT_assert(x) LV_ASSERT(x)
#define STBTT_strlen(x) lv_strlen(x)
#define STBTT_memcpy lv_memcpy
#define STBTT_memset lv_memset
#define STBRP_SORT(base, n, size, cmp) __builtin_trap()
#define STBRP_ASSERT(x) LV_ASSERT(x)

#endif /*LV_CONF_H*/
