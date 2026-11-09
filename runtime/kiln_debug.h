/**
 * kiln-debug: what Kiln's Debug build adds (the kiln_debug PlatformIO env, -D KILN_DEBUG).
 *
 * It traces what the UI does over serial, one "@K <ms> <what> ..." line each: taps, screen
 * loads, animations with their designed timing, variable changes and frame times. And it takes
 * "@K <command>" lines that tap widgets, set variables and load screens, so Kiln can replay an
 * automation on the board and time it. See kiln_debug.cpp.
 *
 * A normal build compiles none of it: without KILN_DEBUG these calls are empty.
 */
#ifndef KILN_DEBUG_H
#define KILN_DEBUG_H

#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

#ifdef KILN_DEBUG
/** Hooks the UI's objects, variables and display, after ui_init(). Prints "@K <ms> ready". */
void kiln_debug_init(void);
/** Reads commands, releases taps and reports finished animations and frame times. Every loop. */
void kiln_debug_poll(void);
/** kiln_helpers.c calls this when it starts a timeline. */
void kiln_debug_played(lv_anim_timeline_t * at, uint32_t delay);
#else
static inline void kiln_debug_init(void) {}
static inline void kiln_debug_poll(void) {}
#endif

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*KILN_DEBUG_H*/
