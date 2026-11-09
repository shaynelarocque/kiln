// A stand-in for Arduino on the host: a clock the test moves, and a Serial fed from a script.
#pragma once
#include <stdint.h>
#include <stdio.h>
uint32_t millis(void);
uint32_t micros(void);
struct HostSerial {
    int available(void);
    int read(void);
    void println(const char * line);
};
extern HostSerial Serial;
