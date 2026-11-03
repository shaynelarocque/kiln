/**
 * kiln_helpers: the few LVGL glue functions Kiln's generated code needs.
 * The same file is compiled into the editor preview and copied into every export,
 * so an animation or binding behaves the same on the canvas and on the board.
 */
#ifndef KILN_HELPERS_H
#define KILN_HELPERS_H

#ifdef __cplusplus
extern "C" {
#endif

#include "lvgl.h"

/** Make `a` animate a numeric style prop on its var (opa, translate_x, transform_rotation, ...). */
void kiln_anim_set_style(lv_anim_t * a, lv_style_prop_t prop);

/** Make `a` animate the uniform transform scale (256 = 100%). */
void kiln_anim_set_scale(lv_anim_t * a);

/** Make `a` fade a colour prop (bg, text or border colour) from one 0xRRGGBB to another. Sets the values too. */
void kiln_anim_set_color(lv_anim_t * a, lv_style_prop_t prop, uint32_t from, uint32_t to);

/** Like lv_obj_bind_style_prop, but maps the subject from [in_min, in_max] to [out_min, out_max] first. */
lv_observer_t * kiln_bind_style_map(lv_obj_t * obj, lv_style_prop_t prop, lv_style_selector_t selector,
                                    lv_subject_t * subject, int32_t in_min, int32_t in_max,
                                    int32_t out_min, int32_t out_max);

typedef enum { KILN_EQ, KILN_NOT_EQ, KILN_GT, KILN_GE, KILN_LT, KILN_LE } kiln_compare_t;

/** Sets a flag (LV_OBJ_FLAG_HIDDEN or LV_OBJ_FLAG_CLICKABLE) while `subject <op> ref` holds, clears it otherwise. */
lv_observer_t * kiln_bind_flag_if(lv_obj_t * obj, lv_subject_t * subject, lv_obj_flag_t flag, kiln_compare_t op, int32_t ref);

/** Adds a state while `subject <op> ref` holds, removes it otherwise. */
lv_observer_t * kiln_bind_state_if(lv_obj_t * obj, lv_subject_t * subject, lv_state_t state, kiln_compare_t op, int32_t ref);

/**
 * Plays a timeline from its start (or, reversed, from its end) after `delay` ms whenever `trigger`
 * fires, like re-triggering a CSS animation. LVGL's own play event only applies the delay to a
 * restart of a finished timeline.
 */
void kiln_obj_add_play_event(lv_obj_t * obj, lv_event_code_t trigger, lv_anim_timeline_t * at, uint32_t delay, bool reverse);

/**
 * A TinyTTF font at `px` from a TTF/OTF file in memory, borrowing the glyphs it lacks (LVGL's
 * symbols) from `fallback`, which may be NULL. LVGL's default font if TinyTTF can't make it.
 */
const lv_font_t * kiln_tiny_ttf(const void * data, size_t size, int32_t px, size_t cache, const lv_font_t * fallback);

/** Append each new subject value to a chart series, so the chart shows its history. */
lv_observer_t * kiln_chart_bind_series(lv_obj_t * chart, lv_chart_series_t * series, lv_subject_t * subject);

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*KILN_HELPERS_H*/
