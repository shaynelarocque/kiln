// kiln-debug on the host (see build.sh): the exported UI on a display that throws its pixels away,
// a clock that moves 5 ms a step, and the "@K …" commands from argv fed to Serial one at a time,
// 800 ms apart.
#include <string>
#include <string.h>
#include "Arduino.h"
#include "lvgl.h"
#include "ui/ui.h"
#include "kiln_debug.h"

static uint32_t now_ms = 1000;
uint32_t millis(void) { return now_ms; }
uint32_t micros(void) { return now_ms * 1000; }

static std::string input;
HostSerial Serial;
int HostSerial::available(void) { return (int)input.size(); }
int HostSerial::read(void) {
    if (input.empty()) return -1;
    int c = (unsigned char)input[0];
    input.erase(0, 1);
    return c;
}
void HostSerial::println(const char * line) { printf("%s\n", line); fflush(stdout); }

static uint8_t buf[240 * 40 * 2];
static void flush(lv_display_t * d, const lv_area_t *, uint8_t *) { lv_display_flush_ready(d); }
static uint32_t tick(void) { return now_ms; }

static void run(uint32_t ms) {
    for (uint32_t t = 0; t < ms; t += 5) {
        now_ms += 5;
        kiln_debug_poll();
        lv_timer_handler();
    }
}

int main(int argc, char ** argv) {
    lv_init();
    lv_tick_set_cb(tick);
    lv_display_t * d = lv_display_create(240, 240);
    lv_display_set_flush_cb(d, flush);
    lv_display_set_buffers(d, buf, NULL, sizeof buf, LV_DISPLAY_RENDER_MODE_PARTIAL);
    ui_init();
    kiln_debug_init();
    run(200);
    for (int i = 1; i < argc; i++) {
        input += argv[i];
        input += "\n";
        run(800);
    }
    return 0;
}
