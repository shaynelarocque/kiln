/**
 * kiln-debug's runtime, compiled into the Debug build only (see kiln_debug.h). Kiln copies this
 * file into every export as is; kiln_debug_tables.h has the project's names.
 *
 * What it prints, one line each, <ms> being millis():
 *   @K <ms> ready <protocol> <screen showing>
 *   @K <ms> ev press|release|click|long|value <layer>
 *   @K <ms> scr load|loaded|unload|unloaded <screen>
 *   @K <ms> anim start <playtime ms> <delay ms> <animation>   (as designed)
 *   @K <ms> anim done <animation>                              (as it happened)
 *   @K <ms> var <variable> <value>
 *   @K <ms> frames <count> <average us> <longest us>           (each second something was drawn)
 *   @K <ms> ok <command> | err <why> | pong | mark <text>
 *
 * What it takes, one line each:
 *   @K tap <layer>           presses its centre for 80 ms, as a finger would
 *   @K hold <ms> <layer>     presses it that long (a long press)
 *   @K set <variable> <value>
 *   @K load <screen>         shows a screen at once: a known place to start a replay
 *   @K mark <text>           echoed back, to tell steps apart
 *   @K ping
 * Anything else on serial is ignored: in a Debug build, kiln-debug reads Serial.
 */
#ifdef KILN_DEBUG

#include <Arduino.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include "kiln_debug.h"

typedef struct
{
    const char * name;
    lv_obj_t ** obj;
    bool screen;
} kd_layer_t;

typedef struct
{
    const char * name;
    lv_subject_t ** subject;
    bool text;
} kd_variable_t;

typedef struct
{
    const char * name;
    lv_anim_timeline_t ** at;
    bool running;
} kd_animation_t;

#include "kiln_debug_tables.h"

#define KD_PROTOCOL 1
#define KD_TAP_MS 80

static void kd_printf(const char * what, const char * format, ...)
{
    char line[192];
    int n = snprintf(line, sizeof line, "@K %lu %s ", (unsigned long)millis(), what);
    if (n > 0 && n < (int)sizeof line) {
        va_list args;
        va_start(args, format);
        vsnprintf(line + n, sizeof line - n, format, args);
        va_end(args);
    }
    Serial.println(line);
}

static void kd_print(const char * what)
{
    char line[48];
    snprintf(line, sizeof line, "@K %lu %s", (unsigned long)millis(), what);
    Serial.println(line);
}

static const kd_layer_t * kd_layer(const char * name)
{
    for (const kd_layer_t * l = kd_layers; l->name; l++)
        if (!strcmp(l->name, name)) return l;
    return NULL;
}

static const char * kd_name_of(lv_obj_t * obj)
{
    for (const kd_layer_t * l = kd_layers; l->name; l++)
        if (*l->obj == obj) return l->name;
    return "?";
}

/*---------- traces ----------*/

static void kd_event(lv_event_t * e)
{
    if (lv_event_get_target(e) != lv_event_get_current_target(e)) return;
    const char * kind = "ev";
    const char * what;
    switch (lv_event_get_code(e)) {
        case LV_EVENT_PRESSED: what = "press"; break;
        case LV_EVENT_RELEASED: what = "release"; break;
        case LV_EVENT_CLICKED: what = "click"; break;
        case LV_EVENT_LONG_PRESSED: what = "long"; break;
        case LV_EVENT_VALUE_CHANGED: what = "value"; break;
        case LV_EVENT_SCREEN_LOAD_START: kind = "scr"; what = "load"; break;
        case LV_EVENT_SCREEN_LOADED: kind = "scr"; what = "loaded"; break;
        case LV_EVENT_SCREEN_UNLOAD_START: kind = "scr"; what = "unload"; break;
        case LV_EVENT_SCREEN_UNLOADED: kind = "scr"; what = "unloaded"; break;
        default: return;
    }
    kd_printf(kind, "%s %s", what, (const char *)lv_event_get_user_data(e));
}

static void kd_variable(lv_observer_t * observer, lv_subject_t * subject)
{
    const kd_variable_t * v = (const kd_variable_t *)lv_observer_get_user_data(observer);
    if (v->text) kd_printf("var", "%s %s", v->name, lv_subject_get_string(subject));
    else kd_printf("var", "%s %ld", v->name, (long)lv_subject_get_int(subject));
}

extern "C" void kiln_debug_played(lv_anim_timeline_t * at, uint32_t delay)
{
    for (kd_animation_t * a = kd_animations; a->name; a++)
        if (*a->at == at) {
            a->running = true;
            kd_printf("anim", "start %lu %lu %s", (unsigned long)lv_anim_timeline_get_playtime(at),
                      (unsigned long)delay, a->name);
        }
}

/* A timeline is done when its progress reaches the end it was heading for. A repeating one
 * reports its first lap. */
static void kd_poll_animations(void)
{
    for (kd_animation_t * a = kd_animations; a->name; a++) {
        if (!a->running || !*a->at) continue;
        uint16_t end = lv_anim_timeline_get_reverse(*a->at) ? 0 : LV_ANIM_TIMELINE_PROGRESS_MAX;
        if (lv_anim_timeline_get_progress(*a->at) == end) {
            a->running = false;
            kd_printf("anim", "done %s", a->name);
        }
    }
}

/* How long LVGL takes to draw a frame, flushes included: what makes an animation stutter. */
static uint32_t kd_render_started, kd_frames, kd_frame_total, kd_frame_longest, kd_frames_since;

static void kd_render(lv_event_t * e)
{
    if (lv_event_get_code(e) == LV_EVENT_RENDER_START) {
        kd_render_started = micros();
        return;
    }
    uint32_t us = micros() - kd_render_started;
    kd_frames++;
    kd_frame_total += us;
    if (us > kd_frame_longest) kd_frame_longest = us;
}

static void kd_poll_frames(void)
{
    if (millis() - kd_frames_since < 1000) return;
    if (kd_frames)
        kd_printf("frames", "%lu %lu %lu", (unsigned long)kd_frames,
                  (unsigned long)(kd_frame_total / kd_frames), (unsigned long)kd_frame_longest);
    kd_frames = kd_frame_total = kd_frame_longest = 0;
    kd_frames_since = millis();
}

/*---------- a finger: an LVGL pointer of its own, pressed by commands ----------*/

static struct
{
    bool down;
    lv_point_t at;
    uint32_t until;
    char what[64];
} kd_touch;

static void kd_pointer(lv_indev_t * indev, lv_indev_data_t * data)
{
    (void)indev;
    data->point = kd_touch.at;
    data->state = kd_touch.down ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

static void kd_press(const char * name, uint32_t ms, const char * command)
{
    if (kd_touch.down) return kd_printf("err", "still pressing: %s", kd_touch.what);
    const kd_layer_t * l = kd_layer(name);
    if (!l || !*l->obj) return kd_printf("err", "there's no layer %s", name);
    lv_obj_t * obj = *l->obj;
    if (lv_obj_get_screen(obj) != lv_screen_active())
        return kd_printf("err", "%s isn't on the screen showing", name);
    if (!lv_obj_is_visible(obj)) return kd_printf("err", "%s is hidden", name);
    lv_area_t area;
    lv_obj_get_coords(obj, &area);
    kd_touch.at.x = (area.x1 + area.x2) / 2;
    kd_touch.at.y = (area.y1 + area.y2) / 2;
    kd_touch.until = millis() + ms;
    kd_touch.down = true;
    snprintf(kd_touch.what, sizeof kd_touch.what, "%s %s", command, name);
}

static void kd_poll_touch(void)
{
    if (kd_touch.down && (int32_t)(millis() - kd_touch.until) >= 0) {
        kd_touch.down = false;
        kd_printf("ok", "%s", kd_touch.what);
    }
}

/*---------- commands ----------*/

static void kd_set(char * arg)
{
    char * value = strchr(arg, ' ');
    if (value) *value++ = 0;
    else value = arg + strlen(arg);
    for (const kd_variable_t * v = kd_variables; v->name; v++)
        if (!strcmp(v->name, arg)) {
            if (v->text) lv_subject_set_string(*v->subject, value);
            else lv_subject_set_int(*v->subject, strtol(value, NULL, 10));
            return kd_printf("ok", "set %s", v->name);
        }
    kd_printf("err", "there's no variable %s", arg);
}

static void kd_command(char * line)
{
    if (strncmp(line, "@K ", 3)) return;
    char * command = line + 3;
    char * arg = strchr(command, ' ');
    if (arg) *arg++ = 0;
    else arg = command + strlen(command);

    if (!strcmp(command, "ping")) kd_print("pong");
    else if (!strcmp(command, "mark")) kd_printf("mark", "%s", arg);
    else if (!strcmp(command, "tap")) kd_press(arg, KD_TAP_MS, "tap");
    else if (!strcmp(command, "hold")) {
        char * name;
        unsigned long ms = strtoul(arg, &name, 10);
        while (*name == ' ') name++;
        kd_press(name, ms ? ms : 600, "hold");
    }
    else if (!strcmp(command, "set")) kd_set(arg);
    else if (!strcmp(command, "load")) {
        const kd_layer_t * l = kd_layer(arg);
        if (!l || !l->screen || !*l->obj) return kd_printf("err", "there's no screen %s", arg);
        lv_screen_load(*l->obj);
        kd_printf("ok", "load %s", arg);
    }
    else kd_printf("err", "there's no command %s", command);
}

static void kd_poll_serial(void)
{
    static char line[160];
    static size_t length;
    static bool overflow;
    while (Serial.available() > 0) {
        int c = Serial.read();
        if (c < 0) break;
        if (c == '\r') continue;
        if (c == '\n') {
            line[length] = 0;
            if (!overflow) kd_command(line);
            length = 0;
            overflow = false;
        }
        else if (length < sizeof line - 1) line[length++] = (char)c;
        else overflow = true;
    }
}

/*---------- entry points ----------*/

extern "C" void kiln_debug_init(void)
{
    for (const kd_layer_t * l = kd_layers; l->name; l++) {
        lv_obj_t * obj = *l->obj;
        if (obj && (l->screen || lv_obj_is_clickable(obj)))
            lv_obj_add_event_cb(obj, kd_event, LV_EVENT_ALL, (void *)l->name);
    }
    lv_display_t * display = lv_display_get_default();
    lv_display_add_event_cb(display, kd_render, LV_EVENT_RENDER_START, NULL);
    lv_display_add_event_cb(display, kd_render, LV_EVENT_RENDER_READY, NULL);
    lv_indev_t * finger = lv_indev_create();
    lv_indev_set_type(finger, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(finger, kd_pointer);

    kd_printf("ready", "%d %s", KD_PROTOCOL, kd_name_of(lv_screen_active()));
    /* each observer reports its variable's value once as it's added: the starting state */
    for (const kd_variable_t * v = kd_variables; v->name; v++)
        if (*v->subject) lv_subject_add_observer(*v->subject, kd_variable, (void *)v);
}

extern "C" void kiln_debug_poll(void)
{
    kd_poll_serial();
    kd_poll_touch();
    kd_poll_animations();
    kd_poll_frames();
}

#endif /* KILN_DEBUG */
