/* Freestanding stand-in for <inttypes.h>: wasm32 has no libc, LVGL only needs the format macros. */
#ifndef KILN_INTTYPES_H
#define KILN_INTTYPES_H

#include <stdint.h>

#define PRId32 "d"
#define PRIi32 "i"
#define PRIu32 "u"
#define PRIx32 "x"
#define PRIX32 "X"
#define PRId64 "lld"
#define PRIu64 "llu"
#define PRIx64 "llx"
#define PRIX64 "llX"
#define PRIdPTR "ld"
#define PRIuPTR "lu"
#define PRIxPTR "lx"

#endif
