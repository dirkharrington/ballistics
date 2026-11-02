# Contract: `PhysicsTables` bean

Version: 1.0.0 — 2026-11-01
Design: [`docs/architecture/trajectory-service-refactor.md`](../docs/architecture/trajectory-service-refactor.md) §C

Builders implement this contract exactly. To change it, propose the change to the architect. Don't edit this file.

## Shape (`com.ballistics.physics`)

```java
public record PhysicsTables(DragTable g1, DragTable g7, Atmosphere atmosphere) {
    // compact ctor: all non-null (Objects.requireNonNull with component name)
    public DragTable forModel(String dragModel);   // "G7" → g7, anything else → g1 (matches current engine behaviour)
}

public record DragTable(double[] velocitiesFps, double[] coefficients) {
    // compact ctor: clone both arrays, then validate (see Validation)
    @Override public double[] velocitiesFps() { return velocitiesFps.clone(); }   // defensive copy out
    @Override public double[] coefficients()  { return coefficients.clone(); }
    // equals/hashCode/toString overridden with Arrays.equals / Arrays.hashCode / size-only toString
    public int size();
}

public record Atmosphere(double stdTempF,
                         double lapseRatePer1000Ft,
                         double rankineOffset,
                         double pressureCoeff,
                         double pressureExp) {
    // compact ctor: all finite; rankineOffset > 0; pressureCoeff > 0; pressureExp > 0
}
```

The records are immutable. Because arrays are copied in and out, nobody holding a `PhysicsTables` can change what the engine sees.

## Loading

```java
public final class PhysicsTablesLoader {
    /** Parses and validates. sourceDescription is used only in error messages, e.g. "classpath:physics-tables.yaml". */
    public static PhysicsTables load(InputStream yaml, String sourceDescription);   // throws PhysicsTablesLoadException
    public static PhysicsTables load(org.springframework.core.io.Resource resource); // missing resource → PhysicsTablesLoadException
}

public class PhysicsTablesLoadException extends RuntimeException {
    public PhysicsTablesLoadException(String source, String problem, Throwable cause);
    public String source();  public String problem();
}
```

- YAML parser: `new Yaml(new SafeConstructor(new LoaderOptions()))`. No arbitrary type construction.
- The YAML schema is **unchanged** and shared with the JS client (`virtual:physics-tables`): `g1Table: [{v, f}, ...]`, `g7Table: [{v, f}, ...]`, `atmosphere: {stdTempF, lapseRatePer1000Ft, rankineOffset, pressureCoeff, pressureExp}`.
- `PhysicsTablesLoader` has no Spring beans as dependencies, so tests and the JMH benchmark can call it directly.

### Validation (each failure names its exact location)

| Rule | Example message (`problem`) |
|---|---|
| File/resource exists | `resource not found` |
| Root is a mapping | `root must be a YAML mapping` |
| `g1Table`, `g7Table` present, list, ≥ 2 rows | `g7Table must contain at least 2 rows (found 1)` |
| Each row has numeric `v` and `f` | `g1Table[14].f is missing or not a number` |
| `v` ≥ 0 and strictly increasing (`Arrays.binarySearch` in the engine depends on this) | `g7Table[12].v must be > g7Table[11].v (1200.0 <= 1250.0)` |
| `f` finite and > 0 | `g1Table[3].f must be finite and > 0 (NaN)` |
| `atmosphere` has all 5 numeric keys | `atmosphere.pressureExp is missing or not a number` |
| Malformed YAML | `malformed YAML: <SnakeYAML message, line/column>` (with cause) |

## Spring wiring (`com.ballistics.config`)

```java
@Configuration
@ImportRuntimeHints(PhysicsTablesConfig.Hints.class)
public class PhysicsTablesConfig {

    @Bean
    public PhysicsTables physicsTables(
            @Value("${app.physics.tables-location:classpath:physics-tables.yaml}") Resource location) {
        return PhysicsTablesLoader.load(location);
    }

    static class Hints implements RuntimeHintsRegistrar {      // GraalVM native profile
        public void registerHints(RuntimeHints h, ClassLoader cl) { h.resources().registerPattern("physics-tables.yaml"); }
    }
}
```

- Mechanism: a plain `@Bean` method. **Not** `@ConfigurationProperties`; the design doc §C explains why.
- `app.physics.tables-location` isn't mapped to an env var. It exists for tests and isn't documented in prod properties.
- The bean is created eagerly as a singleton (the Spring default), so bad YAML fails context refresh before the web server opens its port.

### Startup failure output

`PhysicsTablesFailureAnalyzer extends AbstractFailureAnalyzer<PhysicsTablesLoadException>` is registered in `src/main/resources/META-INF/spring.factories` under `org.springframework.boot.diagnostics.FailureAnalyzer` (check the key against the Boot 4.0.x docs). Output:

```
***************************
APPLICATION FAILED TO START
***************************

Description:

Physics tables could not be loaded from classpath:physics-tables.yaml: g7Table[12].v must be > g7Table[11].v (1200.0 <= 1250.0)

Action:

Fix physics-tables.yaml (it is shared with the JS client via virtual:physics-tables), or point
app.physics.tables-location at a valid file.
```

## `BallisticsEngine` changes

```java
@Service
public class BallisticsEngine {
    public BallisticsEngine(PhysicsTables tables, MeterRegistry meterRegistry);
}
```

- Removed: the `static {}` block, `static final double[] G1_VELOCITIES/G1_COEFFS/G7_VELOCITIES/G7_COEFFS`, `static final double ATM_*`, and the `org.yaml.snakeyaml` / `InputStream` imports.
- Added: `private final double[] g1Velocities, g1Coeffs, g7Velocities, g7Coeffs` and `private final double atmStdTempF, atmLapseRatePer1000Ft, atmRankineOffset, atmPressureCoeff, atmPressureExp`. They are filled **once** in the constructor from the record accessors. The engine never calls the cloning accessors on the hot path.
- The physical constants that aren't table data (`GRAVITY_FPS2`, `DT_SECONDS`, the conversion factors) stay `private static final`.
- `airDensityRatio` and drag-table selection read the instance fields. The algorithms don't change.
- `@Cacheable` key changes to `{ #bullet, #req }` (see [`trajectory-service.md`](trajectory-service.md)).

### Test construction

```java
PhysicsTables tables = PhysicsTablesLoader.load(new ClassPathResource("physics-tables.yaml"));
BallisticsEngine engine = new BallisticsEngine(tables, new SimpleMeterRegistry());
// Alternate data: new PhysicsTables(new DragTable(new double[]{0, 3000}, new double[]{0.2, 0.2}), g7, atm)
```

## Acceptance checklist

- [ ] `grep -n "static {" src/main/java/com/ballistics/service/BallisticsEngine.java` returns nothing.
- [ ] `CrossValidationTest` and `BallisticsEngineTest` pass with unchanged expected values (bit-identical output).
- [ ] A context test with `app.physics.tables-location=classpath:does-not-exist.yaml` fails, and the failure analysis contains `Physics tables could not be loaded`.
- [ ] Loader unit tests cover every row in the Validation table.
- [ ] Mutating an array returned by `DragTable.velocitiesFps()` doesn't change engine output.
- [ ] JMH `-Pbenchmark` is within 5 % of the pre-change baseline (numbers in the PR).
