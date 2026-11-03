/**
 * kiln_rt: wasm entry points for the editor preview.
 *
 * Every LVGL function is exported, so JS calls most of the API directly by name.
 * This file only covers what the wasm C ABI can't express from JS: displays that
 * render into an RGBA buffer for <canvas>, pointer input, colours and style values
 * passed by value, function pointers, and enum constants looked up by name.
 */
#include "lvgl.h"
#include "kiln_helpers.h"
#include "lvgl/src/misc/cache/instance/lv_image_cache.h" /* private header: no public way to drop a cached image */

#define EXPORT __attribute__((visibility("default")))
#define IMPORT(name) __attribute__((import_module("env"), import_name(name)))

IMPORT("kiln_log") void js_log(const char * msg);

/* The compiler still emits these for struct copies in a freestanding build. */
void * memcpy(void * dst, const void * src, size_t n)
{
    __builtin_memcpy(dst, src, n);
    return dst;
}
void * memset(void * dst, int c, size_t n)
{
    __builtin_memset(dst, c, n);
    return dst;
}
void * memmove(void * dst, const void * src, size_t n)
{
    __builtin_memmove(dst, src, n);
    return dst;
}

/*---------- displays ----------*/

typedef struct {
    uint8_t * rgba;
    void * fb;
    int32_t w, h;
    lv_area_t dirty;
    bool has_dirty;
} view_t;

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    view_t * v = lv_display_get_driver_data(disp);
    for(int32_t y = area->y1; y <= area->y2; y++) {
        const uint16_t * src = (const uint16_t *)(px_map + y * v->w * 2) + area->x1;
        uint8_t * dst = v->rgba + (y * v->w + area->x1) * 4;
        for(int32_t x = area->x1; x <= area->x2; x++) {
            uint16_t c = *src++;
            uint8_t r = c >> 11, g = (c >> 5) & 0x3F, b = c & 0x1F;
            dst[0] = (uint8_t)(r << 3 | r >> 2);
            dst[1] = (uint8_t)(g << 2 | g >> 4);
            dst[2] = (uint8_t)(b << 3 | b >> 2);
            dst[3] = 255;
            dst += 4;
        }
    }
    if(v->has_dirty) {
        v->dirty.x1 = LV_MIN(v->dirty.x1, area->x1);
        v->dirty.y1 = LV_MIN(v->dirty.y1, area->y1);
        v->dirty.x2 = LV_MAX(v->dirty.x2, area->x2);
        v->dirty.y2 = LV_MAX(v->dirty.y2, area->y2);
    }
    else {
        v->dirty = *area;
        v->has_dirty = true;
    }
    lv_display_flush_ready(disp);
}

static void log_cb(lv_log_level_t level, const char * buf)
{
    LV_UNUSED(level);
    js_log(buf);
}

EXPORT void kiln_init(void)
{
    lv_init();
    lv_log_register_print_cb(log_cb);
}

EXPORT lv_display_t * kiln_display_create(int32_t w, int32_t h)
{
    lv_display_t * disp = lv_display_create(w, h);
    view_t * v = lv_malloc_zeroed(sizeof(view_t));
    v->w = w;
    v->h = h;
    v->rgba = lv_malloc_zeroed(w * h * 4);
    v->fb = lv_malloc(w * h * 2);
    lv_display_set_buffers(disp, v->fb, NULL, w * h * 2, LV_DISPLAY_RENDER_MODE_DIRECT);
    lv_display_set_flush_cb(disp, flush_cb);
    lv_display_set_driver_data(disp, v);
    return disp;
}

EXPORT void kiln_display_delete(lv_display_t * disp)
{
    view_t * v = lv_display_get_driver_data(disp);
    lv_display_delete(disp);
    lv_free(v->fb);
    lv_free(v->rgba);
    lv_free(v);
}

EXPORT void kiln_display_theme(lv_display_t * disp, uint32_t primary, uint32_t secondary, bool dark)
{
    lv_theme_t * th = lv_theme_default_init(disp, lv_color_hex(primary), lv_color_hex(secondary), dark, LV_FONT_DEFAULT);
    lv_display_set_theme(disp, th);
}

EXPORT uint8_t * kiln_display_rgba(lv_display_t * disp)
{
    return ((view_t *)lv_display_get_driver_data(disp))->rgba;
}

/** Copies the area changed since the last call into `out`; false if nothing changed. */
EXPORT bool kiln_display_take_dirty(lv_display_t * disp, lv_area_t * out)
{
    view_t * v = lv_display_get_driver_data(disp);
    if(!v->has_dirty) return false;
    *out = v->dirty;
    v->has_dirty = false;
    return true;
}

/*---------- input ----------*/

static lv_indev_t * pointer;
static lv_point_t pointer_point;
static bool pointer_pressed;

static void pointer_read(lv_indev_t * indev, lv_indev_data_t * data)
{
    LV_UNUSED(indev);
    data->point = pointer_point;
    data->state = pointer_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

EXPORT void kiln_pointer(lv_display_t * disp, int32_t x, int32_t y, bool pressed)
{
    if(!pointer) {
        pointer = lv_indev_create();
        lv_indev_set_type(pointer, LV_INDEV_TYPE_POINTER);
        lv_indev_set_read_cb(pointer, pointer_read);
    }
    lv_indev_set_display(pointer, disp);
    pointer_point.x = x;
    pointer_point.y = y;
    pointer_pressed = pressed;
    lv_indev_read(pointer);
}

/*---------- style values (lv_style_value_t is passed by pointer in the wasm ABI) ----------*/

EXPORT void kiln_obj_style_num(lv_obj_t * obj, lv_style_prop_t prop, int32_t v, lv_style_selector_t sel)
{
    lv_style_value_t value = {.num = v};
    lv_obj_set_local_style_prop(obj, prop, value, sel);
}

EXPORT void kiln_obj_style_color(lv_obj_t * obj, lv_style_prop_t prop, uint32_t hex, lv_style_selector_t sel)
{
    lv_style_value_t value = {.color = lv_color_hex(hex)};
    lv_obj_set_local_style_prop(obj, prop, value, sel);
}

EXPORT void kiln_obj_style_ptr(lv_obj_t * obj, lv_style_prop_t prop, const void * p, lv_style_selector_t sel)
{
    lv_style_value_t value = {.ptr = p};
    lv_obj_set_local_style_prop(obj, prop, value, sel);
}

EXPORT lv_style_t * kiln_style_new(void)
{
    lv_style_t * style = lv_malloc(sizeof(lv_style_t));
    lv_style_init(style);
    return style;
}

EXPORT void kiln_style_num(lv_style_t * style, lv_style_prop_t prop, int32_t v)
{
    lv_style_value_t value = {.num = v};
    lv_style_set_prop(style, prop, value);
}

EXPORT void kiln_style_color(lv_style_t * style, lv_style_prop_t prop, uint32_t hex)
{
    lv_style_value_t value = {.color = lv_color_hex(hex)};
    lv_style_set_prop(style, prop, value);
}

EXPORT void kiln_style_ptr(lv_style_t * style, lv_style_prop_t prop, const void * p)
{
    lv_style_value_t value = {.ptr = p};
    lv_style_set_prop(style, prop, value);
}

EXPORT void kiln_style_free(lv_style_t * style)
{
    lv_style_reset(style);
    lv_free(style);
}

/*---------- LVGL API that takes lv_color_t by value: kiln__<name> takes 0xRRGGBB instead ----------*/

EXPORT void kiln__lv_led_set_color(lv_obj_t * led, uint32_t hex)
{
    lv_led_set_color(led, lv_color_hex(hex));
}

EXPORT void kiln__lv_subject_init_color(lv_subject_t * subject, uint32_t hex)
{
    lv_subject_init_color(subject, lv_color_hex(hex));
}

EXPORT void kiln__lv_subject_set_color(lv_subject_t * subject, uint32_t hex)
{
    lv_subject_set_color(subject, lv_color_hex(hex));
}

EXPORT lv_chart_series_t * kiln__lv_chart_add_series(lv_obj_t * chart, uint32_t hex, lv_chart_axis_t axis)
{
    return lv_chart_add_series(chart, lv_color_hex(hex), axis);
}

/*---------- objects JS allocates for the generated code's statics ----------*/

EXPORT lv_subject_t * kiln_subject_new(void)
{
    return lv_malloc_zeroed(sizeof(lv_subject_t));
}

/** A string subject with its two buffers in the same block, so one lv_free releases it. */
EXPORT lv_subject_t * kiln_subject_new_string(uint32_t size, const char * value)
{
    lv_subject_t * subject = lv_malloc_zeroed(sizeof(lv_subject_t) + size * 2);
    char * buf = (char *)(subject + 1);
    lv_subject_init_string(subject, buf, buf + size, size, value);
    return subject;
}

EXPORT void kiln_subject_free(lv_subject_t * subject)
{
    lv_subject_deinit(subject);
    lv_free(subject);
}

EXPORT lv_anim_t * kiln_anim_new(void)
{
    lv_anim_t * a = lv_malloc(sizeof(lv_anim_t));
    lv_anim_init(a);
    return a;
}

EXPORT lv_style_transition_dsc_t * kiln_transition_new(const int32_t * props, uint32_t count,
                                                       lv_anim_path_cb_t path, uint32_t time, uint32_t delay)
{
    lv_style_transition_dsc_t * tr = lv_malloc(sizeof(*tr) + (count + 1) * sizeof(lv_style_prop_t));
    lv_style_prop_t * list = (lv_style_prop_t *)(tr + 1);
    for(uint32_t i = 0; i < count; i++) list[i] = (lv_style_prop_t)props[i];
    list[count] = 0;
    lv_style_transition_dsc_init(tr, list, path, time, delay, NULL);
    return tr;
}

EXPORT lv_image_dsc_t * kiln_image_new(lv_color_format_t cf, uint32_t w, uint32_t h, uint32_t stride,
                                       const uint8_t * data, uint32_t size)
{
    lv_image_dsc_t * dsc = lv_malloc_zeroed(sizeof(lv_image_dsc_t));
    dsc->header.magic = LV_IMAGE_HEADER_MAGIC;
    dsc->header.cf = cf;
    dsc->header.w = w;
    dsc->header.h = h;
    dsc->header.stride = stride;
    dsc->data = data;
    dsc->data_size = size;
    return dsc;
}

EXPORT void kiln_image_free(lv_image_dsc_t * dsc)
{
    lv_image_cache_drop(dsc);
    lv_free((void *)dsc->data);
    lv_free(dsc);
}

/*---------- name lookups ----------*/

static bool streq(const char * a, const char * b)
{
    return lv_strcmp(a, b) == 0;
}

static const struct {
    const char * name;
    int32_t value;
} consts[] = {
#define K(name) { #name, (int32_t)(name) },
#include "consts.inc"
#undef K
};

/** Resolves an LVGL enum constant by name. Only names listed in consts.inc are known. */
EXPORT bool kiln_const(const char * name, int32_t * out)
{
    for(size_t i = 0; i < sizeof(consts) / sizeof(consts[0]); i++) {
        if(streq(consts[i].name, name)) {
            *out = consts[i].value;
            return true;
        }
    }
    return false;
}

static const struct {
    const char * name;
    void * fn;
} fns[] = {
#define F(name) { #name, (void *)name },
    F(lv_anim_path_linear) F(lv_anim_path_ease_in) F(lv_anim_path_ease_out) F(lv_anim_path_ease_in_out)
    F(lv_anim_path_overshoot) F(lv_anim_path_bounce) F(lv_anim_path_step) F(lv_anim_path_custom_bezier3)
    F(lv_obj_set_x) F(lv_obj_set_y) F(lv_obj_set_width) F(lv_obj_set_height) F(lv_arc_set_value)
#undef F
};

/** Function pointer (a wasm table index) for callbacks the generated code passes around. */
EXPORT void * kiln_fn(const char * name)
{
    for(size_t i = 0; i < sizeof(fns) / sizeof(fns[0]); i++) {
        if(streq(fns[i].name, name)) return fns[i].fn;
    }
    return NULL;
}

static const struct {
    const char * name;
    const lv_font_t * font;
} fonts[] = {
#define M(size) { "lv_font_montserrat_" #size, &lv_font_montserrat_##size },
    M(8) M(10) M(12) M(14) M(16) M(18) M(20) M(22) M(24) M(26) M(28) M(30) M(32) M(34) M(36) M(38) M(40) M(42) M(44)
    M(46) M(48)
#undef M
    { "lv_font_unscii_8", &lv_font_unscii_8 },
    { "lv_font_unscii_16", &lv_font_unscii_16 },
};

EXPORT const lv_font_t * kiln_font(const char * name)
{
    for(size_t i = 0; i < sizeof(fonts) / sizeof(fonts[0]); i++) {
        if(streq(fonts[i].name, name)) return fonts[i].font;
    }
    return NULL;
}
