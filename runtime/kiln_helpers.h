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

/** Append each new subject value to a chart series, so the chart shows its history. */
lv_observer_t * kiln_chart_bind_series(lv_obj_t * chart, lv_chart_series_t * series, lv_subject_t * subject);

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*KILN_HELPERS_H*/
