# BE-UPGRADE: Spring Boot 4.0.9 → 4.1.1

## Target version

| Artifact | Current | Target |
|---|---|---|
| `spring-boot-starter-parent` | 4.0.9 | **4.1.1** |

Spring Boot 4.1.0 was released June 10, 2026. Spring Boot 4.1.1 is the latest
patch as of November 2026. Spring Boot 4.2.x is pre-release and must **not** be
targeted.

---

## Motivation

Spring Boot 4.1.x upgrades managed dependency versions (Spring Framework 7.1.x,
Tomcat 11.0.x, Jackson 3.x, Micrometer 1.x). The current `pom.xml` carries five
manually-pinned override properties that were added to patch CVEs present in Boot
4.0.6. Boot 4.1.x manages versions that include those fixes natively, so the
manual overrides can be removed — or at minimum reviewed against the new managed
versions.

---

## `pom.xml` changes

### 1. Bump parent version

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>   <!-- was 4.0.9 -->
    <relativePath/>
</parent>
```

### 2. Review and remove stale CVE override properties

The following five properties were added to patch CVEs in Boot 4.0.6. After
bumping to 4.1.1, **run `mvn dependency:tree -Dverbose`** and check the managed
version for each artifact. Remove the override if Boot 4.1.1 manages a version ≥
the pinned value; keep it only if the managed version is still below the CVE-free
threshold.

```xml
<!-- Review each — remove if Boot 4.1.1 already manages ≥ this version -->
<spring-framework.version>7.0.10</spring-framework.version>
<tomcat.version>11.0.27</tomcat.version>
<jackson-bom.version>3.2.4</jackson-bom.version>
<micrometer.version>1.17.2</micrometer.version>
<prometheus-client.version>1.7.0</prometheus-client.version>
```

**Decision rule**: run `mvn help:effective-pom | grep -A1 '<spring-framework.version>'`
(and equivalent for each artifact) to find what 4.1.1 manages. If Boot's managed
version ≥ the pinned value, delete the property. If it is lower, keep the pin and
add a comment with the CVE number.

### 3. Jackson 2.x `dependencyManagement` override for logstash

This override is **unrelated to Spring Boot's version** — it forces the Jackson 2.x
BOM used by `logstash-logback-encoder` to a CVE-free version. Keep it:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.fasterxml.jackson</groupId>
            <artifactId>jackson-bom</artifactId>
            <version>2.22.4</version>  <!-- may need bumping — check logstash's transitive Jackson 2.x -->
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Check whether `logstash-logback-encoder` 8.0 now pins a CVE-free Jackson 2.x
transitively. If it does, this override can be removed.

### 4. springdoc-openapi version

The `springdoc-openapi-starter-webmvc-ui` 3.x line covers all Spring Boot 4.x.
Current version is 3.2.0. After bumping Boot to 4.1.1:

1. Check Maven Central for the latest `springdoc-openapi-starter-webmvc-ui` 3.x
   release compatible with Spring Boot 4.1.x.
2. Update the version to the latest stable 3.x release.
3. Confirm `GET /v3/api-docs` still returns valid OpenAPI JSON and `GET /swagger-ui/index.html`
   loads without 500 errors (covered by `OpenApiTest`).

---

## Migration checklist

| Step | What to do |
|---|---|
| Bump parent | `<version>4.1.1</version>` in `<parent>` |
| Resolve CVE overrides | `mvn dependency:tree`, remove each stale property |
| Verify Jackson 2.x override | still needed for logstash? |
| Update springdoc | latest 3.x compatible with Boot 4.1 |
| Compile | `mvn compile` — fix any API deprecation removals or package renames |
| Unit tests | `mvn verify` — all 281+ Java tests must pass |
| Frontend tests | `npm test -- --ci` — 100% coverage must hold |
| OWASP scan | `mvn dependency-check:check` — fail on CVSS ≥ 7 |
| JaCoCo | `mvn verify` JaCoCo check must pass (all counters ≥ 1.00 for non-excluded classes) |

---

## Known migration notes for Spring Boot 4.1.x

### Potential breaking changes to watch

- **Spring Framework 7.1.x**: Some internal MVC APIs changed between 7.0 and 7.1.
  If any class references `org.springframework.web.servlet.mvc.method.annotation.*`
  internals (beyond `ResponseEntityExceptionHandler`, which is public API), verify
  the signatures still compile.

- **Caffeine**: Caffeine 3.x is the Spring Boot 4.x managed version. No API
  breaking changes expected between Caffeine 3.x patch versions.

- **Micrometer 1.17.x → 1.18.x** (if 4.1 manages a higher minor): The Prometheus
  registry format API is stable across Micrometer 1.x; no changes expected.

- **Jackson 3.x**: Jackson 3.x has a different package structure from 2.x
  (`tools.jackson.*` instead of `com.fasterxml.jackson.*`). The project already
  imports `tools.jackson.databind.ObjectMapper` in `RequestBodySizeLimitFilter.java`,
  confirming it is on Jackson 3.x. No migration needed unless Jackson 3.2.x → 3.3.x
  introduces removals.

---

## Acceptance checklist

- [ ] `pom.xml` parent version is `4.1.1`
- [ ] Each CVE override property is either removed or has a comment with the CVE it pins
- [ ] `mvn dependency:tree` shows no duplicate/conflicting version for spring-framework, tomcat, jackson-core, micrometer-core
- [ ] `mvn verify` → BUILD SUCCESS, 0 failures, JaCoCo check passes
- [ ] `npm test -- --ci` → all tests pass at 100% coverage
- [ ] `mvn dependency-check:check` → no CVSS ≥ 7 unfixed findings
- [ ] `GET /v3/api-docs` returns 200 with valid JSON
- [ ] Application starts cleanly with no WARN/ERROR at boot
