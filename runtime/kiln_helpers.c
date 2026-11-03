#include "kiln_helpers.h"

static void style_cb(lv_anim_t * a, int32_t v)
{
    lv_style_value_t value = {.num = v};
    lv_obj_set_local_style_prop(a->var, (lv_style_prop_t)(uintptr_t)lv_anim_get_user_data(a), value, 0);
}

void kiln_anim_set_style(lv_anim_t * a, lv_style_prop_t prop)
{
    lv_anim_set_custom_exec_cb(a, style_cb);
    lv_anim_set_user_data(a, (void *)(uintptr_t)prop);
}

static void scale_cb(lv_anim_t * a, int32_t v)
{
    lv_obj_set_style_transform_scale_x(a->var, v, 0);
    lv_obj_set_style_transform_scale_y(a->var, v, 0);
}

void kiln_anim_set_scale(lv_anim_t * a)
{
    lv_anim_set_custom_exec_cb(a, scale_cb);
}

/* Colour anims keep both ends as RGB565 in user_data: the panel can't show more anyway. */
static uint16_t to_565(uint32_t hex)
{
    return (uint16_t)(((hex >> 8) & 0xF800) | ((hex >> 5) & 0x07E0) | ((hex >> 3) & 0x001F));
}

static lv_color_t from_565(uint32_t c)
{
    return lv_color_make((uint8_t)((c >> 8) & 0xF8), (uint8_t)((c >> 3) & 0xFC), (uint8_t)((c << 3) & 0xF8));
}

static lv_color_t color_at(lv_anim_t * a, int32_t v)
{
    uint32_t pair = (uint32_t)(uintptr_t)lv_anim_get_user_data(a);
    return lv_color_mix(from_565(pair & 0xFFFF), from_565(pair >> 16), (uint8_t)LV_CLAMP(0, v, 255));
}

static void bg_color_cb(lv_anim_t * a, int32_t v)
{
    lv_obj_set_style_bg_color(a->var, color_at(a, v), 0);
}

static void text_color_cb(lv_anim_t * a, int32_t v)
{
    lv_obj_set_style_text_color(a->var, color_at(a, v), 0);
}

static void border_color_cb(lv_anim_t * a, int32_t v)
{
    lv_obj_set_style_border_color(a->var, color_at(a, v), 0);
}

void kiln_anim_set_color(lv_anim_t * a, lv_style_prop_t prop, uint32_t from, uint32_t to)
{
    lv_anim_set_custom_exec_cb(a, prop == LV_STYLE_TEXT_COLOR ? text_color_cb
                               : prop == LV_STYLE_BORDER_COLOR ? border_color_cb : bg_color_cb);
    lv_anim_set_user_data(a, (void *)(uintptr_t)((uint32_t)to_565(from) << 16 | to_565(to)));
    lv_anim_set_values(a, 0, 255);
}

typedef struct {
    lv_style_prop_t prop;
    lv_style_selector_t selector;
    int32_t in_min, in_max, out_min, out_max;
} style_map_t;

static void style_map_cb(lv_observer_t * observer, lv_subject_t * subject)
{
    style_map_t * m = lv_observer_get_user_data(observer);
    int32_t in = LV_CLAMP(LV_MIN(m->in_min, m->in_max), lv_subject_get_int(subject), LV_MAX(m->in_min, m->in_max));
    lv_style_value_t value = {.num = lv_map(in, m->in_min, m->in_max, m->out_min, m->out_max)};
    lv_obj_set_local_style_prop(lv_observer_get_target_obj(observer), m->prop, value, m->selector);
}

static void free_user_data_cb(lv_event_t * e)
{
    lv_free(lv_event_get_user_data(e));
}

lv_observer_t * kiln_bind_style_map(lv_obj_t * obj, lv_style_prop_t prop, lv_style_selector_t selector,
                                    lv_subject_t * subject, int32_t in_min, int32_t in_max,
                                    int32_t out_min, int32_t out_max)
{
    style_map_t * m = lv_malloc(sizeof(style_map_t));
    LV_ASSERT_MALLOC(m);
    m->prop = prop;
    m->selector = selector;
    m->in_min = in_min;
    m->in_max = in_max;
    m->out_min = out_min;
    m->out_max = out_max;
    lv_obj_add_event_cb(obj, free_user_data_cb, LV_EVENT_DELETE, m);
    return lv_subject_add_observer_obj(subject, style_map_cb, obj, m);
}

/* LVGL 9.6 deprecates lv_obj_bind_flag_if_* and lv_obj_bind_state_if_*; this is their replacement. */
typedef struct {
    uint32_t what;
    int32_t ref;
    uint8_t op;
    bool is_state;
} cond_t;

static bool holds(kiln_compare_t op, int32_t v, int32_t ref)
{
    switch(op) {
        case KILN_EQ: return v == ref;
        case KILN_NOT_EQ: return v != ref;
        case KILN_GT: return v > ref;
        case KILN_GE: return v >= ref;
        case KILN_LT: return v < ref;
        case KILN_LE: return v <= ref;
    }
    return false;
}

static void cond_cb(lv_observer_t * observer, lv_subject_t * subject)
{
    cond_t * c = lv_observer_get_user_data(observer);
    lv_obj_t * obj = lv_observer_get_target_obj(observer);
    bool on = holds((kiln_compare_t)c->op, lv_subject_get_int(subject), c->ref);
    if(c->is_state) lv_obj_set_state(obj, (lv_state_t)c->what, on);
    else if(c->what == LV_OBJ_FLAG_HIDDEN) {
        lv_obj_set_hidden(obj, on);
        /* LVGL re-measures a parent only for children its flex or grid places, so a content-sized
         * group whose child just showed would stay as small as it was with the child hidden */
        lv_obj_t * parent = lv_obj_get_parent(obj);
        if(parent) lv_obj_mark_layout_as_dirty(parent);
    }
    else if(c->what == LV_OBJ_FLAG_CLICKABLE) lv_obj_set_clickable(obj, on);
}

static lv_observer_t * bind_cond(lv_obj_t * obj, lv_subject_t * subject, uint32_t what, bool is_state,
                                 kiln_compare_t op, int32_t ref)
{
    cond_t * c = lv_malloc(sizeof(cond_t));
    LV_ASSERT_MALLOC(c);
    c->what = what;
    c->ref = ref;
    c->op = (uint8_t)op;
    c->is_state = is_state;
    lv_obj_add_event_cb(obj, free_user_data_cb, LV_EVENT_DELETE, c);
    return lv_subject_add_observer_obj(subject, cond_cb, obj, c);
}

lv_observer_t * kiln_bind_flag_if(lv_obj_t * obj, lv_subject_t * subject, lv_obj_flag_t flag, kiln_compare_t op, int32_t ref)
{
    return bind_cond(obj, subject, (uint32_t)flag, false, op, ref);
}

lv_observer_t * kiln_bind_state_if(lv_obj_t * obj, lv_subject_t * subject, lv_state_t state, kiln_compare_t op, int32_t ref)
{
    return bind_cond(obj, subject, (uint32_t)state, true, op, ref);
}

typedef struct {
    lv_anim_timeline_t * at;
    uint32_t delay;
    bool reverse;
} play_t;

static void play_cb(lv_event_t * e)
{
    play_t * p = lv_event_get_user_data(e);
    lv_anim_timeline_pause(p->at);
    lv_anim_timeline_set_delay(p->at, p->delay);
    lv_anim_timeline_set_reverse(p->at, p->reverse);
    lv_anim_timeline_set_progress(p->at, p->reverse ? LV_ANIM_TIMELINE_PROGRESS_MAX : 0);
    lv_anim_timeline_start(p->at);
}

void kiln_obj_add_play_event(lv_obj_t * obj, lv_event_code_t trigger, lv_anim_timeline_t * at, uint32_t delay, bool reverse)
{
    play_t * p = lv_malloc(sizeof(play_t));
    LV_ASSERT_MALLOC(p);
    p->at = at;
    p->delay = delay;
    p->reverse = reverse;
    lv_obj_add_event_cb(obj, play_cb, trigger, p);
    lv_obj_add_event_cb(obj, free_user_data_cb, LV_EVENT_DELETE, p);
}

static void chart_cb(lv_observer_t * observer, lv_subject_t * subject)
{
    lv_chart_set_next_value(lv_observer_get_target_obj(observer), lv_observer_get_user_data(observer),
                            lv_subject_get_int(subject));
}

lv_observer_t * kiln_chart_bind_series(lv_obj_t * chart, lv_chart_series_t * series, lv_subject_t * subject)
{
    return lv_subject_add_observer_obj(subject, chart_cb, chart, series);
}

const lv_font_t * kiln_tiny_ttf(const void * data, size_t size, int32_t px, size_t cache, const lv_font_t * fallback)
{
#if LV_USE_TINY_TTF
    lv_font_t * font = lv_tiny_ttf_create_data_ex(data, size, px, LV_FONT_KERNING_NORMAL, cache);
    if(font == NULL) return LV_FONT_DEFAULT; /* not enough heap, or not a font TinyTTF reads */
    font->fallback = fallback;
    return font;
#else
    LV_UNUSED(data);
    LV_UNUSED(size);
    LV_UNUSED(px);
    LV_UNUSED(cache);
    LV_UNUSED(fallback);
    return LV_FONT_DEFAULT;
#endif
}

#if LV_USE_ANIMIMG
static void animimg_done(lv_anim_t * a)
{
    lv_obj_send_event((lv_obj_t *)a->var, LV_EVENT_READY, NULL);
}
#endif

void kiln_animimg_notify_done(lv_obj_t * obj)
{
#if LV_USE_ANIMIMG
    lv_animimg_set_completed_cb(obj, animimg_done);
#else
    LV_UNUSED(obj);
#endif
}

static void focus_screen_loaded(lv_event_t * e)
{
    lv_group_t * group = lv_event_get_user_data(e);
    for(lv_indev_t * i = lv_indev_get_next(NULL); i; i = lv_indev_get_next(i))
        if(lv_indev_get_type(i) == LV_INDEV_TYPE_KEYPAD || lv_indev_get_type(i) == LV_INDEV_TYPE_ENCODER)
            lv_indev_set_group(i, group);
}

static void focus_screen_deleted(lv_event_t * e)
{
    lv_group_delete(lv_event_get_user_data(e));
}

lv_group_t * kiln_focus_group(lv_obj_t * screen)
{
    if(screen == NULL) return NULL;
    uint32_t count = lv_obj_get_event_count(screen);
    for(uint32_t i = 0; i < count; i++) {
        lv_event_dsc_t * dsc = lv_obj_get_event_dsc(screen, i);
        if(lv_event_dsc_get_cb(dsc) == focus_screen_loaded) return lv_event_dsc_get_user_data(dsc);
    }
    return NULL;
}

void kiln_focus_add(lv_obj_t * screen, lv_obj_t * obj)
{
    lv_group_t * group = kiln_focus_group(screen);
    if(group == NULL) {
        group = lv_group_create();
        lv_obj_add_event_cb(screen, focus_screen_loaded, LV_EVENT_SCREEN_LOADED, group);
        lv_obj_add_event_cb(screen, focus_screen_deleted, LV_EVENT_DELETE, group);
    }
    lv_group_add_obj(group, obj);
}
