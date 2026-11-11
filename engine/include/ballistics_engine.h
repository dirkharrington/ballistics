#ifndef BALLISTICS_ENGINE_H
#define BALLISTICS_ENGINE_H

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#define MAX_POINTS 50000

/**
 * Compute a trajectory. `params_json` and `bullet_json` are UTF-8 JSON strings.
 * Returns a heap-allocated UTF-8 JSON string (TrajectoryResult or error envelope).
 * The caller must free the returned pointer with `ballistics_free_string`.
 * Returns NULL if `params_json` or `bullet_json` is NULL.
 * Must be freed exactly once.
 */
char *ballistics_compute_trajectory(const char *params_json, const char *bullet_json);

/**
 * Free a string returned by `ballistics_compute_trajectory`.
 * Safe to call with NULL.
 */
void ballistics_free_string(char *s);

#endif  /* BALLISTICS_ENGINE_H */
